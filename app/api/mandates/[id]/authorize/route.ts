import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";

import {
  appendAudit,
  mandateChallenge,
  mandatePayload,
  signMandate,
  type AgentRecord,
} from "@/lib/data";
import { apiError, authenticatedRequest } from "@/lib/http";
import { requireVerifiedIdentity } from "@/lib/identity-verification";
import {
  transactionAuthenticationOptions,
  verifyTransactionAuthentication,
} from "@/lib/webauthn";

const requestSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("start") }),
  z.object({
    phase: z.literal("finish"),
    challenge_id: z.uuid(),
    response: z.custom<AuthenticationResponseJSON>(),
  }),
]);

async function loadMandateAndAgent(
  supabase: Awaited<ReturnType<typeof authenticatedRequest>>["supabase"],
  id: string,
) {
  const mandate = await supabase.from("mandates").select("*").eq("id", id).single();
  if (mandate.error) throw new Error("Mandate not found");
  const agent = await supabase
    .from("agents")
    .select("id, owner_id, name, public_key")
    .eq("id", mandate.data.agent_id)
    .single();
  if (agent.error) throw new Error(agent.error.message);
  return { mandate: mandate.data, agent: agent.data as AgentRecord };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase } = await authenticatedRequest();
    const { mandate } = await loadMandateAndAgent(supabase, id);
    return Response.json(mandate);
  } catch (error) {
    return apiError(error, 404);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = requestSchema.parse(await request.json());
    const { supabase, user } = await authenticatedRequest();
    await requireVerifiedIdentity(supabase);
    const { mandate, agent } = await loadMandateAndAgent(supabase, id);
    if (mandate.status !== "draft") throw new Error("Only draft mandates can be authorized");
    const unsignedPayload = mandatePayload({
      id: mandate.id,
      issuerUserId: user.id,
      agent,
      scope: mandate.scope,
      limits: mandate.limits,
      validity: mandate.validity,
      payment: mandate.payment,
    });
    const challenge = mandateChallenge(unsignedPayload);
    if (input.phase === "start") {
      return Response.json(
        await transactionAuthenticationOptions({
          supabase,
          userId: user.id,
          purpose: "mandate",
          entityId: id,
          challenge,
          requestUrl: request.url,
        }),
      );
    }

    const verified = await verifyTransactionAuthentication({
      supabase,
      userId: user.id,
      purpose: "mandate",
      entityId: id,
      challengeId: input.challenge_id,
      response: input.response,
      requestUrl: request.url,
    });
    if (verified.challenge !== challenge) throw new Error("Mandate changed during authorization");
    const authorization = {
      credential_id: verified.credential_id,
      mandate_hash: challenge,
      assertion: verified.assertion,
      signed_at: new Date().toISOString(),
    };
    const signedPayload = mandatePayload({
      id: mandate.id,
      issuerUserId: user.id,
      agent,
      scope: mandate.scope,
      limits: mandate.limits,
      validity: mandate.validity,
      payment: mandate.payment,
      authorization,
    });
    const update = await supabase
      .from("mandates")
      .update({
        authorization,
        server_sig: signMandate(signedPayload),
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "draft")
      .select("*")
      .single();
    if (update.error) throw new Error(update.error.message);
    await appendAudit(supabase, `user:${user.id}`, "mandate.authorized", id, {
      mandate_hash: challenge,
      credential_id: verified.credential_id,
    });
    return Response.json({ mandate: update.data, artifact: signedPayload });
  } catch (error) {
    return apiError(error);
  }
}
