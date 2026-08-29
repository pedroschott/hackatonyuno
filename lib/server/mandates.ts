import type { Data, MandateDraftInput } from "@/lib/engine";
import { EngineError } from "@/lib/engine";
import { nextSunday2359 } from "@/lib/format";

type Body = Record<string, unknown>;
const obj = (v: unknown): Body => (v && typeof v === "object" && !Array.isArray(v) ? (v as Body) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const num = (v: unknown): number | undefined => (v == null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

function resolveMerchant(d: Data, ref: string) {
  const r = ref.trim().toLowerCase();
  const m = d.merchants.find((x) => x.id.toLowerCase() === r || x.name.toLowerCase() === r || `mrc_${x.name.toLowerCase()}` === r);
  if (!m) throw new EngineError(`Unknown merchant "${ref}". Valid: ${d.merchants.map((x) => `${x.id} (${x.name})`).join(", ")}`, 400);
  return m.id;
}

function guessRequester(req: Request) {
  const ua = req.headers.get("user-agent") ?? "";
  if (/claude|anthropic/i.test(ua)) return "Claude";
  if (/chatgpt|openai/i.test(ua)) return "ChatGPT";
  if (/gemini|google/i.test(ua)) return "Gemini";
  if (/curl|python|node|go-http|httpie/i.test(ua)) return "Agent (API)";
  return "Agent";
}

/** Accepts the spec shape and a few LLM-friendly aliases (names instead of ids, BRL instead of cents). */
export function normalizeCreate(body: Body, d: Data, req: Request): MandateDraftInput {
  const now = new Date();
  const scope = obj(body.scope);
  const limits = obj(body.limits);
  const validity = obj(body.validity);
  const payment = obj(body.payment);

  const merchants = arr(scope.merchants ?? body.merchants ?? body.merchant ?? ["mrc_autoparts"]).map((x) => resolveMerchant(d, String(x)));
  const categories = arr(scope.categories ?? body.categories ?? body.category ?? ["tires"]).map((c) => String(c).trim().toLowerCase());
  if (merchants.length === 0 || categories.length === 0) throw new EngineError("scope needs at least one merchant and one category", 400);

  const cents = (c: unknown, brl: unknown, def: number) => {
    const a = num(c);
    if (a !== undefined) return Math.round(a);
    const b = num(brl);
    if (b !== undefined) return Math.round(b * 100);
    return def;
  };
  const per = cents(limits.per_purchase_cents ?? body.per_purchase_cents, limits.per_purchase_brl ?? body.per_purchase_brl ?? body.per_purchase, 160_000);
  const cum = cents(limits.cumulative_cents ?? body.cumulative_cents, limits.cumulative_brl ?? body.cumulative_brl ?? body.monthly_cap, 400_000);
  const maxUses = Math.max(1, Math.round(num(limits.max_uses ?? body.max_uses) ?? 3));
  if (per <= 0) throw new EngineError("per_purchase must be > 0", 400);
  if (cum < per) throw new EngineError("cumulative limit must be ≥ per-purchase limit", 400);

  const expRaw = validity.expires_at ?? body.expires_at ?? body.valid_until;
  const expires = expRaw ? new Date(String(expRaw)) : nextSunday2359(now);
  if (Number.isNaN(expires.getTime())) throw new EngineError("expires_at must be an ISO date", 400);
  if (expires.getTime() <= now.getTime()) throw new EngineError("expires_at must be in the future", 400);
  const notBeforeRaw = validity.not_before;
  const notBefore = notBeforeRaw ? new Date(String(notBeforeRaw)) : now;

  const cardRef = String(payment.vault_card_id ?? body.vault_card_id ?? d.cards[0]?.id ?? "");
  const card = d.cards.find((c) => c.id === cardRef || c.last4 === cardRef);
  if (!card) throw new EngineError(`Unknown vault card "${cardRef}". Valid: ${d.cards.map((c) => `${c.id} (•••• ${c.last4})`).join(", ")}`, 400);

  const description = String(body.natural_language_description ?? body.intent ?? body.description ?? body.reason ?? "").trim();
  const via = body.via === "panel" ? "panel" : "api";
  const requested_by = String(body.requested_by ?? body.agent_name ?? (via === "panel" ? "CFO — Locadora Atlas" : guessRequester(req))).slice(0, 60);

  return {
    id: via === "panel" && typeof body.id === "string" ? body.id : undefined,
    agent_id: typeof body.agent_id === "string" ? body.agent_id : undefined,
    scope: { merchants, categories },
    limits: { per_purchase_cents: per, cumulative_cents: cum, max_uses: maxUses, period: "month", currency: "BRL" },
    validity: { not_before: notBefore.toISOString(), expires_at: expires.toISOString() },
    vault_card_id: card.id,
    natural_language_description: description || undefined,
    origin: { requested_by, via, requested_at: now.toISOString() },
  };
}
