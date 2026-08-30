import { createPublicSupabase } from "@/lib/supabase/bearer";
import {
  merchantKeyHash,
  parseTimestamp,
  rejectsAsUnauthorized,
  unauthorizedKey,
} from "@/lib/server/merchant-api";

/**
 * The merchant's own transaction history, authenticated by API key.
 *
 * This is the route that makes agentic commerce reviewable from the merchant's
 * side: every attempt against this merchant, approved or not, with the buyer's
 * stated reason for it, where it shipped, what delivery was quoted, and whether
 * it is disputed. Buyers are identified by a stable per-merchant pseudonym, so a
 * repeat customer is recognisable without the merchant ever holding an identity.
 *
 *   GET /api/v1/merchants/mrc_…/transactions?decision=approved&disputed=true
 *   Authorization: Bearer ap_live_…
 *
 * Filters: `decision`, `since`, `until`, `product_id`, `disputed`, `limit`
 * (max 200) and `before` for cursoring — pass the `created_at` of the last row
 * you saw.
 */
export async function GET(request: Request, context: RouteContext<"/api/v1/merchants/[id]/transactions">) {
  try {
    const { id } = await context.params;
    const secretHash = merchantKeyHash(request);
    if (!secretHash) return unauthorizedKey();

    const url = new URL(request.url);
    const disputed = url.searchParams.get("disputed");
    const limit = Number(url.searchParams.get("limit"));

    const supabase = createPublicSupabase();
    const result = await supabase.rpc("list_agentpay_merchant_transactions", {
      p_secret_hash: secretHash,
      p_merchant_id: id,
      p_decision: url.searchParams.get("decision"),
      p_since: parseTimestamp(url.searchParams.get("since"), "since"),
      p_until: parseTimestamp(url.searchParams.get("until"), "until"),
      p_product_id: url.searchParams.get("product_id"),
      p_disputed: disputed === null ? null : disputed === "true",
      p_limit: Number.isInteger(limit) && limit > 0 ? limit : 50,
      p_before: parseTimestamp(url.searchParams.get("before"), "before"),
    });
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
    if (rejectsAsUnauthorized(result.data)) return unauthorizedKey();

    const body = result.data as { transactions: Array<{ created_at: string }> };
    const last = body.transactions.at(-1);
    return Response.json({
      ...body,
      // Present only when the page was full, so an empty `next_before` means the
      // caller has reached the end rather than that they should ask again.
      next_before: body.transactions.length && last ? last.created_at : null,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
