import { z } from "zod";

import { createPublicSupabase } from "@/lib/supabase/bearer";
import { PRODUCT_FIELDS } from "@/lib/merchant-console";
import { hashMerchantApiKey, newProductId } from "@/lib/server/merchant-console";

const productSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(1).max(1000),
  category: z.string().trim().min(1).max(80),
  sku: z.string().trim().min(1).max(80),
  price_cents: z.number().int().positive(),
  currency: z.literal("USD").default("USD"),
});

export async function GET(_request: Request, context: RouteContext<"/api/v1/merchants/[id]/products">) {
  const { id } = await context.params;
  const supabase = createPublicSupabase();
  const result = await supabase
    .from("products")
    .select(PRODUCT_FIELDS)
    .eq("merchant_id", id)
    .eq("active", true)
    .order("created_at");
  if (result.error) return Response.json({ error: result.error.message }, { status: 404 });
  return Response.json({ merchant_id: id, products: result.data ?? [] });
}

export async function POST(request: Request, context: RouteContext<"/api/v1/merchants/[id]/products">) {
  try {
    const { id } = await context.params;
    const authorization = request.headers.get("authorization") ?? "";
    const plaintext = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!plaintext.startsWith("ap_")) return Response.json({ error: "Merchant API key required" }, { status: 401 });
    const input = productSchema.parse(await request.json());
    const supabase = createPublicSupabase();
    const result = await supabase.rpc("create_agentpay_merchant_product", {
      p_secret_hash: hashMerchantApiKey(plaintext),
      p_merchant_id: id,
      p_product_id: newProductId(),
      p_name: input.name,
      p_description: input.description,
      p_category: input.category,
      p_sku: input.sku,
      p_price_cents: input.price_cents,
      p_currency: input.currency,
    });
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
    const product = result.data as { merchant_id?: string } | null;
    if (!product || product.merchant_id !== id) return Response.json({ error: "Invalid merchant API key" }, { status: 401 });
    return Response.json({ product }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
