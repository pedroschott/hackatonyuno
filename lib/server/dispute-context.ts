import type { SupabaseClient } from "@supabase/supabase-js";

import type { DisputeContext } from "@/lib/dispute-analysis";
import { DISPUTE_FIELDS } from "@/lib/disputes";

/**
 * Assembles the same context the API-key function returns, but through RLS for a
 * signed-in console session. Both paths feed one analyzer, so the console and a
 * merchant's own systems cannot drift into judging disputes on different facts.
 *
 * The buyer's auth id never leaves this function: the merchant sees a stable
 * per-merchant pseudonym, which is enough to recognise a repeat customer and not
 * enough to identify a person.
 */
export async function buildDisputeContext(
  supabase: SupabaseClient,
  merchantId: string,
  disputeId: string,
): Promise<DisputeContext | null> {
  const dispute = await supabase
    .from("disputes")
    .select(`${DISPUTE_FIELDS}, user_id`)
    .eq("id", disputeId)
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (dispute.error) throw new Error(dispute.error.message);
  if (!dispute.data) return null;

  const row = dispute.data as Record<string, unknown> & { user_id: string; attempt_id: string; mandate_id: string | null };

  const [purchase, mandate, history, priorDisputes] = await Promise.all([
    supabase
      .from("attempts")
      .select(
        "id, created_at, product_id, amount_cents, shipping_cents, currency, decision, reason_code, purchase_reason, shipping_address_source, fulfillment",
      )
      .eq("id", row.attempt_id)
      .maybeSingle(),
    row.mandate_id
      ? supabase
          .from("mandates")
          .select("id, status, scope, limits, validity, natural_language_description, created_at, revoked_at")
          .eq("id", row.mandate_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("attempts")
      .select(
        "id, created_at, product_id, amount_cents, decision, reason_code, purchase_reason, shipping_address_source, fulfillment",
      )
      .eq("merchant_id", merchantId)
      .eq("user_id", row.user_id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("disputes")
      .select("id, created_at, reason_code, status, amount_cents")
      .eq("merchant_id", merchantId)
      .eq("user_id", row.user_id)
      .neq("id", disputeId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  for (const result of [purchase, mandate, history, priorDisputes]) {
    if (result?.error) throw new Error(result.error.message);
  }

  const productIds = Array.from(new Set((history.data ?? []).map((item) => item.product_id)));
  const products = productIds.length
    ? await supabase.from("products").select("id, name").in("id", productIds)
    : { data: [], error: null };
  if (products.error) throw new Error(products.error.message);
  const productNames = new Map((products.data ?? []).map((item) => [item.id, item.name as string]));

  const fulfillmentOf = (value: unknown) =>
    (value ?? null) as DisputeContext["disputed_purchase"] extends infer T
      ? T extends { fulfillment: infer F }
        ? F
        : null
      : null;

  return {
    merchant_id: merchantId,
    buyer_ref: await buyerRef(row.user_id, merchantId),
    dispute: {
      id: String(row.id),
      reason_code: row.reason_code as DisputeContext["dispute"]["reason_code"],
      status: String(row.status),
      amount_cents: Number(row.amount_cents),
      currency: String(row.currency),
      buyer_statement: String(row.buyer_statement),
      created_at: String(row.created_at),
    },
    disputed_purchase: purchase.data
      ? {
          id: purchase.data.id,
          created_at: purchase.data.created_at,
          product_id: purchase.data.product_id,
          amount_cents: purchase.data.amount_cents,
          shipping_cents: purchase.data.shipping_cents ?? 0,
          purchase_reason: purchase.data.purchase_reason ?? null,
          shipping_address_source: purchase.data.shipping_address_source ?? null,
          fulfillment: fulfillmentOf(purchase.data.fulfillment),
        }
      : null,
    mandate: mandate.data
      ? {
          id: mandate.data.id,
          status: mandate.data.status,
          scope: mandate.data.scope,
          limits: mandate.data.limits,
          natural_language_description: mandate.data.natural_language_description ?? null,
          created_at: mandate.data.created_at,
          revoked_at: mandate.data.revoked_at ?? null,
        }
      : null,
    purchase_history: (history.data ?? []).map((item) => ({
      id: item.id,
      created_at: item.created_at,
      product_id: item.product_id,
      product_name: productNames.get(item.product_id) ?? null,
      amount_cents: item.amount_cents,
      decision: item.decision,
      reason_code: item.reason_code ?? null,
      purchase_reason: item.purchase_reason ?? null,
      shipping_address_source: item.shipping_address_source ?? null,
      estimated_delivery:
        (item.fulfillment as { estimated_delivery?: { text?: string } } | null)?.estimated_delivery?.text ?? null,
      shipping_method: (item.fulfillment as { method?: string } | null)?.method ?? null,
    })),
    prior_disputes: (priorDisputes.data ?? []).map((item) => ({
      id: item.id,
      created_at: item.created_at,
      reason_code: item.reason_code,
      status: item.status,
      amount_cents: item.amount_cents,
    })),
  };
}

/** Same construction as the SQL side: sha256(user_id || '|' || merchant_id). */
async function buyerRef(userId: string, merchantId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}|${merchantId}`));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
