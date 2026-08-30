import { diditWebhookEventSchema, verifyDiditWebhookSignature } from "@/lib/didit";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook verification is not configured", { status: 503 });

  const raw = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const timestamp = Number(request.headers.get("x-timestamp"));
  const signature = request.headers.get("x-signature-v2") ?? "";
  if (!verifyDiditWebhookSignature({ payload, signature, timestamp, secret })) {
    return new Response("Unauthorized", { status: 401 });
  }

  const event = diditWebhookEventSchema.safeParse(payload);
  // A valid signed event outside the KYC session envelope is not an error for
  // this endpoint. Only session status events alter the AgentPay KYC state.
  if (!event.success) return new Response("ok");

  try {
    const admin = createSupabaseAdmin();
    const result = await admin.rpc("apply_didit_webhook", {
      p_event_id: event.data.event_id,
      p_session_id: event.data.session_id,
      p_status: event.data.status,
      p_webhook_type: event.data.webhook_type,
      p_provider_timestamp: new Date(timestamp * 1000).toISOString(),
    });
    if (result.error) throw new Error(result.error.message);
  } catch (error) {
    console.error("Failed to persist verified Didit webhook", error);
    return new Response("Temporary failure", { status: 500 });
  }

  return new Response("ok");
}
