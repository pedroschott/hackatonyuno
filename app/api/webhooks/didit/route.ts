import { z } from "zod";

import { diditEnv } from "@/lib/env";
import { DIDIT_FREE_KYC_WORKFLOW_ID, verifyDiditWebhook } from "@/lib/didit";
import { createAdminSupabase } from "@/lib/supabase/admin";

const webhookSchema = z.object({
  event_id: z.uuid(),
  webhook_type: z.string(),
  timestamp: z.number().int(),
  created_at: z.number().int(),
  application_id: z.uuid(),
  environment: z.enum(["sandbox", "live"]),
  status: z.string(),
  session_id: z.uuid().optional(),
  session_kind: z.enum(["user", "business"]).optional(),
  workflow_id: z.uuid().optional(),
  vendor_data: z.string().max(255).optional(),
});

const supportedEvents = new Set([
  "status.updated",
  "data.updated",
  "user.status.updated",
  "user.data.updated",
]);

export async function POST(request: Request) {
  const rawBody = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const env = diditEnv();
  const signature = verifyDiditWebhook({
    rawBody,
    body: parsed,
    timestamp: request.headers.get("x-timestamp"),
    signatureV2: request.headers.get("x-signature-v2"),
    signatureRaw: request.headers.get("x-signature"),
    secret: env.webhookSecret,
  });
  if (!signature) return Response.json({ error: "Invalid webhook signature" }, { status: 401 });

  const result = webhookSchema.safeParse(parsed);
  if (!result.success) return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  const event = result.data;
  if (!supportedEvents.has(event.webhook_type) || event.session_kind === "business") {
    return Response.json({ ok: true, ignored: true });
  }
  const agentPayUserId = z.uuid().safeParse(event.vendor_data);
  if (!agentPayUserId.success) {
    return Response.json({ ok: true, ignored: true, reason: "unbound_vendor" });
  }
  if (
    (event.webhook_type === "status.updated" || event.webhook_type === "data.updated") &&
    (!event.session_id || event.workflow_id !== DIDIT_FREE_KYC_WORKFLOW_ID)
  ) {
    return Response.json({ ok: true, ignored: true, reason: "unbound_workflow" });
  }

  const admin = createAdminSupabase();
  const applied = await admin.rpc("apply_didit_identity_webhook", {
    p_event_id: event.event_id,
    p_webhook_type: event.webhook_type,
    p_user_id: agentPayUserId.data,
    p_session_id: event.session_id ?? null,
    p_status: event.status,
    p_environment: event.environment,
    p_created_at: event.created_at,
  });
  if (applied.error) {
    return Response.json({ error: "Could not persist webhook" }, { status: 500 });
  }
  return Response.json({ ok: true, duplicate: applied.data === false, signature });
}
