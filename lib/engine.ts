// Pure state transitions. No I/O, no React. Runs on the server (lib/server/db.ts) today;
// the same functions could run anywhere. Every function returns the next Data plus a result.

import type {
  Agent, Approval, Attempt, AuditEntry, Mandate, MandateLimits, Merchant, Product, Scenario, VaultCard,
} from "./types";
import { evaluate, cartHash, type CheckoutRequest } from "./policy";
import { randomId, sha256 } from "./hash";
import { CFO, appendAudit, buildSeedMandate, mandateHash, seedAgents, seedCards, seedMerchants, seedProducts } from "./seed";
import type { PasskeyResult } from "./passkey";

export type AgentState = { running: boolean; target: Scenario; intervalMs: number };

export type Data = {
  cards: VaultCard[];
  agents: Agent[];
  merchants: Merchant[];
  products: Product[];
  mandates: Mandate[];
  attempts: Attempt[];
  approvals: Approval[];
  audit: AuditEntry[];
  usedNonces: string[];
  agent: AgentState;
};

export type MandateDraftInput = {
  id?: string;
  agent_id?: string;
  scope: Mandate["scope"];
  limits: MandateLimits;
  validity: Mandate["validity"];
  vault_card_id: string;
  natural_language_description?: string;
  origin?: Mandate["origin"];
};

export function seedData(): Data {
  const mandate = buildSeedMandate();
  let audit: AuditEntry[] = [];
  audit = appendAudit(audit, {
    actor: "user:cfo", action: "mandate.created", entity: mandate.id,
    payload: { hash: mandateHash(mandate), scope: mandate.scope, limits: mandate.limits }, ts: mandate.created_at,
  });
  audit = appendAudit(audit, {
    actor: "user:cfo", action: "mandate.authorized", entity: mandate.id,
    payload: { method: "simulated", credential_id: mandate.authorization!.webauthn_credential_id }, ts: mandate.created_at,
  });
  audit = appendAudit(audit, {
    actor: "registry", action: "mandate.activated", entity: mandate.id,
    payload: { server_sig: mandate.server_sig, status: "active" }, ts: mandate.created_at,
  });
  return {
    cards: seedCards,
    agents: seedAgents.map((a) => ({ ...a, currentMandateId: mandate.id })),
    merchants: seedMerchants,
    products: seedProducts,
    mandates: [mandate],
    attempts: [],
    approvals: [],
    audit,
    usedNonces: [],
    agent: { running: false, target: "standard", intervalMs: 8000 },
  };
}

const SCENARIO_PRODUCT: Record<Scenario, string> = {
  standard: "prd_tire_std",
  premium: "prd_tire_prm",
  accessory: "prd_acc_jack",
  pneufast: "prd_pf_std",
  unsigned: "prd_tire_std",
  replay: "prd_tire_std",
};

