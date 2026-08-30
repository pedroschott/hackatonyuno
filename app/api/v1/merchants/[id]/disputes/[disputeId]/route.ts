import { z } from "zod";

import { MERCHANT_DISPUTE_STATUSES } from "@/lib/disputes";
import { createPublicSupabase } from "@/lib/supabase/bearer";
import { merchantKeyHash, rejectsAsUnauthorized, unauthorizedKey } from "@/lib/server/merchant-api";

const respondSchema = z.object({
  status: z.enum(MERCHANT_DISPUTE_STATUSES),
  response: z.string().trim().min(1).max(2000),
  resolution: z.string().trim().max(2000).optional(),
});

/**
 * Everything one dispute is judged on, in one call: the disputed charge, the
 * mandate that allowed it, and every other purchase the same buyer made here.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/merchants/[id]/disputes/[disputeId]">,
) {
  try {
    const { id, disputeId } = await context.params;
    const secretHash = merchantKeyHash(request);
    if (!secretHash) return unauthorizedKey();

    const supabase = createPublicSupabase();
    const result = await supabase.rpc("get_agentpay_merchant_dispute_context", {
      p_secret_hash: secretHash,
      p_merchant_id: id,
      p_dispute_id: disputeId,
    });
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
    if (rejectsAsUnauthorized(result.data)) return unauthorizedKey();
    return Response.json(result.data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}

/** The merchant's answer, and the status they are moving the dispute to. */
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/merchants/[id]/disputes/[disputeId]">,
) {
  try {
    const { id, disputeId } = await context.params;
    const secretHash = merchantKeyHash(request);
    if (!secretHash) return unauthorizedKey();

    const input = respondSchema.parse(await request.json());
    const supabase = createPublicSupabase();
    const result = await supabase.rpc("respond_to_agentpay_merchant_dispute", {
      p_secret_hash: secretHash,
      p_merchant_id: id,
      p_dispute_id: disputeId,
      p_status: input.status,
      p_merchant_response: input.response,
      p_resolution: input.resolution ?? null,
    });
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
    if (rejectsAsUnauthorized(result.data)) return unauthorizedKey();
    return Response.json({ dispute: result.data });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
