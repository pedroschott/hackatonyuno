import { createPublicSupabase } from "@/lib/supabase/bearer";
import { MERCHANT_FIELDS, PRODUCT_FIELDS } from "@/lib/merchant-console";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/stores/[id]">) {
  const { id } = await context.params;
  const supabase = createPublicSupabase();
  const [merchant, products] = await Promise.all([
    supabase.from("merchants").select(MERCHANT_FIELDS).eq("id", id).eq("hosted_store", true).eq("agent_ready", true).maybeSingle(),
    supabase.from("products").select(PRODUCT_FIELDS).eq("merchant_id", id).eq("active", true).order("created_at"),
  ]);
  if (merchant.error || !merchant.data) return Response.json({ error: "Store not found" }, { status: 404 });
  if (products.error) return Response.json({ error: products.error.message }, { status: 500 });
  return Response.json(
    { merchant: merchant.data, products: products.data ?? [] },
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=30" } },
  );
}
