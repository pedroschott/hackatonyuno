import { createPublicSupabase } from "@/lib/supabase/bearer";
import { merchantManifest } from "@/sdk";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/api/stores/[id]/agentpay.json">) {
  const { id } = await context.params;
  const supabase = createPublicSupabase();
  const result = await supabase
    .from("merchants")
    .select("id, name, agent_ready, hosted_store")
    .eq("id", id)
    .eq("hosted_store", true)
    .eq("agent_ready", true)
    .maybeSingle();
  if (result.error || !result.data) return Response.json({ error: "Store not found" }, { status: 404 });
  const origin = new URL(request.url).origin;
  return Response.json(
    merchantManifest({
      origin,
      merchantId: result.data.id,
      merchantName: result.data.name,
      checkoutPath: `/api/stores/${encodeURIComponent(id)}/checkout`,
      registryUrl: origin,
    }),
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" } },
  );
}
