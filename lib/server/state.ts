import type { User } from "@supabase/supabase-js";

import { ensureAgent } from "@/lib/data";
import { latestHeldMandate, type Data } from "@/lib/engine";
import { authenticatedRequest } from "@/lib/http";
import { seedMerchants, seedProducts } from "@/lib/seed";
import type {
  Approval,
  Attempt,
  AuditEntry,
  Check,
  Mandate,
  ReasonCode,
  VaultCard,
} from "@/lib/types";

export function publicState(): Data {
  return {
    cards: [],
    agents: [],
    merchants: seedMerchants,
    products: seedProducts,
    mandates: [],
    attempts: [],
    approvals: [],
    audit: [],
    usedNonces: [],
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function mapMandate(row: Record<string, unknown>, agent: { id: string; public_key: string }, user: User): Mandate {
  const authorization = asObject(row.authorization);
  const assertion = authorization.assertion;
  const origin = asObject(row.origin);
  return {
    id: String(row.id),
    type: "intent",
    issuer: { user_id: user.id, display_name: user.email ?? "AgentPay user" },
    agent: { agent_id: agent.id, public_key: agent.public_key },
    scope: row.scope as Mandate["scope"],
    limits: row.limits as Mandate["limits"],
    validity: row.validity as Mandate["validity"],
    payment: row.payment as Mandate["payment"],
    natural_language_description:
      typeof row.natural_language_description === "string" ? row.natural_language_description : undefined,
    origin:
      typeof origin.requested_by === "string"
        ? {
            requested_by: origin.requested_by,
            via: origin.via === "api" ? "api" : "panel",
            requested_at:
              typeof origin.requested_at === "string" ? origin.requested_at : String(row.created_at),
          }
        : undefined,
    authorization:
      typeof authorization.credential_id === "string"
        ? {
            method: "webauthn",
            webauthn_credential_id: authorization.credential_id,
            assertion: typeof assertion === "string" ? assertion : JSON.stringify(assertion ?? {}),
            challenge:
              typeof authorization.mandate_hash === "string" ? authorization.mandate_hash : "",
            signed_at:
              typeof authorization.signed_at === "string"
                ? authorization.signed_at
                : String(row.updated_at),
          }
        : undefined,
    server_sig: typeof row.server_sig === "string" ? row.server_sig : undefined,
    status: row.status as Mandate["status"],
    revoked_at: typeof row.revoked_at === "string" ? row.revoked_at : undefined,
    declined_at: row.status === "declined" ? String(row.updated_at) : undefined,
    created_at: String(row.created_at),
  };
}

function verificationChecks(row: Record<string, unknown>): Check[] {
  const verification = asObject(row.verification);
  const pass = (value: unknown) => value === true || value === "active";
  return [
    {
      id: "agent_signature",
      label: "Agent signature",
      status: pass(verification.agent_signature) ? "pass" : "fail",
    },
    {
      id: "mandate_signature",
      label: "Mandate signature",
      status: pass(verification.mandate_signature) ? "pass" : "fail",
    },
    {
      id: "registry_status",
      label: "Registry status",
      status: pass(verification.registry_status) ? "pass" : "fail",
    },
    {
      id: "policy",
      label: "Policy",
      status: row.decision === "approved" ? "pass" : "fail",
      detail: typeof row.reason_code === "string" ? row.reason_code : undefined,
    },
  ];
}

function mapAttempt(row: Record<string, unknown>, products: Array<{ id: string; name: string }>): Attempt {
  const verification = asObject(row.verification);
  const product = products.find((candidate) => candidate.id === row.product_id);
  return {
    id: String(row.id),
    mandate_id: typeof row.mandate_id === "string" ? row.mandate_id : null,
    agent_id: String(row.agent_id),
    merchant_id: String(row.merchant_id),
    product_id: String(row.product_id),
    product_name: product?.name ?? String(row.product_id),
    amount_cents: Number(row.amount_cents),
    shipping_cents: Number(row.shipping_cents ?? 0),
    decision: row.decision as Attempt["decision"],
    reason_code:
      typeof row.reason_code === "string" ? (row.reason_code as ReasonCode) : undefined,
    exception_id: typeof row.exception_id === "string" ? row.exception_id : undefined,
    payment_token: row.payment_token ? (row.payment_token as Attempt["payment_token"]) : undefined,
    purchase_reason: typeof row.purchase_reason === "string" ? row.purchase_reason : undefined,
    shipping_address: row.shipping_address ? (row.shipping_address as Attempt["shipping_address"]) : undefined,
    shipping_address_source:
      row.shipping_address_source === "custom" || row.shipping_address_source === "registered"
        ? row.shipping_address_source
        : undefined,
    fulfillment: row.fulfillment ? (row.fulfillment as Attempt["fulfillment"]) : undefined,
    checks: verificationChecks(row),
    request: {
      signed: verification.agent_signature === true,
      nonce: typeof verification.nonce === "string" ? verification.nonce : "registry",
      timestamp: String(row.created_at),
      scenario:
        typeof verification.scenario === "string" ? verification.scenario : "merchant:live",
    },
    created_at: String(row.created_at),
  };
}

function mapApproval(row: Record<string, unknown>, attempts: Attempt[]): Approval {
  const attempt = attempts.find((candidate) => candidate.id === row.attempt_id);
  const authorization = asObject(row.authorization);
  return {
    id: String(row.id),
    attempt_id: String(row.attempt_id),
    cart_hash: String(row.cart_hash),
    amount_cents: attempt?.amount_cents ?? 0,
    product_name: attempt?.product_name ?? "Purchase",
    merchant_id: attempt?.merchant_id ?? "",
    status: row.status as Approval["status"],
    exception_id: row.status === "approved" ? String(row.id) : undefined,
    consumed: Boolean(row.consumed_at),
    decided_by: row.status !== "pending" ? "user" : undefined,
    decided_at: typeof row.decided_at === "string" ? row.decided_at : undefined,
    authorization:
      typeof authorization.credential_id === "string"
        ? {
            method: "webauthn",
            assertion: JSON.stringify(authorization.assertion ?? {}),
          }
        : undefined,
    created_at: String(row.created_at),
  };
}

export async function loadAuthenticatedState(): Promise<{ state: Data; user: User }> {
  const { supabase, user } = await authenticatedRequest();
  const agent = await ensureAgent(supabase, user.id);
  const [cards, mandates, attempts, approvals, audit, products, merchants] = await Promise.all([
    supabase
      .from("vault_cards")
      .select("id, brand, last4, label, is_default, created_at")
      .order("is_default", { ascending: false })
      .order("created_at"),
    supabase.from("mandates").select("*").order("created_at", { ascending: false }),
    supabase.from("attempts").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("approvals").select("*").order("created_at", { ascending: false }),
    supabase.from("audit_log").select("*").order("seq"),
    supabase.from("products").select("*"),
    supabase.from("merchants").select("id, name, category, agent_ready"),
  ]);
  const error =
    cards.error ?? mandates.error ?? attempts.error ?? approvals.error ?? audit.error ?? products.error ?? merchants.error;
  if (error) throw new Error(error.message);

  const productRows = (products.data ?? []) as Array<Record<string, unknown>>;
  const seededProducts = seedProducts.map((product) => {
    const live = productRows.find((row) => row.id === product.id);
    return live ? { ...product, priceCents: Number(live.price_cents) } : product;
  });
  const productsForUi = [
    ...seededProducts,
    ...productRows
      .filter((row) => !seededProducts.some((product) => product.id === row.id))
      .map((row) => ({
        id: String(row.id),
        merchantId: String(row.merchant_id),
        name: String(row.name),
        description: String(row.description ?? row.name),
        category: String(row.category),
        priceCents: Number(row.price_cents),
        sku: String(row.sku ?? row.id),
      })),
  ];
  const mappedMandates = ((mandates.data ?? []) as Array<Record<string, unknown>>).map((row) =>
    mapMandate(row, agent, user),
  );
  const mappedAttempts = ((attempts.data ?? []) as Array<Record<string, unknown>>).map((row) =>
    mapAttempt(row, productsForUi),
  );
  const mappedApprovals = ((approvals.data ?? []) as Array<Record<string, unknown>>).map((row) =>
    mapApproval(row, mappedAttempts),
  );
  const current = latestHeldMandate(mappedMandates) ?? null;

  return {
    user,
    state: {
      cards: ((cards.data ?? []) as Array<Record<string, unknown>>).map(
        (row) =>
          ({
            id: String(row.id),
            brand: row.brand === "visa" ? "visa" : "mastercard",
            last4: String(row.last4),
            label: typeof row.label === "string" ? row.label : undefined,
            isDefault: row.is_default === true,
            createdAt: String(row.created_at),
          }) satisfies VaultCard,
      ),
      agents: [
        {
          id: agent.id,
          name: agent.name,
          publicKey: agent.public_key,
          currentMandateId: current?.id ?? null,
        },
      ],
      merchants: [
        ...seedMerchants,
        ...((merchants.data ?? []) as Array<Record<string, unknown>>)
          .filter((row) => !seedMerchants.some((merchant) => merchant.id === row.id))
          .map((row) => ({
            id: String(row.id),
            name: String(row.name),
            category: String(row.category),
            agentReady: row.agent_ready === true,
          })),
      ],
      products: productsForUi,
      mandates: mappedMandates,
      attempts: mappedAttempts,
      approvals: mappedApprovals,
      audit: ((audit.data ?? []) as Array<Record<string, unknown>>).map(
        (row) =>
          ({
            seq: Number(row.seq),
            ts: String(row.ts),
            actor: String(row.actor),
            action: String(row.action),
            entity: String(row.entity ?? ""),
            payload: asObject(row.payload),
            prev_hash: String(row.prev_hash),
            hash: String(row.hash),
          }) satisfies AuditEntry,
      ),
      usedNonces: [],
    },
  };
}
