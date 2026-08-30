import type { Agent, AuditEntry, Mandate, Merchant, Product, VaultCard } from "./types";
import { canonicalJson, GENESIS_HASH, sha256 } from "./hash";
import { nextSunday2359 } from "./format";

export const CFO = { user_id: "u_cfo", display_name: "CFO — Locadora Atlas" };

export const AGENT_ID = "agt_fleetbuyer";

export const seedCards: VaultCard[] = [
  { id: "card_9281", brand: "mastercard", last4: "9281", label: "Corporate Mastercard" },
];

export const seedAgents: Agent[] = [
  {
    id: AGENT_ID,
    name: "FleetBuyer",
    publicKey: "MCowBQYDK2VwAyEA5c3xXJ9wQ2t7mFq0Y1kZb8rP4vHn2sL6dT0aE9uK1cM=",
    currentMandateId: null,
  },
];

export const seedMerchants: Merchant[] = [
  {
    id: "mrc_autoparts",
    name: "AutoParts",
    category: "automotive",
    agentReady: true,
    slug: "autoparts",
    vertical: "automotive",
    storefront_url: "/store",
    discovery_url: "/merchants/autoparts/.well-known/agentpay.json",
    currency: "BRL",
    display_status: "active",
    supported_canonical_categories: ["automotive.tires", "automotive.accessories"],
  },
  {
    id: "mrc_harvest_market",
    name: "Harvest Market",
    category: "grocery",
    agentReady: true,
    slug: "harvest-market",
    vertical: "grocery",
    storefront_url: "/merchants/harvest-market",
    discovery_url: "/merchants/harvest-market/.well-known/agentpay.json",
    currency: "BRL",
    display_status: "active",
    supported_canonical_categories: ["food.grains.rice", "food.meat.poultry", "food.prepared.burgers"],
  },
  {
    id: "mrc_city_basket",
    name: "City Basket",
    category: "grocery",
    agentReady: true,
    slug: "city-basket",
    vertical: "grocery",
    storefront_url: "/merchants/city-basket",
    discovery_url: "/merchants/city-basket/.well-known/agentpay.json",
    currency: "BRL",
    display_status: "active",
    supported_canonical_categories: ["food.grains.rice", "food.meat.poultry", "food.prepared.burgers"],
  },
  {
    id: "mrc_mare_botanicals",
    name: "Maré Botanicals",
    category: "beauty",
    agentReady: true,
    slug: "mare-botanicals",
    vertical: "beauty",
    storefront_url: "/merchants/mare-botanicals",
    discovery_url: "/merchants/mare-botanicals/.well-known/agentpay.json",
    currency: "BRL",
    display_status: "active",
    supported_canonical_categories: ["beauty.skincare", "beauty.oils"],
  },
];

export const seedProducts: Product[] = [
  {
    id: "prd_tire_std",
    merchantId: "mrc_autoparts",
    name: "Standard tire set",
    description: "4× 205/55 R16 all-season. Fleet-grade, 60k km warranty.",
    category: "tires",
    priceCents: 154_800,
    sku: "TR-205-STD-4",
  },
  {
    id: "prd_tire_prm",
    merchantId: "mrc_autoparts",
    name: "Premium tire set",
    description: "4× 205/55 R16 performance. Low noise, wet-grip A rating.",
    category: "tires",
    priceCents: 172_000,
    sku: "TR-205-PRM-4",
  },
  {
    id: "prd_acc_jack",
    merchantId: "mrc_autoparts",
    name: "Hydraulic jack 2t",
    description: "Low-profile trolley jack with dual pump.",
    category: "accessories",
    priceCents: 38_900,
    sku: "AC-JACK-2T",
  },
  {
    id: "prd_acc_mats",
    merchantId: "mrc_autoparts",
    name: "All-weather floor mats",
    description: "Set of 4, trimmable, anti-slip backing.",
    category: "accessories",
    priceCents: 12_900,
    sku: "AC-MATS-4",
  },
  {
    id: "prd_pf_std",
    merchantId: "mrc_pneufast",
    name: "Standard tire set (PneuFast)",
    description: "4× 205/55 R16 all-season.",
    category: "tires",
    priceCents: 149_000,
    sku: "PF-205-STD-4",
  },
];

/** Canonical mandate = everything except status/authorization/server_sig/timestamps. */
export function mandateCanonical(m: Mandate) {
  return {
    mandate_id: m.id,
    type: m.type,
    issuer: m.issuer,
    agent: m.agent,
    scope: m.scope,
    limits: m.limits,
    validity: m.validity,
    payment: m.payment,
    ...(m.natural_language_description ? { natural_language_description: m.natural_language_description } : {}),
  };
}

export function mandateHash(m: Mandate) {
  return sha256(canonicalJson(mandateCanonical(m)));
}

export function appendAudit(
  log: AuditEntry[],
  entry: Omit<AuditEntry, "seq" | "prev_hash" | "hash" | "ts"> & { ts?: string },
): AuditEntry[] {
  const prev = log.length ? log[log.length - 1].hash : GENESIS_HASH;
  const seq = log.length + 1;
  const ts = entry.ts ?? new Date().toISOString();
  const body = { seq, ts, actor: entry.actor, action: entry.action, entity: entry.entity, payload: entry.payload };
  const hash = sha256(prev + canonicalJson(body));
  return [...log, { ...body, prev_hash: prev, hash }];
}

export function verifyChain(log: AuditEntry[]): { ok: boolean; brokenAt?: number } {
  let prev = GENESIS_HASH;
  for (const e of log) {
    const body = { seq: e.seq, ts: e.ts, actor: e.actor, action: e.action, entity: e.entity, payload: e.payload };
    if (e.prev_hash !== prev || e.hash !== sha256(prev + canonicalJson(body))) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true };
}

export function buildSeedMandate(now = new Date()): Mandate {
  const notBefore = new Date(now.getTime() - 5 * 60_000);
  const m: Mandate = {
    id: "mnd_7f2a",
    type: "intent",
    issuer: CFO,
    agent: { agent_id: AGENT_ID, public_key: seedAgents[0].publicKey },
    scope: { merchants: ["mrc_autoparts"], categories: ["tires"] },
    limits: { per_purchase_cents: 160_000, cumulative_cents: 400_000, max_uses: 3, period: "month", currency: "BRL" },
    validity: { not_before: notBefore.toISOString(), expires_at: nextSunday2359(now).toISOString() },
    payment: { vault_card_id: "card_9281" },
    natural_language_description: "Restock fleet tires at AutoParts this week — standard sets only.",
    origin: { requested_by: "CFO — Locadora Atlas", via: "panel", requested_at: notBefore.toISOString() },
    status: "draft",
    created_at: notBefore.toISOString(),
  };
  const challenge = mandateHash(m);
  m.authorization = {
    method: "simulated",
    webauthn_credential_id: "sim_seed_cfo",
    assertion: sha256(`sim|u_cfo|${challenge}`),
    challenge,
    signed_at: notBefore.toISOString(),
  };
  m.server_sig = sha256(`registry|${challenge}`);
  m.status = "active";
  return m;
}
