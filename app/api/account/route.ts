import { apiError, authenticatedRequest } from "@/lib/http";

export async function GET() {
  try {
    const { supabase, user } = await authenticatedRequest();
    const [cards, mandates, approvals, attempts, credentials] = await Promise.all([
      supabase.from("vault_cards").select("id, brand, last4, payment_ref, created_at").order("created_at"),
      supabase.from("mandates").select("*").order("created_at", { ascending: false }),
      supabase.from("approvals").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("attempts").select("*").order("created_at", { ascending: false }).limit(30),
      supabase.from("webauthn_credentials").select("id, device_type, backed_up, created_at, last_used_at"),
    ]);
    const error = [cards, mandates, approvals, attempts, credentials].find((item) => item.error)?.error;
    if (error) throw new Error(error.message);
    const grants = await supabase.auth.oauth.listGrants();

    return Response.json({
      user: { id: user.id, email: user.email },
      cards: cards.data,
      mandates: mandates.data,
      approvals: approvals.data,
      attempts: attempts.data,
      passkeys: credentials.data,
      agent_connections: grants.error ? [] : grants.data,
    });
  } catch (error) {
    return apiError(error, 401);
  }
}