export function sameMonth(iso: string, now: Date) {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export function usageFor(data: Pick<Data, "attempts">, mandateId: string, now = new Date()) {
  const approved = data.attempts.filter((a) => a.mandate_id === mandateId && a.decision === "approved" && sameMonth(a.created_at, now));
  return { uses: approved.length, spent: approved.reduce((sum, a) => sum + a.amount_cents, 0) };
}

export function remainingFor(data: Data, m: Mandate, now = new Date()) {
  const u = usageFor(data, m.id, now);
  return { uses: Math.max(0, m.limits.max_uses - u.uses), cumulative_cents: Math.max(0, m.limits.cumulative_cents - u.spent) };
}

export function effectiveStatus(m: Mandate, now = Date.now()) {
  if (m.status === "active" && now > new Date(m.validity.expires_at).getTime()) return "expired";
  return m.status;
}

// ---------- mandates ----------

export function createDraft(d: Data, input: MandateDraftInput): [Data, Mandate] {
  const now = new Date();
  const agent = d.agents.find((a) => a.id === (input.agent_id ?? d.agents[0].id)) ?? d.agents[0];
  const m: Mandate = {
    id: input.id ?? randomId("mnd", 4),
    type: "intent",
    issuer: CFO,
    agent: { agent_id: agent.id, public_key: agent.publicKey },
    scope: input.scope,
    limits: input.limits,
    validity: input.validity,
    payment: { vault_card_id: input.vault_card_id },
    natural_language_description: input.natural_language_description,
    origin: input.origin ?? { requested_by: CFO.display_name, via: "panel", requested_at: now.toISOString() },
    status: "draft",
    created_at: now.toISOString(),
  };
  const actor = m.origin?.via === "api" ? `agent:${agent.name.toLowerCase()}` : "user:cfo";
  return [
    {
      ...d,
      mandates: [m, ...d.mandates],
      audit: appendAudit(d.audit, {
        actor, action: "mandate.created", entity: m.id,
        payload: { hash: mandateHash(m), requested_by: m.origin?.requested_by, via: m.origin?.via, scope: m.scope, limits: m.limits, validity: m.validity },
      }),
    },
    m,
  ];
}

export function authorizeMandate(d: Data, id: string, pk: PasskeyResult): [Data, Mandate] {
  const m = d.mandates.find((x) => x.id === id);
  if (!m) throw new EngineError("MANDATE_NOT_FOUND", 404);
  if (m.status !== "draft") throw new EngineError(`Mandate is ${m.status}, not draft`, 409);
  const challenge = mandateHash(m);
  if (pk.challenge !== challenge) throw new EngineError("Assertion challenge does not match mandate hash", 400);
  const now = new Date().toISOString();
  const next: Mandate = {
    ...m,
    authorization: { method: pk.method, webauthn_credential_id: pk.credential_id, assertion: pk.assertion, challenge, signed_at: now },
    server_sig: sha256(`registry|${challenge}`),
    status: "active",
  };
  let audit = appendAudit(d.audit, {
    actor: "user:cfo", action: "mandate.authorized", entity: m.id,
    payload: { method: pk.method, credential_id: pk.credential_id, challenge, authenticator: pk.authenticator ?? null },
  });
  audit = appendAudit(audit, { actor: "registry", action: "mandate.activated", entity: m.id, payload: { server_sig: next.server_sig, status: "active" } });
  return [
    {
      ...d,
      mandates: d.mandates.map((x) => (x.id === id ? next : x)),
      agents: d.agents.map((a) => (a.id === next.agent.agent_id ? { ...a, currentMandateId: next.id } : a)),
      audit,
    },
    next,
  ];
}

export function declineMandate(d: Data, id: string, actor: string): [Data, Mandate] {
  const m = d.mandates.find((x) => x.id === id);
  if (!m) throw new EngineError("MANDATE_NOT_FOUND", 404);
  if (m.status !== "draft") throw new EngineError(`Mandate is ${m.status}, not draft`, 409);
  const now = new Date().toISOString();
  const next: Mandate = { ...m, status: "declined", declined_at: now };
  return [
    {
      ...d,
      mandates: d.mandates.map((x) => (x.id === id ? next : x)),
      audit: appendAudit(d.audit, { actor, action: "mandate.declined", entity: id, payload: { declined_at: now } }),
    },
    next,
  ];
}

export function revokeMandate(d: Data, id: string, actor: string): [Data, Mandate] {
  const m = d.mandates.find((x) => x.id === id);
  if (!m) throw new EngineError("MANDATE_NOT_FOUND", 404);
  if (m.status !== "active") throw new EngineError(`Mandate is ${m.status}, not active`, 409);
  const now = new Date().toISOString();
  const next: Mandate = { ...m, status: "revoked", revoked_at: now };
  return [
    {
      ...d,
      mandates: d.mandates.map((x) => (x.id === id ? next : x)),
      audit: appendAudit(d.audit, { actor, action: "mandate.revoked", entity: id, payload: { revoked_at: now } }),
    },
    next,
  ];
}

export function updateLimits(d: Data, id: string, limits: Partial<MandateLimits>, actor: string): [Data, Mandate] {
  const m = d.mandates.find((x) => x.id === id);
  if (!m) throw new EngineError("MANDATE_NOT_FOUND", 404);
  const next: Mandate = { ...m, limits: { ...m.limits, ...limits } };
  return [
    {
      ...d,
      mandates: d.mandates.map((x) => (x.id === id ? next : x)),
      audit: appendAudit(d.audit, { actor, action: "mandate.limits_updated", entity: id, payload: { before: m.limits, after: next.limits } }),
    },
    next,
  ];
}

// ---------- checkout ----------

export type CheckoutOpts = { exception_id?: string; source?: "heartbeat" | "manual" | "store" | "api"; productId?: string };

export function checkout(d: Data, scenario: Scenario, opts: CheckoutOpts = {}): [Data, Attempt] {
  const now = new Date();
  const agent = d.agents[0];
  const product = d.products.find((p) => p.id === (opts.productId ?? SCENARIO_PRODUCT[scenario]));
  if (!product) throw new EngineError("PRODUCT_NOT_FOUND", 404);
  const merchant = d.merchants.find((m) => m.id === product.merchantId)!;
  const mandate = d.mandates.find((m) => m.id === agent.currentMandateId);

  // Agent-side request signing (mock Ed25519 in v1). "unsigned" = impersonation, "replay" = reused nonce.
  const lastNonce = d.usedNonces[d.usedNonces.length - 1];
  const nonce = scenario === "replay" && lastNonce ? lastNonce : randomId("nce", 8);
  const signed = scenario !== "unsigned";

  const req: CheckoutRequest = {
    agent_id: agent.id,
    mandate_id: agent.currentMandateId,
    merchant_id: merchant.id,
    product_id: product.id,
    category: product.category,
    amount_cents: product.priceCents,
    exception_id: opts.exception_id,
    signature: { present: signed, valid: signed, timestamp: now.getTime(), nonce },
  };

  const approvedAttempts = mandate
    ? d.attempts.filter((a) => a.mandate_id === mandate.id && a.decision === "approved" && sameMonth(a.created_at, now))
    : [];

  const result = evaluate(req, { now: now.getTime(), agent, mandate, approvedAttempts, usedNonces: new Set(d.usedNonces), approvals: d.approvals });

  const attemptId = randomId("att", 6);
  const attempt: Attempt = {
    id: attemptId,
    mandate_id: mandate?.id ?? req.mandate_id,
    agent_id: agent.id,
    merchant_id: merchant.id,
    product_id: product.id,
    product_name: product.name,
    amount_cents: product.priceCents,
    decision: result.decision,
    reason_code: result.reason_code,
    exception_id: result.exception_used,
    checks: result.checks,
    request: { signed, nonce, timestamp: now.toISOString(), scenario: `${opts.source ?? "manual"}:${scenario}` },
    created_at: now.toISOString(),
  };

  let approvals = d.approvals;
  if (result.decision === "approved") {
    attempt.payment_token = {
      token: `vt_mock_${randomId("", 4).slice(1)}`,
      allowance: {
        reason: "one_time",
        max_amount_cents: product.priceCents,
        currency: "USD",
        merchant_id: merchant.id,
        attempt_id: attemptId,
        expires_at: new Date(now.getTime() + 5 * 60_000).toISOString(),
      },
    };
    if (result.exception_used) approvals = approvals.map((a) => (a.exception_id === result.exception_used ? { ...a, consumed: true } : a));
  }
  if (result.decision === "escalated") {
    approvals = [
      {
        id: randomId("apr", 5),
        attempt_id: attemptId,
        cart_hash: cartHash(req),
        amount_cents: product.priceCents,
        product_name: product.name,
        merchant_id: merchant.id,
        status: "pending",
        created_at: now.toISOString(),
      },
      ...approvals,
    ];
  }

  const merchantActor = `merchant:${merchant.name.toLowerCase()}`;
  let audit = appendAudit(d.audit, {
    actor: merchantActor,
    action: `attempt.${result.decision}`,
    entity: attemptId,
    payload: {
      mandate_id: attempt.mandate_id, agent_id: agent.id, product_id: product.id, amount_cents: product.priceCents,
      reason_code: result.reason_code ?? null, exception_id: result.exception_used ?? null, nonce, signed,
    },
  });
  if (attempt.payment_token)
    audit = appendAudit(audit, {
      actor: merchantActor, action: "payment.token_minted", entity: attemptId,
      payload: { token: attempt.payment_token.token, allowance: attempt.payment_token.allowance },
    });
  if (result.decision === "escalated")
    audit = appendAudit(audit, {
      actor: "registry", action: "approval.requested", entity: approvals[0].id,
      payload: { attempt_id: attemptId, amount_cents: product.priceCents, cart_hash: approvals[0].cart_hash },
    });

  return [
    {
      ...d,
      attempts: [attempt, ...d.attempts].slice(0, 200),
      approvals,
      audit,
      usedNonces: signed && !d.usedNonces.includes(nonce) ? [...d.usedNonces, nonce].slice(-500) : d.usedNonces,
    },
    attempt,
  ];
}

export function decideApproval(d: Data, id: string, decision: "approved" | "denied", actor: string, pk?: PasskeyResult): [Data, { approval: Approval; retry?: Attempt }] {
  const ap = d.approvals.find((a) => a.id === id);
  if (!ap) throw new EngineError("APPROVAL_NOT_FOUND", 404);
  if (ap.status !== "pending") throw new EngineError(`Approval already ${ap.status}`, 409);
  const now = new Date().toISOString();
  const exception_id = decision === "approved" ? randomId("exc", 6) : undefined;
  const next: Approval = {
    ...ap, status: decision, exception_id, decided_by: actor, decided_at: now,
    authorization: pk ? { method: pk.method, assertion: pk.assertion } : undefined,
  };
  const data: Data = {
    ...d,
    approvals: d.approvals.map((a) => (a.id === id ? next : a)),
    audit: appendAudit(d.audit, {
      actor, action: `approval.${decision}`, entity: id,
      payload: { attempt_id: ap.attempt_id, exception_id: exception_id ?? null, cart_hash: ap.cart_hash, method: pk?.method ?? "button" },
    }),
  };
  if (decision !== "approved") return [data, { approval: next }];
  // The agent receives the exception and retries the same cart.
  const original = d.attempts.find((a) => a.id === ap.attempt_id);
  const [after, retry] = checkout(data, "premium", { exception_id, source: "manual", productId: original?.product_id });
  return [after, { approval: next, retry }];
}

// ---------- misc ----------

export function addCard(d: Data, card: Omit<VaultCard, "id">): [Data, VaultCard] {
  const c: VaultCard = { ...card, id: `card_${card.last4}${randomId("", 2).slice(1)}` };
  return [
    {
      ...d,
      cards: [...d.cards, c],
      audit: appendAudit(d.audit, { actor: "user:cfo", action: "vault.card_added", entity: c.id, payload: { brand: c.brand, last4: c.last4 } }),
    },
    c,
  ];
}

export function setAgent(d: Data, patch: Partial<AgentState>): [Data, AgentState] {
  const agent = { ...d.agent, ...patch };
  return [{ ...d, agent }, agent];
}

export class EngineError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export { mandateHash };
export type { Merchant, Product };
