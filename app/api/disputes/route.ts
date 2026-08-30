import { z } from "zod";

import { DISPUTE_FIELDS, DISPUTE_REASON_CODES } from "@/lib/disputes";
import { apiError, authenticatedRequest } from "@/lib/http";

const openSchema = z.object({
  attempt_id: z.uuid(),
  reason_code: z.enum(DISPUTE_REASON_CODES),
  // Long enough that the merchant has something to answer, short enough that it
  // stays a statement rather than a correspondence.
  statement: z.string().trim().min(10).max(2000),
});

/** Every dispute on the signed-in account, newest first. */
export async function GET() {
  try {
    const { supabase } = await authenticatedRequest();
    const result = await supabase
      .from("disputes")
      .select(DISPUTE_FIELDS)
      .order("created_at", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    return Response.json({ disputes: result.data ?? [] });
  } catch (error) {
    return apiError(error, 401);
  }
}

export async function POST(request: Request) {
  try {
    const input = openSchema.parse(await request.json());
    const { supabase } = await authenticatedRequest();
    const result = await supabase.rpc("open_agentpay_dispute", {
      p_attempt_id: input.attempt_id,
      p_reason_code: input.reason_code,
      p_buyer_statement: input.statement,
    });
    if (result.error) {
      // The partial unique index is the one failure worth naming: a second
      // dispute against a charge that already has an open one.
      const duplicate = /disputes_one_open_per_attempt/.test(result.error.message);
      return Response.json(
        {
          error: duplicate
            ? "This purchase already has an open dispute."
            : result.error.message,
        },
        { status: duplicate ? 409 : 400 },
      );
    }
    return Response.json({ dispute: result.data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
