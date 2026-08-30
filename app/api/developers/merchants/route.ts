import { z } from "zod";

import { apiError, authenticatedRequest } from "@/lib/http";
import { MERCHANT_FIELDS } from "@/lib/merchant-console";
import { publicBaseUrl } from "@/lib/server/db";
import { newMerchantId, newProductId } from "@/lib/server/merchant-console";

const createMerchantSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hosted"),
    name: z.string().trim().min(2).max(120),
    category: z.string().trim().min(2).max(80),
    description: z.string().trim().min(1).max(500).optional(),
  }),
  z.object({
    kind: z.literal("external"),
    name: z.string().trim().min(2).max(120),
    category: z.string().trim().min(2).max(80),
    description: z.string().trim().min(1).max(500).optional(),
    website_url: z.url(),
    discovery_url: z.url().optional(),
  }),
]);

export async function GET() {
  try {
    const { supabase, user } = await authenticatedRequest();
    const memberships = await supabase
      .from("merchant_memberships")
      .select("merchant_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (memberships.error) throw new Error(memberships.error.message);
    const merchantIds = (memberships.data ?? []).map((membership) => membership.merchant_id);
    if (!merchantIds.length) return Response.json({ merchants: [] });
    const [result, products, attempts] = await Promise.all([
      supabase.from("merchants").select(MERCHANT_FIELDS).in("id", merchantIds).order("created_at", { ascending: false }),
      supabase.from("products").select("merchant_id").in("merchant_id", merchantIds),
      supabase.from("attempts").select("merchant_id, decision, amount_cents").in("merchant_id", merchantIds),
    ]);
    const error = result.error ?? products.error ?? attempts.error;
    if (error) throw new Error(error.message);
    return Response.json({
      merchants: (result.data ?? []).map((merchant) => {
        const merchantAttempts = (attempts.data ?? []).filter((attempt) => attempt.merchant_id === merchant.id);
        return {
          ...merchant,
          product_count: (products.data ?? []).filter((product) => product.merchant_id === merchant.id).length,
          attempt_count: merchantAttempts.length,
          approved_volume_cents: merchantAttempts
            .filter((attempt) => attempt.decision === "approved")
            .reduce((sum, attempt) => sum + Number(attempt.amount_cents), 0),
        };
      }),
    });
  } catch (error) {
    return apiError(error, 401);
  }
}

export async function POST(request: Request) {
  try {
    const input = createMerchantSchema.parse(await request.json());
    const { supabase } = await authenticatedRequest();
    const id = newMerchantId();
    const base = publicBaseUrl(request);
    const hosted = input.kind === "hosted";
    const websiteUrl = hosted ? `${base}/stores/${id}` : new URL(input.website_url).origin;
    const discoveryUrl = hosted
      ? `${base}/api/stores/${id}/agentpay.json`
      : input.discovery_url ?? `${websiteUrl}/.well-known/agentpay.json`;
    const checkoutUrl = hosted ? `${base}/api/stores/${id}/checkout` : null;
    const created = await supabase.rpc("create_agentpay_merchant", {
      p_merchant_id: id,
      p_name: input.name,
      p_category: input.category.toLowerCase(),
      p_description: input.description ?? null,
      p_website_url: websiteUrl,
      p_discovery_url: discoveryUrl,
      p_checkout_url: checkoutUrl,
      p_hosted_store: hosted,
      p_sample_product_id: hosted ? newProductId() : null,
    });
    if (created.error) throw new Error(created.error.message);
    return Response.json(created.data, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
