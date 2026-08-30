import { appendAudit } from "@/lib/data";
import { createDiditSession } from "@/lib/didit";
import { agentPayBaseUrl } from "@/lib/env";
import { apiError, authenticatedRequest } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticatedRequest();
    const callbackUrl = `${agentPayBaseUrl(request.url)}/api/identity-verification/return`;
    const session = await createDiditSession({ userId: user.id, callbackUrl });
    const admin = createAdminSupabase();
    const existing = await admin
      .from("identity_verifications")
      .select("user_id")
      .eq("session_id", session.session_id)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data && existing.data.user_id !== user.id) {
      throw new Error("Verification session ownership mismatch");
    }
    const stored = await admin.from("identity_verifications").upsert(
      {
        session_id: session.session_id,
        user_id: user.id,
        workflow_id: session.workflow_id,
        status: session.status,
        approved_at: session.status === "Approved" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id" },
    );
    if (stored.error) throw new Error(stored.error.message);
    const gate = await admin.rpc("enable_agentpay_didit_checkout_gate");
    if (gate.error || gate.data !== true) throw new Error("Could not activate identity verification enforcement");
    await appendAudit(supabase, `user:${user.id}`, "identity_verification.started", session.session_id, {
      provider: "didit",
      workflow_id: session.workflow_id,
      status: session.status,
    });
    return Response.json({ url: session.url, status: session.status });
  } catch (error) {
    return apiError(error);
  }
}
