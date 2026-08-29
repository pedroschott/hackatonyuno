import type { CheckoutCart, PolicyDecision, RegistryMandate } from "@/lib/domain";

export function evaluatePolicy(
  mandate: RegistryMandate | null,
  cart: CheckoutCart,
  now = new Date(),
): PolicyDecision {
  if (!mandate) {
    return { decision: "refused", reason_code: "MANDATE_NOT_FOUND" };
  }

  if (mandate.status === "revoked") {
    return { decision: "refused", reason_code: "MANDATE_REVOKED" };
  }

  if (
    mandate.status !== "active" ||
    now < new Date(mandate.validity.not_before) ||
    now > new Date(mandate.validity.expires_at)
  ) {
    return { decision: "refused", reason_code: "MANDATE_EXPIRED" };
  }

  if (!mandate.scope.merchants.includes(cart.merchant_id)) {
    return { decision: "refused", reason_code: "MERCHANT_NOT_IN_SCOPE" };
  }

  if (!mandate.scope.categories.includes(cart.category)) {
    return { decision: "refused", reason_code: "CATEGORY_NOT_IN_SCOPE" };
  }

  if (cart.currency !== mandate.limits.currency) {
    return { decision: "refused", reason_code: "CURRENCY_MISMATCH" };
  }

  if (mandate.usage.approved_uses >= mandate.limits.max_uses) {
    return { decision: "refused", reason_code: "USES_EXCEEDED" };
  }

  if (mandate.usage.cumulative_cents + cart.amount_cents > mandate.limits.cumulative_cents) {
    return { decision: "refused", reason_code: "CUMULATIVE_EXCEEDED" };
  }

  if (cart.amount_cents > mandate.limits.per_purchase_cents && !cart.exception_id) {
    return { decision: "escalated", reason_code: "AMOUNT_EXCEEDS_LIMIT" };
  }

  return { decision: "approved", reason_code: null };
}
