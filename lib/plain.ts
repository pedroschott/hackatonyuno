// The vocabulary layer for the account holder's screens.
//
// The registry speaks in reason codes, payment tokens and canonical JSON. People do not.
// But the previous pass overcorrected: "who can spend" implied the agent holds money of
// its own. It does not. A mandate is a signed authorization on top of the account
// holder's own card — scope, limits and an expiry an agent must stay inside — so the
// screens say "mandate" and explain it, instead of hiding the only noun that is true.
//
// Everything the account holder reads goes through this file, so vocabulary stays
// consistent and no screen can quietly reintroduce a raw token or a reason code.

import type { Attempt, Merchant, ReasonCode } from "./types";

/** Why a purchase was refused, in one sentence that still names the rule that refused it. */
export const BLOCK_REASON: Record<ReasonCode, string> = {
  AGENT_SIGNATURE_INVALID: "The agent's request signature did not verify",
  MANDATE_SIGNATURE_INVALID: "The mandate signature did not verify",
  MANDATE_NOT_FOUND: "No mandate covers this purchase",
  MANDATE_REVOKED: "You revoked this mandate",
  MANDATE_EXPIRED: "The mandate had already expired",
  PAYMENT_METHOD_UNAVAILABLE: "The mandate's selected payment method is no longer available",
  MERCHANT_NOT_IN_SCOPE: "That store is outside the mandate's scope",
  CATEGORY_NOT_IN_SCOPE: "That category is outside the mandate's scope",
  CURRENCY_MISMATCH: "Wrong currency for this mandate",
  USES_EXCEEDED: "No purchases left on this mandate this month",
  CUMULATIVE_EXCEEDED: "The mandate's monthly limit was already used up",
  AMOUNT_EXCEEDS_LIMIT: "Over the mandate's per-purchase limit",
  EXCEPTION_INVALID: "Your one-time approval did not match this purchase",
};

export type Outcome = { tone: "success" | "danger" | "warn"; label: string; detail: string };

export function outcomeOf(attempt: Attempt): Outcome {
  if (attempt.decision === "approved")
    return {
      tone: "success",
      label: "Paid",
      detail: attempt.exception_id ? "You approved this one purchase" : "Within the mandate's limits",
    };
  if (attempt.decision === "escalated")
    return { tone: "warn", label: "Needs you", detail: "Over the mandate's per-purchase limit" };
  return {
    tone: "danger",
    label: "Refused",
    detail: attempt.reason_code ? BLOCK_REASON[attempt.reason_code] : "Outside the mandate",
  };
}

/**
 * A mandate id is long enough to be unreadable and short enough to be useful.
 * The prefix plus six characters is what a person needs to match a card on screen
 * against a line in the security log or a `get_mandate` response.
 */
export function mandateRef(id: string) {
  const [prefix, ...rest] = id.split("_");
  const body = rest.join("_");
  if (!body) return id.length > 10 ? `${id.slice(0, 10)}…` : id;
  return body.length > 6 ? `${prefix}_${body.slice(0, 6)}…` : id;
}

export function storeName(merchants: Merchant[], id: string) {
  return merchants.find((m) => m.id === id)?.name ?? id.replace(/^mrc_/, "");
}

export function storeNames(merchants: Merchant[], ids: string[]) {
  return list(ids.map((id) => storeName(merchants, id)));
}

/** "tires" and "accessories" are stored lowercase; sentences want them readable. */
export function itemKinds(categories: string[]) {
  return list(categories.map((c) => c.replace(/_/g, " ")));
}

export function list(values: string[]) {
  if (values.length === 0) return "anything";
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/** "Expires today" reads better than a timestamp for anything inside a week. */
export function endsIn(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "Expired";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `Expires in ${days} days`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 2) return `Expires in ${hours} hours`;
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  return `Expires in ${minutes} min`;
}

/** Friendly day label for grouping activity: Today / Yesterday / 12 March. */
export function dayLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

export function timeOfDay(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const AUDIT_SENTENCE: Record<string, string> = {
  "mandate.created": "An agent requested a mandate",
  "mandate.authorized": "You signed a mandate with your passkey",
  "mandate.activated": "The mandate became active",
  "mandate.declined": "You declined a mandate request",
  "mandate.revoked": "You revoked a mandate",
  "mandate.limits_updated": "A mandate limit was changed",
  "mandate.payment_method_updated": "The mandate's payment method was changed before signing",
  "attempt.approved": "A purchase was authorized",
  "attempt.refused": "A purchase was refused",
  "attempt.escalated": "A purchase was escalated for your approval",
  "payment.token_minted": "A single-use payment token was issued",
  "approval.requested": "A one-time approval was requested",
  "approval.approved": "You approved one purchase",
  "approval.denied": "You denied one purchase",
  "vault.card_added": "A payment method was added to the vault",
  "vault.card_defaulted": "A default payment method was selected",
  "vault.card_removed": "A payment method was removed from the vault",
  "account.profile_updated": "Account and delivery details were updated",
  "passkey.registered": "A passkey was registered on a device",
};

/** Reads an audit action as a sentence; unknown actions fall back to their own name. */
export function auditSentence(action: string) {
  return AUDIT_SENTENCE[action] ?? action.replace(/[._]/g, " ");
}
