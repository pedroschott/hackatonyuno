import { createPublicSupabase } from "@/lib/supabase/bearer";
import { error, json, mandateLinks, options } from "@/lib/server/http";
import { publicBaseUrl } from "@/lib/server/db";

export const OPTIONS = options;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createPublicSupabase();
  const result = await supabase.rpc("get_mandate_registry", { p_mandate_id: id });
  if (result.error || !result.data) return error("MANDATE_NOT_FOUND", 404);
  const usage = result.data.usage ?? { approved_uses: 0, cumulative_cents: 0 };
  const limits = result.data.limits;
  return json({
    mandate_id: id,
    status: result.data.status,
    remaining: {
      uses: Math.max(0, Number(limits.max_uses) - Number(usage.approved_uses)),
      cumulative_cents: Math.max(
        0,
        Number(limits.cumulative_cents) - Number(usage.cumulative_cents),
      ),
    },
    expires_at: result.data.validity.expires_at,
    revoked_at: result.data.revoked_at ?? null,
    checked_at: new Date().toISOString(),
    ...(result.data.status === "draft"
      ? { approval_url: mandateLinks(publicBaseUrl(req), id).approval_url }
      : {}),
  });
}
