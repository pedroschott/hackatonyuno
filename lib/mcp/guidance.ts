/**
 * Turns registry vocabulary into instructions an agent can act on without
 * guessing. Every refusal names the rule that failed, what fixes it, and which
 * tool to call next, so a scope mistake is corrected with one amendment instead
 * of a revoke-and-retry loop.
 */
import type { MandateLimits, MandateScope, MandateValidity } from "@/lib/domain";

export type NextTool =
  | "get_account"
  | "get_payment_setup_link"
  | "find_products"
  | "create_mandate"
  | "amend_mandate"
  | "get_mandate"
  | "check_purchase"
  | "purchase"
  | null;

export type DecisionGuidance = {
  explanation: string;
  remedy: string;
  next_tool: NextTool;
  /** True when the same purchase can succeed after the remedy without changing its arguments. */
  retry_same_purchase: boolean;
};

export type GuidanceContext = {
  mandateId?: string;
  merchantId?: string;
  merchantName?: string;
  category?: string;
  scopeMerchants?: string[];
  scopeCategories?: string[];
  amountCents?: number;
  currency?: string;
  mandateCurrency?: string;
  perPurchaseCents?: number;
  cumulativeRemainingCents?: number;
  usesRemaining?: number;
  approvalId?: string;
  approvalUrl?: string;
  authorizationUrl?: string;
};

export const MERCHANT_ID_PATTERN = /^mrc_[a-z0-9_-]+$/i;

export function isMerchantId(value: string): boolean {
  return MERCHANT_ID_PATTERN.test(value);
}

export function normalizeCategories(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)));
}

/**
 * Rejects a mandate scope that the merchant could never satisfy, before the
 * user is asked to sign it. `allowed` is the merchant's declared vocabulary;
 * when the merchant declares none, every category is accepted verbatim.
 */
export function validateCategories(
  requested: string[],
  allowed: string[] | undefined,
  merchantName: string,
): string[] {
  const categories = normalizeCategories(requested);
  if (categories.length === 0) throw new Error("At least one category is required");
  if (!allowed || allowed.length === 0) return categories;
  const vocabulary = new Set(normalizeCategories(allowed));
  const unknown = categories.filter((category) => !vocabulary.has(category));
  if (unknown.length > 0) {
    throw new Error(
      `${merchantName} does not sell the category ${unknown.map((value) => `"${value}"`).join(", ")}. ` +
        `Use exact values from its catalog: ${Array.from(vocabulary).join(", ")}.`,
    );
  }
  return categories;
}

