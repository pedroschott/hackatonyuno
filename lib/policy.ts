// Policy engine — ordered, deterministic, reason-coded (spec §6).
// Pure function: no I/O. The same code moves into /api/checkout unchanged.

import type { Agent, Approval, Attempt, Check, Decision, Mandate, ReasonCode } from "./types";
import { sha256 } from "./hash";

export type CheckoutRequest = {
  agent_id: string;
  mandate_id: string | null;
  merchant_id: string;
  product_id: string;
  category: string;
  amount_cents: number;
  exception_id?: string;
  signature: {
    present: boolean;
    valid: boolean; // mock: Ed25519 verification result
    timestamp: number; // ms epoch
    nonce: string;
  };
};

export type PolicyContext = {
  now: number;
  agent?: Agent;
  mandate?: Mandate;
  approvedAttempts: Attempt[]; // approved attempts for this mandate in the current period
  usedNonces: Set<string>;
  approvals: Approval[];
};

export type PolicyResult = {
  decision: Decision;
  reason_code?: ReasonCode;
  checks: Check[];
  exception_used?: string;
  remaining?: { uses: number; cumulative_cents: number };
};

export const REASON_LABEL: Record<ReasonCode, string> = {
  AGENT_SIGNATURE_INVALID: "Agent signature invalid",
  MANDATE_SIGNATURE_INVALID: "Mandate signature invalid",
  MANDATE_NOT_FOUND: "Mandate not found",
  MANDATE_REVOKED: "Mandate revoked",
  MANDATE_EXPIRED: "Mandate expired",
  MERCHANT_NOT_IN_SCOPE: "Merchant not in scope",
  CATEGORY_NOT_IN_SCOPE: "Category not in scope",
  CURRENCY_MISMATCH: "Currency does not match the mandate",
  USES_EXCEEDED: "Max uses exceeded",
  CUMULATIVE_EXCEEDED: "Cumulative limit exceeded",
  AMOUNT_EXCEEDS_LIMIT: "Amount exceeds per-purchase limit",
  EXCEPTION_INVALID: "Exception not valid for this cart",
};

export const REASON_RULE: Record<ReasonCode, number> = {
  AGENT_SIGNATURE_INVALID: 1,
  MANDATE_SIGNATURE_INVALID: 2,
  MANDATE_NOT_FOUND: 2,
  MANDATE_REVOKED: 3,
  MANDATE_EXPIRED: 4,
  MERCHANT_NOT_IN_SCOPE: 5,
  CATEGORY_NOT_IN_SCOPE: 6,
  CURRENCY_MISMATCH: 6,
  USES_EXCEEDED: 7,
  CUMULATIVE_EXCEEDED: 8,
  AMOUNT_EXCEEDS_LIMIT: 9,
  EXCEPTION_INVALID: 9,
};

export function cartHash(req: Pick<CheckoutRequest, "merchant_id" | "product_id" | "amount_cents">) {
  return sha256(`${req.merchant_id}|${req.product_id}|${req.amount_cents}`);
}

const SIGNATURE_MAX_AGE_MS = 60_000;

