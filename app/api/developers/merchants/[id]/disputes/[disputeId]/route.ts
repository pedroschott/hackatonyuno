import { z } from "zod";

import { MERCHANT_DISPUTE_STATUSES } from "@/lib/disputes";
import { apiError, authenticatedRequest } from "@/lib/http";

const respondSchema = z.object({
  status: z.enum(MERCHANT_DISPUTE_STATUSES),
  response: z.string().trim().min(1).max(2000),
  resolution: z.string().trim().max(2000).optional(),
});

/**
 * The merchant's answer. Ownership is checked inside the function, so a
 * developer cannot answer a dispute at a merchant they do not own by guessing
 * an id.
 */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/developers/merchants/[id]/disputes/[disputeId]">,
) {
  try {
    const { disputeId } = await context.params;
    const input = respondSchema.parse(await request.json());
    const { supabase } = await authenticatedRequest();
    const result = await supabase.rpc("respond_to_agentpay_dispute", {
      p_dispute_id: disputeId,
      p_status: input.status,
      p_merchant_response: input.response,
      p_resolution: input.resolution ?? null,
    });
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
    return Response.json({ dispute: result.data });
  } catch (error) {
    return apiError(error);
  }
}
