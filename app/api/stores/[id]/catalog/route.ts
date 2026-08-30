import { createPublicSupabase } from "@/lib/supabase/bearer";
import { createAgentPayCatalogHandler } from "@/sdk";

export const dynamic = "force-dynamic";

// Catalog endpoint for a hosted test store. Same shape and filtering as any
// SDK merchant, backed by the products the developer manages in the console.
export async function GET(request: Request, context: RouteContext<"/api/stores/[id]/catalog">) {
  const { id } = await context.params;
  const supabase = createPublicSupabase();
  const merchant = await supabase
    .from("merchants")
    .select("id, name")
    .eq("id", id)
    .eq("hosted_store", true)
    .eq("agent_ready", true)
    .maybeSingle();
  if (merchant.error || !merchant.data) return Response.json({ error: "Store not found" }, { status: 404 });
  const origin = new URL(request.url).origin;
  const storeUrl = `${origin}/stores/${encodeURIComponent(id)}`;
  const handler = createAgentPayCatalogHandler({
    merchantId: merchant.data.id,
    merchantName: merchant.data.name,
    currency: "BRL",
    products: async () => {
      const products = await supabase
        .from("products")
        .select("id, name, description, category, sku, price_cents, currency")
        .eq("merchant_id", id)
        .eq("active", true)
        .order("created_at");
      if (products.error) throw new Error(products.error.message);
      return (products.data ?? []).map((product) => ({
        product_id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        price_cents: product.price_cents,
        currency: product.currency,
        sku: product.sku,
        availability: "in_stock" as const,
        url: storeUrl,
      }));
    },
    maxAgeSeconds: 30,
  });
  return handler(request);
}
