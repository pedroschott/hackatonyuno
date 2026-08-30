import { createPublicSupabase } from "@/lib/supabase/bearer";
import { merchantManifest } from "@/sdk";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/api/stores/[id]/agentpay.json">) {
  const { id } = await context.params;
  const supabase = createPublicSupabase();
  const [result, products] = await Promise.all([
    supabase
      .from("merchants")
      .select("id, name, agent_ready, hosted_store")
      .eq("id", id)
      .eq("hosted_store", true)
      .eq("agent_ready", true)
      .maybeSingle(),
    supabase.from("products").select("category").eq("merchant_id", id).eq("active", true),
  ]);
  if (result.error || !result.data) return Response.json({ error: "Store not found" }, { status: 404 });
  const origin = new URL(request.url).origin;
  const storePath = `/api/stores/${encodeURIComponent(id)}`;
  return Response.json(
    merchantManifest({
      origin,
      merchantId: result.data.id,
      merchantName: result.data.name,
      checkoutPath: `${storePath}/checkout`,
      catalogPath: `${storePath}/catalog`,
      categories: (products.data ?? []).map((product) => product.category),
      currency: "BRL",
      documentationUrl: `${origin}/docs/agents`,
      registryUrl: origin,
    }),
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" } },
  );
}
