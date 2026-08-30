import type { SupabaseClient } from "@supabase/supabase-js";

import { merchantVerificationSecret } from "@/lib/env";
import { apiError } from "@/lib/http";
import type { DeveloperMerchant } from "@/lib/merchant-console";
import { ownedMerchant, verifyExternalMerchant } from "@/lib/server/merchant-console";

async function recordVerification(
  supabase: SupabaseClient,
  input: {
    merchantId: string;
    status: "pending" | "verified" | "failed";
    checkoutUrl?: string;
    error?: string;
  },
): Promise<DeveloperMerchant> {
  const result = await supabase.rpc("record_agentpay_merchant_verification", {
    p_merchant_id: input.merchantId,
    p_proof_secret: merchantVerificationSecret(),
    p_status: input.status,
    p_checkout_url: input.checkoutUrl ?? null,
    p_error: input.error ?? null,
  });
  if (result.error) throw new Error(result.error.message);
  return result.data as DeveloperMerchant;
}

export async function POST(_request: Request, context: RouteContext<"/api/developers/merchants/[id]/verify">) {
  try {
    const { id } = await context.params;
    const { supabase, merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });
    if (merchant.hosted_store) {
      return Response.json({ merchant, message: "Hosted test stores are verified automatically." });
    }
    if (!merchant.discovery_url) {
      return Response.json({ error: "Add a discovery URL before verification" }, { status: 400 });
    }
    await recordVerification(supabase, { merchantId: id, status: "pending" });
    try {
      const verification = await verifyExternalMerchant({ merchantId: id, discoveryUrl: merchant.discovery_url });
      const verifiedMerchant = await recordVerification(supabase, {
        merchantId: id,
        status: "verified",
        checkoutUrl: verification.checkoutUrl,
      });
      return Response.json({ merchant: verifiedMerchant, manifest: verification.manifest });
    } catch (verificationError) {
      const message = verificationError instanceof Error ? verificationError.message : "Verification failed";
      await recordVerification(supabase, {
        merchantId: id,
        status: "failed",
        error: message.slice(0, 500),
      });
      return Response.json({ error: message }, { status: 422 });
    }
  } catch (error) {
    return apiError(error);
  }
}
