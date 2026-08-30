import { describe, expect, it } from "vitest";

import {
  MAX_REVOCATION_WINDOW_MS,
  parseRevocationWindowMs,
} from "@/lib/server/checkout-flow";
import { latestHeldMandate } from "@/lib/engine";
import type { Mandate } from "@/lib/types";

describe("checkout revocation window", () => {
  it("defaults to no artificial delay", () => {
    expect(parseRevocationWindowMs(undefined)).toBe(0);
    expect(parseRevocationWindowMs(0)).toBe(0);
  });

  it("accepts only bounded integer delays", () => {
    expect(parseRevocationWindowMs(MAX_REVOCATION_WINDOW_MS)).toBe(
      MAX_REVOCATION_WINDOW_MS,
    );
    expect(parseRevocationWindowMs(-1)).toBeNull();
    expect(parseRevocationWindowMs(MAX_REVOCATION_WINDOW_MS + 1)).toBeNull();
    expect(parseRevocationWindowMs(1.5)).toBeNull();
    expect(parseRevocationWindowMs("8000")).toBeNull();
  });

  it("keeps the revoked mandate as the agent's held authority", () => {
    const latest: Mandate = {
      id: "mnd_latest",
      type: "intent",
      issuer: { user_id: "user_test", display_name: "Test user" },
      agent: { agent_id: "agent_test", public_key: "test-public-key" },
      scope: { merchants: ["merchant_test"], categories: ["tires"] },
      limits: {
        per_purchase_cents: 1000,
        cumulative_cents: 5000,
        max_uses: 5,
        period: "month",
        currency: "BRL",
      },
      validity: {
        not_before: "2026-08-01T00:00:00.000Z",
        expires_at: "2026-09-01T00:00:00.000Z",
      },
      payment: { vault_card_id: "card_test" },
      authorization: {
        method: "webauthn",
        webauthn_credential_id: "credential_test",
        assertion: "assertion_test",
        challenge: "challenge_test",
        signed_at: "2026-08-29T11:00:00.000Z",
      },
      status: "active",
      created_at: "2026-08-29T11:00:00.000Z",
    };
    const olderActive = {
      ...latest,
      id: "mnd_older_active",
      created_at: "2026-08-01T00:00:00.000Z",
    };
    const revoked = {
      ...latest,
      status: "revoked" as const,
      revoked_at: "2026-08-29T12:00:00.000Z",
    };

    expect(latestHeldMandate([revoked, olderActive])?.id).toBe(revoked.id);
  });
});
