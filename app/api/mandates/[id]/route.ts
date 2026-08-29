import { createPublicSupabase } from "@/lib/supabase/bearer";
import { error, json, mandateLinks, options } from "@/lib/server/http";
import { publicBaseUrl } from "@/lib/server/db";

export const OPTIONS = options;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createPublicSupabase();
  const result = await supabase.rpc("get_mandate_registry", { p_mandate_id: id });
  if (result.error || !result.data) return error("MANDATE_NOT_FOUND", 404);
  return json({
    mandate_id: id,
    status: result.data.status,
    mandate: result.data,
    authorization: result.data.authorization,
    server_sig: result.data.server_sig,
    revoked_at: result.data.revoked_at ?? null,
    ...mandateLinks(publicBaseUrl(req), id),
  });
}
