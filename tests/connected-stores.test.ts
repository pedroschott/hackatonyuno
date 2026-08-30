import { describe, expect, it } from "vitest";

import {
  DEFAULT_STORES,
  getCompatibilityStatus,
  type SafeMerchant,
} from "@/components/dashboard/ConnectedStores";
import { SAFE_MERCHANT_DIRECTORY } from "@/app/api/merchant-directory/route";
import type { Mandate } from "@/lib/types";

const mockMandate: Mandate = {
  id: "mnd_test_1",
  type: "intent",
  issuer: { user_id: "u_cfo", display_name: "CFO" },
  agent: { agent_id: "agt_fleetbuyer", public_key: "key" },
  scope: {
    merchants: ["mrc_autoparts"],
    categories: ["automotive.tires", "automotive.accessories"],
  },
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
  payment: { vault_card_id: "card_9281" },
  status: "active",
  created_at: "2026-08-01T00:00:00.000Z",
};

describe("ConnectedStores & Merchant Directory", () => {
  it("contains all 4 active interactive stores and no inactive attack fixtures in safe directory", () => {
    expect(SAFE_MERCHANT_DIRECTORY.map((m) => m.id)).toEqual([
      "mrc_autoparts",
      "mrc_harvest_market",
      "mrc_city_basket",
      "mrc_mare_botanicals",
    ]);

    expect(DEFAULT_STORES.map((s) => s.id)).toEqual([
      "mrc_autoparts",
      "mrc_harvest_market",
      "mrc_city_basket",
      "mrc_mare_botanicals",
    ]);

    // PneuFast is filtered out
    expect(SAFE_MERCHANT_DIRECTORY.find((m) => m.id === "mrc_pneufast")).toBeUndefined();
    expect(DEFAULT_STORES.find((m) => m.id === "mrc_pneufast")).toBeUndefined();

    // Verify no private JWKs, trust tiers, or vault secrets are present in safe directory
    for (const merchant of SAFE_MERCHANT_DIRECTORY) {
      const raw = merchant as unknown as Record<string, unknown>;
      expect(raw.signing_public_jwk).toBeUndefined();
      expect(raw.signingPublicJwk).toBeUndefined();
      expect(raw.trust_tier).toBeUndefined();
      expect(raw.trustTier).toBeUndefined();
      expect(raw.vault_token).toBeUndefined();
    }
  });

  it("calculates 'covered' when merchant and categories are in scope", () => {
    const autoparts = DEFAULT_STORES.find((s) => s.id === "mrc_autoparts")!;
    const compat = getCompatibilityStatus(autoparts, mockMandate);
    expect(compat).toEqual({
      status: "covered",
      tone: "success",
      label: "In scope",
    });
  });

  it("calculates 'outside scope' when merchant and categories are not in mandate", () => {
    const harvest = DEFAULT_STORES.find((s) => s.id === "mrc_harvest_market")!;
    const compat = getCompatibilityStatus(harvest, mockMandate);
    expect(compat).toEqual({
      status: "outside_scope",
      tone: "neutral",
      label: "Outside scope",
    });
  });

  it("calculates 'requires approval' when partially covered (merchant in scope but categories not matching)", () => {
    const partialMandate: Mandate = {
      ...mockMandate,
      scope: {
        merchants: ["mrc_harvest_market"],
        categories: ["automotive.tires"],
      },
    };
    const harvest = DEFAULT_STORES.find((s) => s.id === "mrc_harvest_market")!;
    const compat = getCompatibilityStatus(harvest, partialMandate);
    expect(compat).toEqual({
      status: "requires_approval",
      tone: "warn",
      label: "Approval required",
    });
  });

  it("calculates 'outside scope' when there is no active mandate", () => {
    const autoparts = DEFAULT_STORES.find((s) => s.id === "mrc_autoparts")!;
    expect(getCompatibilityStatus(autoparts, null)).toEqual({
      status: "outside_scope",
      tone: "neutral",
      label: "Outside scope",
    });

    expect(getCompatibilityStatus(autoparts, { ...mockMandate, status: "revoked" })).toEqual({
      status: "outside_scope",
      tone: "neutral",
      label: "Outside scope",
    });
  });
});
