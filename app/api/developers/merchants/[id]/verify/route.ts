import { apiError } from "@/lib/http";
import { MERCHANT_FIELDS } from "@/lib/merchant-console";
import { ownedMerchant, verifyExternalMerchant } from "@/lib/server/merchant-console";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function POST(_request: Request, context: RouteContext<"/api/developers/merchants/[id]/verify">) {
  try {
    const { id } = await context.params;
    const { merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });
    if (merchant.hosted_store) {
      return Response.json({ merchant, message: "Hosted test stores are verified automatically." });
    }
    if (!merchant.discovery_url) {
      return Response.json({ error: "Add a discovery URL before verification" }, { status: 400 });
    }
    const admin = createAdminSupabase();
    await admin
      .from("merchants")
      .update({ verification_status: "pending", verification_error: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    try {
      const verification = await verifyExternalMerchant({ merchantId: id, discoveryUrl: merchant.discovery_url });
      const result = await admin
        .from("merchants")
        .update({
          checkout_url: verification.checkoutUrl,
          verification_status: "verified",
          verification_error: null,
          last_verified_at: new Date().toISOString(),
          agent_ready: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select(MERCHANT_FIELDS)
        .single();
      if (result.error) throw new Error(result.error.message);
      return Response.json({ merchant: result.data, manifest: verification.manifest });
    } catch (verificationError) {
      const message = verificationError instanceof Error ? verificationError.message : "Verification failed";
      await admin
        .from("merchants")
        .update({
          verification_status: "failed",
          verification_error: message.slice(0, 500),
          agent_ready: false,
          publicly_listed: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      return Response.json({ error: message }, { status: 422 });
    }
  } catch (error) {
    return apiError(error);
  }
}
