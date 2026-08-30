import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as diditWebhookPOST } from "@/app/api/webhooks/didit/route";
import {
  createDiditSession,
  DIDIT_FREE_KYC_WORKFLOW_ID,
  diditCanonicalJson,
  isIdentityVerified,
  verifyDiditWebhook,
} from "@/lib/didit";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("Didit hosted verification", () => {
  it("creates a v3 session without exposing the API key in the request body", async () => {
    process.env.DIDIT_API_KEY = "didit-test-key";
    process.env.DIDIT_WEBHOOK_SECRET = "webhook-test-secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          session_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          url: "https://verify.didit.me/session/token",
          status: "Not Started",
          workflow_id: DIDIT_FREE_KYC_WORKFLOW_ID,
          vendor_data: "99999999-8888-4777-8666-555555555555",
        },
        { status: 201 },
      ),
    );

    const session = await createDiditSession({
      userId: "99999999-8888-4777-8666-555555555555",
      callbackUrl: "https://agentpay.example/api/identity-verification/return",
    });

    expect(session.url).toBe("https://verify.didit.me/session/token");
    expect(session.session_kind).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://verification.didit.me/v3/session/");
    expect(init?.headers).toMatchObject({ "x-api-key": "didit-test-key" });
    expect(init?.body).not.toContain("didit-test-key");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      workflow_id: DIDIT_FREE_KYC_WORKFLOW_ID,
      vendor_data: "99999999-8888-4777-8666-555555555555",
      callback_method: "both",
    });
  });

  it("rejects a response bound to a different user", async () => {
    process.env.DIDIT_API_KEY = "didit-test-key";
    process.env.DIDIT_WEBHOOK_SECRET = "webhook-test-secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        session_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        session_kind: "user",
        url: "https://verify.didit.me/session/token",
        status: "Not Started",
        workflow_id: DIDIT_FREE_KYC_WORKFLOW_ID,
        vendor_data: "another-user",
      }),
    );

    await expect(
      createDiditSession({
        userId: "99999999-8888-4777-8666-555555555555",
        callbackUrl: "https://agentpay.example/api/identity-verification/return",
      }),
    ).rejects.toThrow("invalid verification session");
  });

  it("rejects a business session from a misconfigured workflow", async () => {
    process.env.DIDIT_API_KEY = "didit-test-key";
    process.env.DIDIT_WEBHOOK_SECRET = "webhook-test-secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        session_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        session_kind: "business",
        url: "https://verify.didit.me/session/token",
        status: "Not Started",
        workflow_id: DIDIT_FREE_KYC_WORKFLOW_ID,
        vendor_data: "99999999-8888-4777-8666-555555555555",
      }),
    );

    await expect(
      createDiditSession({
        userId: "99999999-8888-4777-8666-555555555555",
        callbackUrl: "https://agentpay.example/api/identity-verification/return",
      }),
    ).rejects.toThrow("invalid verification session");
  });
});

describe("Didit webhook verification", () => {
  const secret = "destination-secret";
  const now = 1_774_970_000;
  const body = {
    webhook_type: "status.updated",
    status: "Approved",
    session_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    timestamp: now,
    metadata: { name: "José", empty: {} },
  };

  it("reproduces Didit's sorted, compact, Unicode-preserved v2 signature", () => {
    const canonical = diditCanonicalJson(body);
    const signature = createHmac("sha256", secret).update(canonical, "utf8").digest("hex");

    expect(canonical).toContain("José");
    expect(verifyDiditWebhook({
      rawBody: JSON.stringify(body, null, 2),
      body,
      timestamp: String(now),
      signatureV2: signature,
      signatureRaw: null,
      secret,
      nowSeconds: now,
    })).toBe("v2");
  });

  it("accepts the raw-body signature fallback and rejects stale deliveries", () => {
    const rawBody = JSON.stringify(body);
    const signature = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const input = {
      rawBody,
      body,
      timestamp: String(now),
      signatureV2: null,
      signatureRaw: signature,
      secret,
    };

    expect(verifyDiditWebhook({ ...input, nowSeconds: now })).toBe("raw");
    expect(verifyDiditWebhook({ ...input, nowSeconds: now + 301 })).toBeNull();
  });

  it("acknowledges signed Didit onboarding events that are not bound to an AgentPay user", async () => {
    process.env.DIDIT_API_KEY = "didit-test-key";
    process.env.DIDIT_WEBHOOK_SECRET = secret;
    const onboardingEvent = {
      event_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      webhook_type: "status.updated",
      timestamp: Math.floor(Date.now() / 1000),
      created_at: Math.floor(Date.now() / 1000),
      application_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      environment: "live",
      status: "Not Started",
      session_id: "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa",
      session_kind: "user",
      workflow_id: DIDIT_FREE_KYC_WORKFLOW_ID,
      vendor_data: "getting-started",
    };
    const signature = createHmac("sha256", secret)
      .update(diditCanonicalJson(onboardingEvent), "utf8")
      .digest("hex");
    const response = await diditWebhookPOST(new Request("https://agentpay.example/api/webhooks/didit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-v2": signature,
        "x-timestamp": String(onboardingEvent.timestamp),
      },
      body: JSON.stringify(onboardingEvent),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, ignored: true, reason: "unbound_vendor" });
  });
});

describe("Didit fraud gate", () => {
  it("requires both an approved session and a non-blocked entity", () => {
    const base = {
      session_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      status: "Approved" as const,
      workflow_id: "11111111-2222-4333-8444-555555555555",
      environment: "live" as const,
      created_at: "2026-08-30T00:00:00.000Z",
      updated_at: "2026-08-30T00:00:00.000Z",
      approved_at: "2026-08-30T00:00:00.000Z",
    };
    expect(isIdentityVerified({ ...base, entity_status: null })).toBe(true);
    expect(isIdentityVerified({ ...base, entity_status: "ACTIVE" })).toBe(true);
    expect(isIdentityVerified({ ...base, entity_status: "FLAGGED" })).toBe(false);
    expect(isIdentityVerified({ ...base, entity_status: "BLOCKED" })).toBe(false);
  });
});
