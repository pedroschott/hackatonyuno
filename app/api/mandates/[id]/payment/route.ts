import { appendAudit, getOwnedPaymentCard } from "@/lib/data";
import { authenticatedRequest } from "@/lib/http";
import { error, handle, options, readJson, stateResponse } from "@/lib/server/http";

export const OPTIONS = options;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = await readJson<{ vault_card_id?: string }>(req);
    if (!body.vault_card_id) return error("vault_card_id is required", 400);

    const { supabase, user } = await authenticatedRequest();
    const current = await supabase.from("mandates").select("payment, status").eq("id", id).single();
    if (current.error) return error("Mandate not found", 404);
    if (current.data.status !== "draft") {
      return error("Authorized mandates are immutable. Revoke and authorize a replacement.", 409);
    }

    const card = await getOwnedPaymentCard(supabase, body.vault_card_id);
    if (!card) return error("Payment method not found", 404);
    const previousCardId = (current.data.payment as { vault_card_id?: string }).vault_card_id;
    if (previousCardId === card.id) return stateResponse(req, { mandate_id: id });

    const updated = await supabase
      .from("mandates")
      .update({ payment: { vault_card_id: card.id }, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .select("*")
      .single();
    if (updated.error) throw new Error(updated.error.message);

    await appendAudit(supabase, `user:${user.id}`, "mandate.payment_method_updated", id, {
      previous_payment_method_id: previousCardId,
      payment_method_id: card.id,
    });
    return stateResponse(req, { mandate: updated.data });
  });
}
