import { createPublicSupabase } from "@/lib/supabase/bearer";
import { publicBaseUrl } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = createPublicSupabase();
  const result = await supabase
    .from("merchants")
    .select("id, name, category, description, website_url, discovery_url")
    .eq("environment", "live")
    .eq("publicly_listed", true)
    .eq("verification_status", "verified")
    .eq("agent_ready", true)
    .order("name");
  if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
  return Response.json(
    {
      stores: result.data ?? [],
      note: result.data?.length
        ? "These live stores passed AgentPay discovery verification."
        : "No live stores are publicly supported yet. Developer test stores remain private unless their URL is shared.",
      developer_console_url: `${publicBaseUrl(request)}/developers/merchants/new`,
    },
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" } },
  );
}
