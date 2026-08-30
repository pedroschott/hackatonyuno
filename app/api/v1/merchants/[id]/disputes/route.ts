import { createPublicSupabase } from "@/lib/supabase/bearer";
import { merchantKeyHash, rejectsAsUnauthorized, unauthorizedKey } from "@/lib/server/merchant-api";

/**
 * Disputes raised against this merchant, authenticated by API key.
 *
 *   GET /api/v1/merchants/mrc_…/disputes?status=open
 *   Authorization: Bearer ap_live_…
 *
 * Each row carries the buyer's statement, the reason they selected, the reason
 * the agent recorded at the time of purchase, any analysis already run, and the
 * same per-merchant buyer pseudonym the transactions route uses, so a merchant
 * can join the two without either side handling an identity.
 */
export async function GET(request: Request, context: RouteContext<"/api/v1/merchants/[id]/disputes">) {
  try {
    const { id } = await context.params;
    const secretHash = merchantKeyHash(request);
    if (!secretHash) return unauthorizedKey();

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit"));
    const supabase = createPublicSupabase();
    const result = await supabase.rpc("list_agentpay_merchant_disputes", {
      p_secret_hash: secretHash,
      p_merchant_id: id,
      p_status: url.searchParams.get("status"),
      p_limit: Number.isInteger(limit) && limit > 0 ? limit : 50,
    });
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
    if (rejectsAsUnauthorized(result.data)) return unauthorizedKey();
    return Response.json(result.data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
