// Plain-language layer for the consumer app.
//
// The registry speaks in reason codes, mandate ids and payment tokens. People do not.
// Everything the account holder sees goes through this file, so the screens stay short
// sentences instead of protocol vocabulary. The technical vocabulary is still available
// on the merchant checkout view and the security log.

import type { Attempt, Merchant, ReasonCode } from "./types";

/** Why a purchase was stopped, said the way the person who set the limit would say it. */
export const BLOCK_REASON: Record<ReasonCode, string> = {
  AGENT_SIGNATURE_INVALID: "We could not confirm this was your agent",
  MANDATE_SIGNATURE_INVALID: "This permission could not be verified",
  MANDATE_NOT_FOUND: "This agent has no permission to spend",
  MANDATE_REVOKED: "You turned this agent off",
  MANDATE_EXPIRED: "The permission had already ended",
  MERCHANT_NOT_IN_SCOPE: "That store is not on your list",
  CATEGORY_NOT_IN_SCOPE: "That kind of item is not on your list",
  CURRENCY_MISMATCH: "Wrong currency for this permission",
  USES_EXCEEDED: "No purchases left this month",
  CUMULATIVE_EXCEEDED: "The monthly budget was already used up",
  AMOUNT_EXCEEDS_LIMIT: "Over your per-purchase limit",
  EXCEPTION_INVALID: "Your approval did not match this purchase",
};

export type Outcome = { tone: "success" | "danger" | "warn"; label: string; detail: string };

export function outcomeOf(attempt: Attempt): Outcome {
  if (attempt.decision === "approved")
    return {
      tone: "success",
      label: "Paid",
      detail: attempt.exception_id ? "You approved this one" : "Inside the limits you set",
    };
  if (attempt.decision === "escalated")
    return { tone: "warn", label: "Waiting for you", detail: "Over your per-purchase limit" };
  return {
    tone: "danger",
    label: "Blocked",
    detail: attempt.reason_code ? BLOCK_REASON[attempt.reason_code] : "Outside your limits",
  };
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

/** "Ends today" reads better than a timestamp for anything inside a week. */
export function endsIn(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "Ended";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `Ends in ${days} days`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 2) return `Ends in ${hours} hours`;
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  return `Ends in ${minutes} min`;
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
  "mandate.created": "An agent asked for permission to spend",
  "mandate.authorized": "You allowed an agent to spend",
  "mandate.activated": "The permission became active",
  "mandate.declined": "You turned down a request",
  "mandate.revoked": "You turned off an agent's spending",
  "mandate.limits_updated": "A spending limit was changed",
  "attempt.approved": "A purchase went through",
  "attempt.refused": "A purchase was blocked",
  "attempt.escalated": "A purchase was held for your approval",
  "payment.token_minted": "A single-use payment code was issued",
  "approval.requested": "Your approval was requested",
  "approval.approved": "You approved one purchase",
  "approval.denied": "You declined one purchase",
  "vault.card_added": "A payment method was added",
  "passkey.registered": "A passkey was set up on a device",
};

/** Reads an audit action as a sentence; unknown actions fall back to their own name. */
export function auditSentence(action: string) {
  return AUDIT_SENTENCE[action] ?? action.replace(/[._]/g, " ");
}
