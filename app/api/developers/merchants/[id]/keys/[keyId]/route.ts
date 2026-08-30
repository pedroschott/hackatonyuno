import { apiError } from "@/lib/http";
import { API_KEY_FIELDS } from "@/lib/merchant-console";
import { ownedMerchant } from "@/lib/server/merchant-console";

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/developers/merchants/[id]/keys/[keyId]">,
) {
  try {
    const { id, keyId } = await context.params;
    const { supabase, merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });
    const result = await supabase
      .from("merchant_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyId)
      .eq("merchant_id", id)
      .select(API_KEY_FIELDS)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) return Response.json({ error: "API key not found" }, { status: 404 });
    return Response.json({ api_key: result.data });
  } catch (error) {
    return apiError(error);
  }
}
