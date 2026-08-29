import { createPublicSupabase } from "@/lib/supabase/bearer";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = createPublicSupabase();
  const result = await supabase.rpc("get_agent_registry", { p_agent_id: id });
  if (result.error || !result.data) return Response.json({ error: "Agent not found" }, { status: 404 });
  return Response.json(result.data, { headers: { "cache-control": "public, max-age=60" } });
}
