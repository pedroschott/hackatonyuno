import type { Attempt, Mandate } from "@/lib/types";

export function selectPaymentCard<T extends { id: string; is_default: boolean }>(
  cards: T[],
  explicitCardId?: string,
): T | null {
  if (explicitCardId) return cards.find((card) => card.id === explicitCardId) ?? null;
  return cards.find((card) => card.is_default) ?? cards[0] ?? null;
}

export function cardUsageFor(
  cardId: string,
  mandates: Pick<Mandate, "id" | "status" | "payment">[],
  attempts: Pick<Attempt, "mandate_id" | "decision" | "created_at">[],
) {
  const linkedMandates = mandates.filter((mandate) => mandate.payment.vault_card_id === cardId);
  const mandateIds = new Set(linkedMandates.map((mandate) => mandate.id));
  const successfulAttempts = attempts.filter(
    (attempt) =>
      attempt.decision === "approved" &&
      attempt.mandate_id !== null &&
      mandateIds.has(attempt.mandate_id),
  );
  return {
    successfulPurchases: successfulAttempts.length,
    lastUsedAt: successfulAttempts[0]?.created_at,
    liveMandates: linkedMandates.filter(
      (mandate) => mandate.status === "draft" || mandate.status === "active",
    ).length,
  };
}
