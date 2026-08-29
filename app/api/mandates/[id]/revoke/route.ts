import { authenticatedRequest } from "@/lib/http";
import { handle, options, stateResponse } from "@/lib/server/http";

export const OPTIONS = options;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { supabase } = await authenticatedRequest();
    const result = await supabase.rpc("revoke_agentpay_mandate", { p_mandate_id: id });
    if (result.error) throw new Error(result.error.message);
    return stateResponse(req, { mandate: result.data });
  });
}
