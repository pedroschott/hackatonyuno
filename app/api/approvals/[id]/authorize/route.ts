import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";

import { appendAudit, mandateChallenge } from "@/lib/data";
import { apiError, authenticatedRequest } from "@/lib/http";
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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = requestSchema.parse(await request.json());
    const { supabase, user } = await authenticatedRequest();
    const approval = await supabase.from("approvals").select("*").eq("id", id).single();
    if (approval.error || approval.data.status !== "pending") throw new Error("Pending approval not found");
    const payload = {
      approval_id: id,
      attempt_id: approval.data.attempt_id,
      mandate_id: approval.data.mandate_id,
      cart_hash: approval.data.cart_hash,
      decision: "approve",
    };
    const challenge = mandateChallenge(payload);
    if (input.phase === "start") {
      return Response.json(
        await transactionAuthenticationOptions({
          supabase,
          userId: user.id,
          purpose: "approval",
          entityId: id,
          challenge,
          requestUrl: request.url,
        }),
      );
    }
    const verified = await verifyTransactionAuthentication({
      supabase,
      userId: user.id,
      purpose: "approval",
      entityId: id,
      challengeId: input.challenge_id,
      response: input.response,
      requestUrl: request.url,
    });
    if (verified.challenge !== challenge) throw new Error("Approval changed during authorization");
    const authorization = {
      credential_id: verified.credential_id,
      approval_hash: challenge,
      assertion: verified.assertion,
      signed_at: new Date().toISOString(),
    };
    const result = await supabase
      .from("approvals")
      .update({ status: "approved", decided_at: new Date().toISOString(), authorization })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .single();
    if (result.error) throw new Error(result.error.message);
    await appendAudit(supabase, `user:${user.id}`, "approval.approved", id, {
      approval_hash: challenge,
      credential_id: verified.credential_id,
    });
    const original = await supabase
      .from("attempts")
      .select("agent_id, merchant_id, product_id, amount_cents, currency")
      .eq("id", approval.data.attempt_id)
      .single();
    if (original.error) throw new Error(original.error.message);
    const product = await supabase
      .from("products")
      .select("category")
      .eq("id", original.data.product_id)
      .single();
    if (product.error) throw new Error(product.error.message);
    const retry = await supabase.rpc("evaluate_agentpay_checkout", {
      p_mandate_id: approval.data.mandate_id,
      p_agent_id: original.data.agent_id,
      p_merchant_id: original.data.merchant_id,
      p_product_id: original.data.product_id,
      p_category: product.data.category,
      p_amount_cents: original.data.amount_cents,
      p_currency: original.data.currency,
      p_exception_id: id,
    });
    if (retry.error) throw new Error(retry.error.message);
    return Response.json({ approval: result.data, retry: retry.data });
  } catch (error) {
    return apiError(error);
  }
}
