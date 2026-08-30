import { describe, expect, it } from "vitest";

import { cardUsageFor, selectPaymentCard } from "@/lib/cards";
import type { Attempt, Mandate } from "@/lib/types";

describe("payment card selection", () => {
  const cards = [
    { id: "card-old", is_default: false },
    { id: "card-default", is_default: true },
  ];

  it("uses the account default when the agent does not choose a card", () => {
    expect(selectPaymentCard(cards)?.id).toBe("card-default");
  });

  it("honors an explicit card without changing the account default", () => {
    expect(selectPaymentCard(cards, "card-old")?.id).toBe("card-old");
    expect(selectPaymentCard(cards, "missing")).toBeNull();
  });
});

describe("payment card usage", () => {
  it("links successful purchases and live mandates to the signed card choice", () => {
    const mandates = [
      { id: "m1", status: "active", payment: { vault_card_id: "card-a" } },
      { id: "m2", status: "revoked", payment: { vault_card_id: "card-a" } },
      { id: "m3", status: "draft", payment: { vault_card_id: "card-b" } },
    ] as Mandate[];
    const attempts = [
      { mandate_id: "m2", decision: "approved", created_at: "2026-08-29T12:00:00.000Z" },
      { mandate_id: "m1", decision: "refused", created_at: "2026-08-29T11:00:00.000Z" },
    ] as Attempt[];

    expect(cardUsageFor("card-a", mandates, attempts)).toEqual({
      successfulPurchases: 1,
      lastUsedAt: "2026-08-29T12:00:00.000Z",
      liveMandates: 1,
    });
  });
});
