import { describe, expect, it } from "vitest";

import {
  explainDecision,
  isMerchantId,
  mandateStateGuidance,
  normalizeCategories,
  validateCategories,
} from "@/lib/mcp/guidance";

describe("mandate scope validation", () => {
  it("accepts exact merchant ids and rejects names or URLs", () => {
    expect(isMerchantId("mrc_autoparts")).toBe(true);
    expect(isMerchantId("mrc_835dda9e14b9709870f2")).toBe(true);
    expect(isMerchantId("AutoParts")).toBe(false);
    expect(isMerchantId("https://partsroute.example")).toBe(false);
  });

  it("normalizes categories to the merchant's slug vocabulary", () => {
    expect(normalizeCategories([" Tires", "tires", "ACCESSORIES"])).toEqual(["tires", "accessories"]);
  });

  it("rejects a category the merchant does not sell and names the valid ones", () => {
    expect(() => validateCategories(["Wheels"], ["tires", "accessories"], "AutoParts")).toThrow(
      /does not sell the category "wheels".*tires, accessories/,
    );
    expect(validateCategories(["Tires"], ["tires", "accessories"], "AutoParts")).toEqual(["tires"]);
  });

  it("accepts any category when the merchant declares no vocabulary", () => {
    expect(validateCategories(["brakes"], undefined, "Legacy Store")).toEqual(["brakes"]);
  });
});

describe("decision guidance", () => {
  it("routes an escalation to the approval link and a retry with the exception id", () => {
    const guidance = explainDecision("escalated", "AMOUNT_EXCEEDS_LIMIT", {
      amountCents: 172_000,
      perPurchaseCents: 160_000,
      approvalId: "8b1d4f3a-9c5e-4a1b-8d5f-70910f2a4c6e",
      approvalUrl: "https://agentpay.example/m/approvals/8b1d4f3a-9c5e-4a1b-8d5f-70910f2a4c6e",
    });
    expect(guidance.next_tool).toBe("purchase");
    expect(guidance.retry_same_purchase).toBe(true);
    expect(guidance.remedy).toContain("/m/approvals/");
    expect(guidance.remedy).toContain("Do not revoke");
  });

  it("routes scope refusals to amend_mandate instead of revoke", () => {
    expect(explainDecision("refused", "MERCHANT_NOT_IN_SCOPE", { merchantId: "mrc_x" }).next_tool).toBe("amend_mandate");
    expect(explainDecision("refused", "CATEGORY_NOT_IN_SCOPE", { category: "tires" }).remedy).toContain('add_categories: ["tires"]');
  });

  it("tells the agent to stop after a revocation", () => {
    const guidance = explainDecision("refused", "MANDATE_REVOKED");
    expect(guidance.next_tool).toBeNull();
    expect(guidance.retry_same_purchase).toBe(false);
  });

  it("explains a draft mandate without suggesting a new one", () => {
    const state = mandateStateGuidance("draft", { authorizationUrl: "https://agentpay.example/m/mandates/1" });
    expect(state.can_purchase).toBe(false);
    expect(state.next_step).toContain("Do not create another mandate");
    expect(mandateStateGuidance("active").can_purchase).toBe(true);
  });
});