export function evaluate(req: CheckoutRequest, ctx: PolicyContext): PolicyResult {
  const checks: Check[] = [];
  const fail = (code: ReasonCode, detail: string, at: Check["id"]): PolicyResult => {
    checks.push({ id: at, label: LABELS[at], status: "fail", detail });
    // remaining checks are skipped (stop at first failure)
    for (const id of ORDER.slice(ORDER.indexOf(at) + 1)) checks.push({ id, label: LABELS[id], status: "skip" });
    return { decision: "refused", reason_code: code, checks };
  };

  // 1. Agent identity — offline check (Ed25519 over method|path|sha256(body)|timestamp|nonce)
  if (!req.signature.present) return fail("AGENT_SIGNATURE_INVALID", "X-Signature header missing", "agent_signature");
  if (!ctx.agent) return fail("AGENT_SIGNATURE_INVALID", `Unknown agent ${req.agent_id}`, "agent_signature");
  if (!req.signature.valid) return fail("AGENT_SIGNATURE_INVALID", "Signature does not verify against registry public key", "agent_signature");
  if (Math.abs(ctx.now - req.signature.timestamp) > SIGNATURE_MAX_AGE_MS)
    return fail("AGENT_SIGNATURE_INVALID", "Timestamp older than 60s", "agent_signature");
  if (ctx.usedNonces.has(req.signature.nonce))
    return fail("AGENT_SIGNATURE_INVALID", `Nonce ${req.signature.nonce} already seen (replay)`, "agent_signature");
  checks.push({ id: "agent_signature", label: LABELS.agent_signature, status: "pass", detail: `Ed25519 · ${ctx.agent.id}` });

  // 2. Mandate exists + authenticity — offline check
  const m = ctx.mandate;
  if (!req.mandate_id || !m) return fail("MANDATE_NOT_FOUND", `No mandate ${req.mandate_id ?? ""}`.trim(), "mandate_signature");
  if (!m.authorization || !m.server_sig) return fail("MANDATE_NOT_FOUND", "Mandate was never authorized", "mandate_signature");
  if (m.agent.agent_id !== req.agent_id) return fail("MANDATE_NOT_FOUND", "Mandate issued to a different agent", "mandate_signature");
  checks.push({ id: "mandate_signature", label: LABELS.mandate_signature, status: "pass", detail: `passkey ${m.authorization.method} · registry co-sig` });

  // 3–4. Liveness — the live registry read. THE kill switch.
  if (m.status === "revoked") return fail("MANDATE_REVOKED", `Revoked ${m.revoked_at ? "at " + m.revoked_at : ""}`.trim(), "registry_status");
  if (m.status !== "active") return fail("MANDATE_NOT_FOUND", `Mandate status is ${m.status}`, "registry_status");
  if (ctx.now > new Date(m.validity.expires_at).getTime()) return fail("MANDATE_EXPIRED", `Expired ${m.validity.expires_at}`, "registry_status");
  if (ctx.now < new Date(m.validity.not_before).getTime()) return fail("MANDATE_EXPIRED", "Not yet valid", "registry_status");
  checks.push({ id: "registry_status", label: LABELS.registry_status, status: "pass", detail: "status: active" });

  // 5–9. Policy — scope ∧ limit ∧ expiry ∧ uses
  if (!m.scope.merchants.includes(req.merchant_id))
    return fail("MERCHANT_NOT_IN_SCOPE", `${req.merchant_id} ∉ ${m.scope.merchants.join(", ")}`, "policy");
  if (!m.scope.categories.includes(req.category))
    return fail("CATEGORY_NOT_IN_SCOPE", `${req.category} ∉ ${m.scope.categories.join(", ")}`, "policy");

  const uses = ctx.approvedAttempts.length;
  const spent = ctx.approvedAttempts.reduce((s, a) => s + a.amount_cents, 0);
  if (uses >= m.limits.max_uses)
    return fail("USES_EXCEEDED", `${uses}/${m.limits.max_uses} uses this ${m.limits.period}`, "policy");
  if (spent + req.amount_cents > m.limits.cumulative_cents)
    return fail("CUMULATIVE_EXCEEDED", `${spent + req.amount_cents} > ${m.limits.cumulative_cents} cumulative`, "policy");

  const remaining = { uses: m.limits.max_uses - uses - 1, cumulative_cents: m.limits.cumulative_cents - spent - req.amount_cents };

  if (req.amount_cents > m.limits.per_purchase_cents) {
    // Rule 9 — escalate, unless the agent carries a valid one-time exception bound to this exact cart.
    const hash = cartHash(req);
    if (req.exception_id) {
      const ap = ctx.approvals.find((a) => a.exception_id === req.exception_id);
      if (!ap || ap.status !== "approved" || ap.consumed || ap.cart_hash !== hash)
        return fail("EXCEPTION_INVALID", "Exception missing, consumed, or bound to a different cart", "policy");
      checks.push({ id: "policy", label: LABELS.policy, status: "pass", detail: `over limit · one-time exception ${ap.exception_id}` });
      return { decision: "approved", checks, exception_used: ap.exception_id, remaining };
    }
    checks.push({ id: "policy", label: LABELS.policy, status: "fail", detail: `${req.amount_cents} > ${m.limits.per_purchase_cents} per purchase → human approval` });
    return { decision: "escalated", reason_code: "AMOUNT_EXCEEDS_LIMIT", checks };
  }

  checks.push({ id: "policy", label: LABELS.policy, status: "pass", detail: "scope ∧ limit ∧ expiry ∧ uses" });
  return { decision: "approved", checks, remaining };
}

const ORDER: Check["id"][] = ["agent_signature", "mandate_signature", "registry_status", "policy"];
const LABELS: Record<Check["id"], string> = {
  agent_signature: "Agent signature",
  mandate_signature: "Mandate signature",
  registry_status: "Registry status",
  policy: "Policy engine",
};
export const CHECK_ORDER = ORDER;
