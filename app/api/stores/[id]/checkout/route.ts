import { createPublicSupabase } from "@/lib/supabase/bearer";
import { createAgentPayCheckoutHandler } from "@/sdk";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext<"/api/stores/[id]/checkout">) {
  const { id } = await context.params;
  const origin = new URL(request.url).origin;
  const supabase = createPublicSupabase();
  const merchant = await supabase
    .from("merchants")
    .select("id, agent_ready, hosted_store")
    .eq("id", id)
    .eq("hosted_store", true)
    .eq("agent_ready", true)
    .maybeSingle();
  if (merchant.error || !merchant.data) return Response.json({ error: "Store not found" }, { status: 404 });
  const handler = createAgentPayCheckoutHandler({
    merchantId: id,
    registryUrl: origin,
    resolveProduct: async (productId) => {
      const product = await supabase
        .from("products")
        .select("id, merchant_id, name, category, price_cents, currency")
        .eq("id", productId)
        .eq("merchant_id", id)
        .eq("active", true)
        .maybeSingle();
      return product.error ? null : product.data;
    },
  });
  return handler(request);
}