export function formatMoney(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function describeMandate(scope: MandateScope, limits: MandateLimits, validity: MandateValidity): string {
  const currency = limits.currency;
  return (
    `${scope.categories.join(", ")} at ${scope.merchants.join(", ")}; ` +
    `up to ${formatMoney(limits.per_purchase_cents, currency)} per purchase, ` +
    `${formatMoney(limits.cumulative_cents, currency)} in total across ${limits.max_uses} purchase(s), ` +
    `until ${validity.expires_at}`
  );
}

export function mandateStateGuidance(
  status: string,
  context: GuidanceContext = {},
): { can_purchase: boolean; next_step: string; next_tool: NextTool } {
  switch (status) {
    case "draft":
      return {
        can_purchase: false,
        next_step: `The user has not signed this mandate yet. Ask them to open ${context.authorizationUrl ?? "the authorization link"} and approve it with their passkey, then call get_mandate again. Do not create another mandate for the same request.`,
        next_tool: "get_mandate",
      };
    case "active":
      return {
        can_purchase: true,
        next_step: "The mandate is active. Call check_purchase to confirm a product fits its scope and limits, then purchase.",
        next_tool: "check_purchase",
      };
    case "revoked":
      return {
        can_purchase: false,
        next_step: "The user revoked this mandate. Stop purchasing under it. Only create a new mandate if the user explicitly asks for one.",
        next_tool: null,
      };
    case "expired":
      return {
        can_purchase: false,
        next_step: "This mandate expired. Call amend_mandate with a new expiry to propose a replacement for the user to sign.",
        next_tool: "amend_mandate",
      };
    case "declined":
      return {
        can_purchase: false,
        next_step: "The user declined this mandate. Ask what they would accept before proposing another.",
        next_tool: null,
      };
    default:
      return { can_purchase: false, next_step: `Mandate status is ${status}.`, next_tool: "get_mandate" };
  }
}

export function explainDecision(
  decision: "approved" | "escalated" | "refused",
  reasonCode: string | null | undefined,
  context: GuidanceContext = {},
): DecisionGuidance {
  const currency = context.mandateCurrency ?? context.currency ?? "USD";
  const amount = typeof context.amountCents === "number" ? formatMoney(context.amountCents, currency) : "the amount";
  if (decision === "approved") {
    return {
      explanation: "The purchase was inside the mandate's scope and limits and the merchant verified the signed request.",
      remedy: "Nothing to fix. Report the order to the user.",
      next_tool: null,
      retry_same_purchase: false,
    };
  }
  switch (reasonCode) {
    case "AMOUNT_EXCEEDS_LIMIT":
      return {
        explanation: `${amount} is above the mandate's per-purchase limit of ${
          typeof context.perPurchaseCents === "number" ? formatMoney(context.perPurchaseCents, currency) : "the limit"
        }. Nothing was charged; the purchase is held for a one-time approval.`,
        remedy: `Ask the user to approve this single purchase at ${context.approvalUrl ?? "the approval link"}. Then call purchase again with exception_id "${context.approvalId ?? "<approval_id>"}". Do not revoke or recreate the mandate.`,
        next_tool: "purchase",
        retry_same_purchase: true,
      };
    case "MERCHANT_NOT_IN_SCOPE":
      return {
        explanation: `The mandate covers ${context.scopeMerchants?.join(", ") ?? "other merchants"}, not ${context.merchantName ?? context.merchantId ?? "this merchant"} (${context.merchantId ?? "unknown id"}).`,
        remedy: "Call amend_mandate with add_merchant_urls set to this store's URL. The user signs the replacement once; the old mandate is retired automatically.",
        next_tool: "amend_mandate",
        retry_same_purchase: false,
      };
    case "CATEGORY_NOT_IN_SCOPE":
      return {
        explanation: `This product is in the category "${context.category ?? "unknown"}", but the mandate only covers ${context.scopeCategories?.join(", ") ?? "other categories"}.`,
        remedy: `Call amend_mandate with add_categories: ["${context.category ?? "<category>"}"] and ask the user to sign the replacement.`,
        next_tool: "amend_mandate",
        retry_same_purchase: false,
      };
    case "CURRENCY_MISMATCH":
      return {
        explanation: `The merchant quotes ${context.currency ?? "another currency"} but the mandate is denominated in ${context.mandateCurrency ?? "a different currency"}. AgentPay never converts.`,
        remedy: "Choose a merchant that quotes the mandate's currency. Mandates are always created in USD in this deployment.",
        next_tool: "find_products",
        retry_same_purchase: false,
      };
    case "USES_EXCEEDED":
      return {
        explanation: "Every purchase the user allowed under this mandate has already been made.",
        remedy: "Only if the user wants more purchases: call amend_mandate with a higher max_uses and ask them to sign it.",
        next_tool: "amend_mandate",
        retry_same_purchase: false,
      };
    case "CUMULATIVE_EXCEEDED":
      return {
        explanation: `${amount} would push the mandate past its monthly total. ${
          typeof context.cumulativeRemainingCents === "number"
            ? `${formatMoney(context.cumulativeRemainingCents, currency)} remains.`
            : ""
        }`.trim(),
        remedy: "Pick a cheaper product with find_products (max_price_cents), or call amend_mandate with a higher cumulative_cents for the user to sign.",
        next_tool: "find_products",
        retry_same_purchase: false,
      };
    case "MANDATE_REVOKED":
      return {
        explanation: "The user revoked this mandate. It can never approve a purchase again.",
        remedy: "Stop. Do not retry and do not create a replacement unless the user explicitly asks.",
        next_tool: null,
        retry_same_purchase: false,
      };
    case "MANDATE_EXPIRED":
      return {
        explanation: "The mandate is outside its validity window or was never signed.",
        remedy: "Call get_mandate. A draft needs the user's passkey; an expired mandate needs amend_mandate with a new expiry.",
        next_tool: "get_mandate",
        retry_same_purchase: false,
      };
    case "MANDATE_DRAFT":
      return {
        explanation: "The mandate exists but the user has not signed it with their passkey yet.",
        remedy: `Ask the user to approve it at ${context.authorizationUrl ?? "the authorization link"}, then call get_mandate until it reports active. Do not create another mandate.`,
        next_tool: "get_mandate",
        retry_same_purchase: true,
      };
    case "MANDATE_NOT_FOUND":
      return {
        explanation: "No mandate with that id belongs to this account.",
        remedy: "Call get_account to list mandates, or create_mandate for a new one.",
        next_tool: "get_account",
        retry_same_purchase: false,
      };
    case "PAYMENT_METHOD_UNAVAILABLE":
      return {
        explanation: "The card signed into this mandate is no longer available on the account.",
        remedy: "Call get_payment_setup_link if no card is saved, then amend_mandate to bind a saved card.",
        next_tool: "get_account",
        retry_same_purchase: false,
      };
    case "EXCEPTION_INVALID":
      return {
        explanation: "The exception_id does not match this exact product, merchant and amount, or was already consumed.",
        remedy: "Call purchase again without exception_id to obtain a fresh approval request for this cart.",
        next_tool: "purchase",
        retry_same_purchase: false,
      };
    case "AGENT_SIGNATURE_INVALID":
      return {
        explanation: "The merchant could not verify the signed request: clock skew, a reused nonce, or a proxy that rewrote the request.",
        remedy: "Call purchase once more; AgentPay signs a fresh request each time. If it persists, the merchant's checkout route is misconfigured.",
        next_tool: "purchase",
        retry_same_purchase: true,
      };
    case "MANDATE_SIGNATURE_INVALID":
      return {
        explanation: "The merchant could not verify the registry's signature over this mandate for this agent.",
        remedy: "Call get_mandate to confirm the mandate is active and belongs to this agent. Never retry blindly.",
        next_tool: "get_mandate",
        retry_same_purchase: false,
      };
    case "PRODUCT_NOT_FOUND":
      return {
        explanation: "The merchant has no purchasable product with that id. Product ids are exact and never a name, SKU or URL slug.",
        remedy: "Call find_products on this store and use products[].product_id verbatim.",
        next_tool: "find_products",
        retry_same_purchase: false,
      };
    case "IDENTITY_VERIFICATION_REQUIRED":
      return {
        explanation: "The account holder has not completed identity verification, which gates every purchase.",
        remedy: "Call get_account and send the user to identity_verification.verification_url. Wait for them before purchasing.",
        next_tool: "get_account",
        retry_same_purchase: true,
      };
    case "SHIPPING_ADDRESS_REQUIRED":
      return {
        explanation:
          "The order has nowhere to go: the account's registered delivery address is incomplete and no ship_to was given. AgentPay holds the address so it never has to be collected in chat.",
        remedy:
          "Send the user to address_url to complete the missing fields listed in missing_address_fields, or call purchase again with a complete ship_to if they want this one order delivered elsewhere. Never ask them to dictate an address you then save.",
        next_tool: "get_account",
        retry_same_purchase: true,
      };
    case "SHIPPING_ADDRESS_UNSUPPORTED":
      return {
        explanation: "The store does not deliver to that address, so it declined to quote the order before any limit was spent.",
        remedy:
          "Tell the user where this store does deliver — merchant_ships_to lists the countries it accepts — and call purchase again with a ship_to it serves. Nothing was charged and no use was consumed.",
        next_tool: "purchase",
        retry_same_purchase: false,
      };
    default:
      return {
        explanation: `The purchase was ${decision}${reasonCode ? ` with reason ${reasonCode}` : ""}.`,
        remedy: "Call get_mandate to read the live mandate state before deciding what to do next.",
        next_tool: "get_mandate",
        retry_same_purchase: false,
      };
  }
}
