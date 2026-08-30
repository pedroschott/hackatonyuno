import { z } from "zod";

import { apiError } from "@/lib/http";
import { PRODUCT_FIELDS } from "@/lib/merchant-console";
import { newProductId, ownedMerchant } from "@/lib/server/merchant-console";

const productSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(1).max(1000),
  category: z.string().trim().min(1).max(80),
  sku: z.string().trim().min(1).max(80),
  price_cents: z.number().int().positive(),
  currency: z.string().trim().length(3).default("BRL"),
});

export async function GET(_request: Request, context: RouteContext<"/api/developers/merchants/[id]/products">) {
  try {
    const { id } = await context.params;
    const { supabase, merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });
    const result = await supabase.from("products").select(PRODUCT_FIELDS).eq("merchant_id", id).order("created_at", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    return Response.json({ products: result.data ?? [] });
  } catch (error) {
    return apiError(error, 401);
  }
}

export async function POST(request: Request, context: RouteContext<"/api/developers/merchants/[id]/products">) {
  try {
    const { id } = await context.params;
    const input = productSchema.parse(await request.json());
    const { supabase, merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });
    const result = await supabase
      .from("products")
      .insert({
        id: newProductId(),
        merchant_id: id,
        ...input,
        category: input.category.toLowerCase(),
        currency: input.currency.toUpperCase(),
      })
      .select(PRODUCT_FIELDS)
      .single();
    if (result.error) throw new Error(result.error.message);
    return Response.json({ product: result.data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
