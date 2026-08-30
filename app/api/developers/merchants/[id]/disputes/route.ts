import { DISPUTE_FIELDS } from "@/lib/disputes";
import { apiError } from "@/lib/http";
import { ownedMerchant } from "@/lib/server/merchant-console";

/**
 * The disputes raised against one owned merchant, with the charge each one is
 * about. The console reads through RLS rather than an API key, so a developer
 * signed into the browser sees exactly what their key would return.
 */
export async function GET(_request: Request, context: RouteContext<"/api/developers/merchants/[id]/disputes">) {
  try {
    const { id } = await context.params;
    const { supabase, merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });

    const disputes = await supabase
      .from("disputes")
      .select(DISPUTE_FIELDS)
      .eq("merchant_id", id)
      .order("created_at", { ascending: false });
    if (disputes.error) throw new Error(disputes.error.message);

    const rows = disputes.data ?? [];
    const attemptIds = rows.map((row) => row.attempt_id);
    const attempts = attemptIds.length
      ? await supabase
          .from("attempts")
          .select(
            "id, created_at, product_id, amount_cents, shipping_cents, currency, decision, purchase_reason, shipping_address_source, fulfillment",
          )
          .in("id", attemptIds)
      : { data: [], error: null };
    if (attempts.error) throw new Error(attempts.error.message);

    const byId = new Map((attempts.data ?? []).map((row) => [row.id, row]));
    return Response.json({
      merchant_id: id,
      disputes: rows.map((row) => ({ ...row, purchase: byId.get(row.attempt_id) ?? null })),
    });
  } catch (error) {
    return apiError(error, 401);
  }
}
