import { appendAudit } from "@/lib/data";
import { authenticatedRequest } from "@/lib/http";
import { error, handle, options, readJson, stateResponse } from "@/lib/server/http";

export const OPTIONS = options;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = await readJson<{ is_default?: boolean }>(req);
    if (body.is_default !== true) return error("A saved card can only be promoted to default", 400);

    const { supabase, user } = await authenticatedRequest();
    const result = await supabase.rpc("set_default_agentpay_card", { p_card_id: id });
    if (result.error) return error("Payment method not found", 404);

    await appendAudit(supabase, `user:${user.id}`, "vault.card_defaulted", id, {});
    return stateResponse(req, { card: result.data });
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { supabase, user } = await authenticatedRequest();
    const card = await supabase
      .from("vault_cards")
      .select("id, brand, last4, is_default")
      .eq("id", id)
      .single();
    if (card.error) return error("Payment method not found", 404);

    const boundMandates = await supabase
      .from("mandates")
      .select("id, status")
      .in("status", ["draft", "active"])
      .contains("payment", { vault_card_id: id });
    if (boundMandates.error) throw new Error(boundMandates.error.message);
    if ((boundMandates.data ?? []).length > 0) {
      return error("This card is used by a pending or active mandate. Decline or revoke it first.", 409);
    }

    const removed = await supabase.from("vault_cards").delete().eq("id", id).select("id").single();
    if (removed.error) throw new Error(removed.error.message);

    if (card.data.is_default) {
      const replacement = await supabase
        .from("vault_cards")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (replacement.error) throw new Error(replacement.error.message);
      if (replacement.data) {
        const nextDefault = await supabase.rpc("set_default_agentpay_card", {
          p_card_id: replacement.data.id,
        });
        if (nextDefault.error) throw new Error(nextDefault.error.message);
      }
    }

    await appendAudit(supabase, `user:${user.id}`, "vault.card_removed", id, {
      brand: card.data.brand,
      last4: card.data.last4,
    });
    return stateResponse(req, { removed_card_id: id });
  });
}
