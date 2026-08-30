import { appendAudit } from "@/lib/data";
import { authenticatedRequest } from "@/lib/http";
import type { MandateLimits } from "@/lib/types";
import { error, handle, options, readJson, stateResponse } from "@/lib/server/http";

export const OPTIONS = options;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = await readJson<{ limits?: Partial<MandateLimits> }>(req);
    const { supabase, user } = await authenticatedRequest();
    const current = await supabase.from("mandates").select("limits, status").eq("id", id).single();
    if (current.error) return error("Mandate not found", 404);
    if (current.data.status !== "draft") {
      return error("Active mandates are immutable. Revoke and authorize a replacement.", 409);
    }
    if (body.limits?.currency && body.limits.currency !== "USD") {
      return error("Mandate limits must use USD", 400);
    }
    const limits: MandateLimits = {
      ...(current.data.limits as MandateLimits),
      ...(body.limits ?? {}),
      currency: "USD",
    };
    if (
      limits.per_purchase_cents <= 0 ||
      limits.cumulative_cents < limits.per_purchase_cents ||
      limits.max_uses < 1
    ) {
      return error("Invalid limits", 400);
    }
    const updated = await supabase
      .from("mandates")
      .update({ limits, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .select("*")
      .single();
    if (updated.error) throw new Error(updated.error.message);
    await appendAudit(supabase, `user:${user.id}`, "mandate.limits_updated", id, { limits });
    return stateResponse(req, { mandate: updated.data });
  });
}
