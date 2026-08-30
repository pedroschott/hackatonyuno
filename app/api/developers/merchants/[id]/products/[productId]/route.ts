import { z } from "zod";

import { apiError } from "@/lib/http";
import { PRODUCT_FIELDS } from "@/lib/merchant-console";
import { ownedMerchant } from "@/lib/server/merchant-console";

const productPatchSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().min(1).max(1000).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  sku: z.string().trim().min(1).max(80).optional(),
  price_cents: z.number().int().positive().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/developers/merchants/[id]/products/[productId]">,
) {
  try {
    const { id, productId } = await context.params;
    const input = productPatchSchema.parse(await request.json());
    const { supabase, merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });
    const result = await supabase
      .from("products")
      .update({
        ...input,
        ...(input.category ? { category: input.category.toLowerCase() } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", productId)
      .eq("merchant_id", id)
      .select(PRODUCT_FIELDS)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) return Response.json({ error: "Product not found" }, { status: 404 });
    return Response.json({ product: result.data });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/developers/merchants/[id]/products/[productId]">,
) {
  try {
    const { id, productId } = await context.params;
    const { supabase, merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });
    const result = await supabase.from("products").delete().eq("id", productId).eq("merchant_id", id).select("id").maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) return Response.json({ error: "Product not found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
