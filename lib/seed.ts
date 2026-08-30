// Catalogue for the demo merchant that ships with this repo (app/(store)) plus the
// canonical mandate hashing and audit-chain helpers. No AgentPay account data is
// seeded: agents, cards, mandates and purchases all come from Supabase.
import type { AuditEntry, Mandate, Merchant, Product } from "./types";
import { canonicalJson, GENESIS_HASH, sha256 } from "./hash";

export const seedMerchants: Merchant[] = [
  { id: "mrc_autoparts", name: "AutoParts", category: "auto", agentReady: true },
  { id: "mrc_pneufast", name: "PneuFast", category: "auto", agentReady: true },
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
  entry: Omit<AuditEntry, "seq" | "prev_hash" | "hash" | "hash_version" | "hash_material" | "ts"> & { ts?: string },
): AuditEntry[] {
  const prev = log.length ? log[log.length - 1].hash : GENESIS_HASH;
  const seq = log.length + 1;
  const ts = entry.ts ?? new Date().toISOString();
  const body = auditBody({ ...entry, ts });
  const hashMaterial = canonicalJson(body);
  const hash = sha256(prev + hashMaterial);
  return [
    ...log,
    {
      seq,
      ...entry,
      ts,
      prev_hash: prev,
      hash,
      hash_version: 2,
      hash_material: hashMaterial,
    },
  ];
}

export function verifyChain(log: AuditEntry[]): { ok: boolean; brokenAt?: number } {
  let prev = GENESIS_HASH;
  for (const e of log) {
    let material: unknown;
    try {
      material = JSON.parse(e.hash_material);
    } catch {
      return { ok: false, brokenAt: e.seq };
    }
    if (
      e.hash_version !== 2 ||
      e.prev_hash !== prev ||
      canonicalJson(material) !== canonicalJson(auditBody(e)) ||
      e.hash !== sha256(prev + e.hash_material)
    ) {
      return { ok: false, brokenAt: e.seq };
    }
    prev = e.hash;
  }
  return { ok: true };
}

/**
 * Audit timestamps are stored with six fractional digits in the database hash
 * material. Normalising the browser representation keeps the semantic check
 * stable when PostgREST returns `+00:00` instead of `Z`.
 */
function auditTimestamp(iso: string) {
  const utc = iso.replace(" ", "T").replace(/\+00(?::00)?$/, "Z");
  const match = utc.match(/^(.*?)(?:\.(\d+))?Z$/);
  if (!match) return iso;
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0").slice(0, 6)}Z`;
}

function auditBody(entry: Pick<AuditEntry, "ts" | "actor" | "action" | "entity" | "payload">) {
  return {
    ts: auditTimestamp(entry.ts),
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity ?? "",
    payload: entry.payload,
  };
}
