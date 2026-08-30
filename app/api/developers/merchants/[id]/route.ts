import { z } from "zod";

import { apiError } from "@/lib/http";
import { API_KEY_FIELDS, MERCHANT_FIELDS, PRODUCT_FIELDS } from "@/lib/merchant-console";
import { ownedMerchant } from "@/lib/server/merchant-console";

const patchMerchantSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  category: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  website_url: z.url().optional(),
  discovery_url: z.url().optional(),
  publicly_listed: z.boolean().optional(),
});

export async function GET(_request: Request, context: RouteContext<"/api/developers/merchants/[id]">) {
  try {
    const { id } = await context.params;
    const { supabase, merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });
    const [products, keys, attempts] = await Promise.all([
      supabase.from("products").select(PRODUCT_FIELDS).eq("merchant_id", id).order("created_at", { ascending: false }),
      supabase.from("merchant_api_keys").select(API_KEY_FIELDS).eq("merchant_id", id).order("created_at", { ascending: false }),
      supabase
        .from("attempts")
        .select("id, merchant_id, product_id, amount_cents, currency, decision, reason_code, created_at")
        .eq("merchant_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    const error = products.error ?? keys.error ?? attempts.error;
    if (error) throw new Error(error.message);
    return Response.json({
      merchant,
      products: products.data ?? [],
      api_keys: keys.data ?? [],
      attempts: attempts.data ?? [],
    });
  } catch (error) {
    return apiError(error, 401);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/developers/merchants/[id]">) {
  try {
    const { id } = await context.params;
    const input = patchMerchantSchema.parse(await request.json());
    const { supabase, merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });
    if (merchant.hosted_store && (input.website_url || input.discovery_url)) {
      return Response.json({ error: "Hosted store URLs are managed by AgentPay" }, { status: 400 });
    }
    if (input.publicly_listed && (merchant.environment !== "live" || merchant.verification_status !== "verified")) {
      return Response.json({ error: "Verify a live merchant before listing it" }, { status: 409 });
    }
    const update = {
      ...input,
      ...(input.category ? { category: input.category.toLowerCase() } : {}),
      ...(input.website_url ? { website_url: new URL(input.website_url).origin } : {}),
      updated_at: new Date().toISOString(),
    };
    const result = await supabase.from("merchants").update(update).eq("id", id).select(MERCHANT_FIELDS).single();
    if (result.error) throw new Error(result.error.message);
    return Response.json({ merchant: result.data });
  } catch (error) {
    return apiError(error);
  }
}
