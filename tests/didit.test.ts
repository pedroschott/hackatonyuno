import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  canonicalDiditWebhookPayload,
  diditVendorData,
  verifyDiditWebhookSignature,
} from "@/lib/didit";

const secret = "test-didit-webhook-secret";
const now = 1_800_000_000_000;

function signature(payload: unknown) {
  return crypto
    .createHmac("sha256", secret)
    .update(canonicalDiditWebhookPayload(payload), "utf8")
    .digest("hex");
}

describe("Didit webhook verification", () => {
  const payload = {
    status: "Approved",
    event_id: "627afc38-0071-4e5a-bce1-41d76d31b1af",
    metadata: { z: true, a: [3, { b: "value", a: 1 }] },
  };

  it("sorts keys recursively while preserving array order", () => {
    expect(canonicalDiditWebhookPayload(payload)).toBe(
      '{"event_id":"627afc38-0071-4e5a-bce1-41d76d31b1af","metadata":{"a":[3,{"a":1,"b":"value"}],"z":true},"status":"Approved"}',
    );
  });

  it("accepts a fresh V2 HMAC signature", () => {
    expect(
      verifyDiditWebhookSignature({
        payload,
        signature: signature(payload),
        timestamp: now / 1000,
        secret,
        now,
      }),
    ).toBe(true);
  });

  it("rejects stale and altered deliveries", () => {
    expect(
      verifyDiditWebhookSignature({
        payload,
        signature: signature(payload),
        timestamp: now / 1000 - 301,
        secret,
        now,
      }),
    ).toBe(false);
    expect(
      verifyDiditWebhookSignature({
        payload: { ...payload, status: "Declined" },
        signature: signature(payload),
        timestamp: now / 1000,
        secret,
        now,
      }),
    ).toBe(false);
  });
});

describe("Didit session identity", () => {
  it("uses the authenticated user ID as stable opaque vendor data", () => {
    expect(diditVendorData("627afc38-0071-4e5a-bce1-41d76d31b1af")).toBe(
      "agentpay:627afc38-0071-4e5a-bce1-41d76d31b1af",
    );
  });
});
