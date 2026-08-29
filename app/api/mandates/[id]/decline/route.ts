import { appendAudit } from "@/lib/data";
import { authenticatedRequest } from "@/lib/http";
import { handle, options, stateResponse } from "@/lib/server/http";

export const OPTIONS = options;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { supabase, user } = await authenticatedRequest();
    const result = await supabase
      .from("mandates")
      .update({ status: "declined", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .select("*")
      .single();
    if (result.error) throw new Error("Draft mandate not found");
    await appendAudit(supabase, `user:${user.id}`, "mandate.declined", id, {
      status: "declined",
    });
    return stateResponse(req, { mandate: result.data });
  });
}
