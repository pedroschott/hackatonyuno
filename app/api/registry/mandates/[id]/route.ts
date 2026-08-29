import { createPublicSupabase } from "@/lib/supabase/bearer";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = createPublicSupabase();
  const result = await supabase.rpc("get_mandate_registry", { p_mandate_id: id });
  if (result.error || !result.data) {
    return Response.json({ error: "Mandate not found" }, { status: 404 });
  }
  return Response.json(result.data, { headers: { "cache-control": "no-store" } });
}
