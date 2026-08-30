import { analyzeDispute, type DisputeContext } from "@/lib/dispute-analysis";
import { createPublicSupabase } from "@/lib/supabase/bearer";
import { merchantKeyHash, rejectsAsUnauthorized, unauthorizedKey } from "@/lib/server/merchant-api";

/**
 * Runs the analysis over the buyer's history at this merchant and stores it on
 * the dispute, from a merchant's own systems rather than the console.
 *
 *   POST /api/v1/merchants/mrc_…/disputes/<id>/analyze
 *   Authorization: Bearer ap_live_…
 *
 * The result is advisory. It never sets `status`: closing a dispute is a
 * decision a person makes, and a model that could close one would be a new way
 * to move money that nobody agreed to.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/merchants/[id]/disputes/[disputeId]/analyze">,
) {
  try {
    const { id, disputeId } = await context.params;
    const secretHash = merchantKeyHash(request);
    if (!secretHash) return unauthorizedKey();

    const supabase = createPublicSupabase();
    const loaded = await supabase.rpc("get_agentpay_merchant_dispute_context", {
      p_secret_hash: secretHash,
      p_merchant_id: id,
      p_dispute_id: disputeId,
    });
    if (loaded.error) return Response.json({ error: loaded.error.message }, { status: 400 });
    if (rejectsAsUnauthorized(loaded.data)) return unauthorizedKey();

    const analysis = await analyzeDispute(loaded.data as DisputeContext);
    const saved = await supabase.rpc("record_agentpay_merchant_dispute_analysis", {
      p_secret_hash: secretHash,
      p_merchant_id: id,
      p_dispute_id: disputeId,
      p_analysis: analysis,
    });
    if (saved.error) return Response.json({ error: saved.error.message }, { status: 400 });
    return Response.json({ analysis, dispute: saved.data });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
