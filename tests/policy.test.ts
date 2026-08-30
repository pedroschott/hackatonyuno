import { describe, expect, it } from "vitest";

import type { CheckoutCart, RegistryMandate } from "@/lib/domain";
import { evaluatePolicy } from "@/lib/agentpay-policy";

const mandate: RegistryMandate = {
  mandate_id: "mnd_test",
  type: "intent",
  issuer: { user_id: "user" },
  agent: { agent_id: "agt_test", public_key: "public" },
  scope: { merchants: ["mrc_autoparts"], categories: ["tires"] },
  limits: {
    per_purchase_cents: 160_000,
    cumulative_cents: 400_000,
    max_uses: 3,
    period: "month",
    currency: "USD",
  },
  validity: {
    not_before: "2026-08-01T00:00:00.000Z",
    expires_at: "2026-09-01T00:00:00.000Z",
  },
  payment: { vault_card_id: "card" },
  authorization: {
    credential_id: "credential",
    mandate_hash: "hash",
    signed_at: "2026-08-29T12:00:00.000Z",
  },
  server_sig: "signature",
  status: "active",
  usage: { approved_uses: 0, cumulative_cents: 0 },
};

const cart: CheckoutCart = {
  mandate_id: mandate.mandate_id,
  merchant_id: "mrc_autoparts",
  product_id: "prd_standard_tires",
  category: "tires",
  amount_cents: 154_800,
  currency: "USD",
};

describe("evaluatePolicy", () => {
  it("approves a cart inside the mandate", () => {
    expect(evaluatePolicy(mandate, cart, new Date("2026-08-29T12:00:00Z"))).toEqual({
      decision: "approved",
      reason_code: null,
    });
  });

  it("stops at revocation before later policy checks", () => {
    const result = evaluatePolicy(
      { ...mandate, status: "revoked", scope: { merchants: [], categories: [] } },
      cart,
      new Date("2026-08-29T12:00:00Z"),
    );
    expect(result.reason_code).toBe("MANDATE_REVOKED");
  });

  it("escalates a per-purchase overage and accepts a scoped exception", () => {
    const premium = { ...cart, amount_cents: 172_000 };
    expect(evaluatePolicy(mandate, premium, new Date("2026-08-29T12:00:00Z")).decision).toBe(
      "escalated",
    );
    expect(
      evaluatePolicy(
        mandate,
        { ...premium, exception_id: "exc_approved" },
        new Date("2026-08-29T12:00:00Z"),
      ).decision,
    ).toBe("approved");
  });

  it("checks use and cumulative limits before the per-purchase limit", () => {
    const exhausted = {
      ...mandate,
      usage: { approved_uses: 3, cumulative_cents: 399_000 },
    };
    expect(
      evaluatePolicy(exhausted, { ...cart, amount_cents: 172_000 }, new Date("2026-08-29T12:00:00Z"))
        .reason_code,
    ).toBe("USES_EXCEEDED");
  });

  it("never compares amounts across currencies", () => {
    expect(
      evaluatePolicy(mandate, { ...cart, currency: "EUR" }, new Date("2026-08-29T12:00:00Z")),
    ).toEqual({ decision: "refused", reason_code: "CURRENCY_MISMATCH" });
  });
});
