import { DIDIT_KYC_WORKFLOW_ID, diditSessionSchema, diditVendorData } from "@/lib/didit";
import { agentPayBaseUrl } from "@/lib/env";
import { authenticatedRequest } from "@/lib/http";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { error, handle, json, options } from "@/lib/server/http";

export const runtime = "nodejs";
export const OPTIONS = options;

const verificationFields =
  "didit_session_id, workflow_id, status, approved_at, decision_at, created_at, updated_at";

export async function GET() {
  return handle(async () => {
    const { supabase } = await authenticatedRequest();
    const result = await supabase.from("identity_verifications").select(verificationFields).maybeSingle();
    if (result.error) throw new Error(result.error.message);
    return json({ verification: result.data });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const apiKey = process.env.DIDIT_API_KEY;
    if (!apiKey) return error("Identity verification is not configured", 503);

    const { user } = await authenticatedRequest();
    // Fail before creating a provider session when the server cannot persist
    // its user/session mapping (for example, a missing server-only key).
    const admin = createSupabaseAdmin();
    const storageReady = await admin
      .from("identity_verifications")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (storageReady.error) throw new Error("Identity verification storage is unavailable");
    const callback = new URL(
      "/account?identity_verification=complete",
      agentPayBaseUrl(request.url),
    ).toString();
    const diditResponse = await fetch("https://verification.didit.me/v3/session/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        workflow_id: DIDIT_KYC_WORKFLOW_ID,
        vendor_data: diditVendorData(user.id),
        callback,
      }),
      cache: "no-store",
    });

    const body = await diditResponse.json().catch(() => null);
    if (!diditResponse.ok) {
      return error("Could not start identity verification", 502);
    }
    const session = diditSessionSchema.safeParse(body);
    if (!session.success || session.data.workflow_id !== DIDIT_KYC_WORKFLOW_ID) {
      return error("Identity verification provider returned an invalid session", 502);
    }

    const stored = await admin
      .from("identity_verifications")
      .upsert(
        {
          user_id: user.id,
          didit_session_id: session.data.session_id,
          workflow_id: DIDIT_KYC_WORKFLOW_ID,
          status: session.data.status,
          approved_at: null,
          decision_at: null,
          last_event_timestamp: new Date(0).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select(verificationFields)
      .single();
    if (stored.error) throw new Error(stored.error.message);

    return json({
      url: session.data.url,
      session_id: session.data.session_id,
      verification: stored.data,
    });
  });
}
