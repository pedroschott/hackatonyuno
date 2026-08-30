import { DISPUTE_FIELDS } from "@/lib/disputes";
import { apiError, authenticatedRequest } from "@/lib/http";

/**
 * One dispute and its timeline. RLS answers this for both sides, so the buyer
 * and the merchant owner read the same rows through the same route.
 */
export async function GET(_request: Request, context: RouteContext<"/api/disputes/[id]">) {
  try {
    const { id } = await context.params;
    const { supabase } = await authenticatedRequest();
    const [dispute, events] = await Promise.all([
      supabase.from("disputes").select(DISPUTE_FIELDS).eq("id", id).maybeSingle(),
      supabase
        .from("dispute_events")
        .select("id, dispute_id, actor, action, detail, payload, created_at")
        .eq("dispute_id", id)
        .order("created_at"),
    ]);
    if (dispute.error) throw new Error(dispute.error.message);
    if (events.error) throw new Error(events.error.message);
    if (!dispute.data) return Response.json({ error: "Dispute not found" }, { status: 404 });
    return Response.json({ dispute: dispute.data, events: events.data ?? [] });
  } catch (error) {
    return apiError(error, 401);
  }
}
