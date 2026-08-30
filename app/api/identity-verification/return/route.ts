import { z } from "zod";

import { appendAudit } from "@/lib/data";
import { DIDIT_FREE_KYC_WORKFLOW_ID, retrieveDiditDecision } from "@/lib/didit";
import { authenticatedRequest } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";

const sessionIdSchema = z.uuid();

function accountRedirect(request: Request, state: "complete" | "error") {
  const url = new URL("/account", request.url);
  url.searchParams.set("verification", state);
  return Response.redirect(url);
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await authenticatedRequest();
    const sessionId = sessionIdSchema.parse(new URL(request.url).searchParams.get("verificationSessionId"));
    const decision = await retrieveDiditDecision(sessionId);
    if (
      decision.session_id !== sessionId ||
      decision.vendor_data !== user.id ||
      decision.workflow_id !== DIDIT_FREE_KYC_WORKFLOW_ID ||
      decision.session_kind === "business"
    ) {
      throw new Error("Verification decision does not match this account");
    }

    const admin = createAdminSupabase();
    const update = await admin
      .from("identity_verifications")
      .update({
        status: decision.status,
        approved_at: decision.status === "Approved" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("session_id", sessionId)
      .eq("user_id", user.id)
      .select("session_id")
      .maybeSingle();
    if (update.error) throw new Error(update.error.message);
    if (!update.data) throw new Error("Verification session was not started by this account");
    await appendAudit(supabase, `user:${user.id}`, "identity_verification.reconciled", sessionId, {
      provider: "didit",
      status: decision.status,
      features: decision.features ?? [],
    });
    return accountRedirect(request, "complete");
  } catch {
    return accountRedirect(request, "error");
  }
}
