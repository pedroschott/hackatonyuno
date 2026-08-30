import { z } from "zod";

import { apiError, authenticatedRequest } from "@/lib/http";

const withdrawSchema = z.object({ note: z.string().trim().max(2000).optional() });

/** The buyer's own exit. A merchant cannot withdraw a dispute on their behalf. */
export async function POST(request: Request, context: RouteContext<"/api/disputes/[id]/withdraw">) {
  try {
    const { id } = await context.params;
    const body = await request.text();
    const input = withdrawSchema.parse(body.trim() ? JSON.parse(body) : {});
    const { supabase } = await authenticatedRequest();
    const result = await supabase.rpc("withdraw_agentpay_dispute", {
      p_dispute_id: id,
      p_note: input.note ?? null,
    });
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
    return Response.json({ dispute: result.data });
  } catch (error) {
    return apiError(error);
  }
}
