import { appendAudit } from "@/lib/data";
import { authenticatedRequest } from "@/lib/http";
import { error, handle, options, readJson, stateResponse } from "@/lib/server/http";

export const OPTIONS = options;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = await readJson<{ decision?: string }>(req);
    if (body.decision !== "denied") {
      return error("Approvals must be completed with the passkey authorization endpoint", 400);
    }
    const { supabase, user } = await authenticatedRequest();
    const result = await supabase
      .from("approvals")
      .update({ status: "denied", decided_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .single();
    if (result.error) throw new Error("Pending approval not found");
    await appendAudit(supabase, `user:${user.id}`, "approval.denied", id, {
      attempt_id: result.data.attempt_id,
    });
    return stateResponse(req, { approval: result.data });
  });
}
