import { analyzeDispute } from "@/lib/dispute-analysis";
import { apiError } from "@/lib/http";
import { buildDisputeContext } from "@/lib/server/dispute-context";
import { ownedMerchant } from "@/lib/server/merchant-console";

/**
 * Reads the dispute against the buyer's history at this merchant and records
 * what it found. The result is advisory and never changes the dispute's status:
 * a person still decides, from the console or through the API.
 */
export async function POST(
  _request: Request,
  context: RouteContext<"/api/developers/merchants/[id]/disputes/[disputeId]/analyze">,
) {
  try {
    const { id, disputeId } = await context.params;
    const { supabase, merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });

    const disputeContext = await buildDisputeContext(supabase, id, disputeId);
    if (!disputeContext) return Response.json({ error: "Dispute not found" }, { status: 404 });

    const analysis = await analyzeDispute(disputeContext);
    const saved = await supabase.rpc("record_agentpay_dispute_analysis", {
      p_dispute_id: disputeId,
      p_analysis: analysis,
    });
    if (saved.error) return Response.json({ error: saved.error.message }, { status: 400 });
    return Response.json({ analysis, dispute: saved.data });
  } catch (error) {
    return apiError(error);
  }
}
