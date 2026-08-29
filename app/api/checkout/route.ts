import { ensureAgent, getAgentPrivateKey } from "@/lib/data";
import { authenticatedRequest } from "@/lib/http";
import { publicBaseUrl } from "@/lib/server/db";
import { error, handle, json, options, readJson } from "@/lib/server/http";
import { loadAuthenticatedState } from "@/lib/server/state";
import { seedProducts } from "@/lib/seed";
import type { Scenario } from "@/lib/types";
import { discoverAgentPayMerchant, signAgentPayRequest } from "@/sdk";

export const OPTIONS = options;

const PRODUCT_BY_SCENARIO: Record<Scenario, string> = {
  standard: "prd_tire_std",
  premium: "prd_tire_prm",
  accessory: "prd_acc_jack",
  pneufast: "prd_pf_std",
  unsigned: "prd_tire_std",
  replay: "prd_tire_std",
};
const SCENARIOS = Object.keys(PRODUCT_BY_SCENARIO) as Scenario[];

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{
      scenario?: Scenario;
      source?: "heartbeat" | "manual" | "store" | "api";
      productId?: string;
      product_id?: string;
      exception_id?: string;
    }>(req);
    const scenario = SCENARIOS.includes(body.scenario as Scenario)
      ? (body.scenario as Scenario)
      : "standard";
    const productId =
      body.productId ?? body.product_id ?? PRODUCT_BY_SCENARIO[scenario];
    const product = seedProducts.find((candidate) => candidate.id === productId);
    if (!product) return error("Product not found", 404);

    const { supabase, user } = await authenticatedRequest();
    const agent = await ensureAgent(supabase, user.id);
    const activeMandate = await supabase
      .from("mandates")
      .select("id")
      .eq("agent_id", agent.id)
      .in("status", ["active", "revoked"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeMandate.error || !activeMandate.data) {
      return error("Authorize a mandate before purchasing", 409);
    }

    let merchantChecks: Record<string, boolean> = {};
    const directPolicyScenario =
      scenario === "unsigned" || scenario === "replay" || scenario === "pneufast";
    if (!directPolicyScenario) {
      const base = publicBaseUrl(req);
      const manifest = await discoverAgentPayMerchant(base);
      const privateKey = await getAgentPrivateKey(supabase, user.id, agent.id);
      const checkoutBody = JSON.stringify({
        mandate_id: activeMandate.data.id,
        merchant_id: product.merchantId,
        product_id: product.id,
        ...(body.exception_id ? { exception_id: body.exception_id } : {}),
      });
      const headers = signAgentPayRequest({
        agentId: agent.id,
        privateKey,
        method: "POST",
        url: manifest.checkout_endpoint,
        body: checkoutBody,
      });
      const merchantResponse = await fetch(manifest.checkout_endpoint, {
        method: "POST",
        headers,
        body: checkoutBody,
        redirect: "error",
      });
      const merchantDecision = (await merchantResponse.json()) as {
        error?: string;
        checks?: Record<string, boolean>;
        product?: { id: string };
      };
      if (!merchantResponse.ok || !merchantDecision.product) {
        return error(merchantDecision.error ?? "Merchant rejected checkout", merchantResponse.status);
      }
      merchantChecks = merchantDecision.checks ?? {};
    }

    const evaluation = await supabase.rpc("evaluate_agentpay_checkout", {
      p_mandate_id: activeMandate.data.id,
      p_agent_id:
        scenario === "unsigned" || scenario === "replay"
          ? `invalid_${agent.id}`
          : agent.id,
      p_merchant_id: product.merchantId,
      p_product_id: product.id,
      p_category: product.category,
      p_amount_cents: product.priceCents,
      p_currency: "BRL",
      p_exception_id: body.exception_id ?? null,
    });
    if (evaluation.error) throw new Error(evaluation.error.message);

    const { state } = await loadAuthenticatedState();
    const attempt = state.attempts.find(
      (candidate) => candidate.id === evaluation.data.attempt_id,
    );
    if (!attempt) throw new Error("Checkout attempt was not returned");
    attempt.request.scenario = `${body.source ?? "api"}:${scenario}`;
    if (scenario === "unsigned" || scenario === "replay") {
      attempt.request.signed = false;
      attempt.checks[0].status = "fail";
    } else if (Object.keys(merchantChecks).length) {
      attempt.checks[0].status = merchantChecks.agent_signature ? "pass" : "fail";
      attempt.checks[1].status = merchantChecks.mandate_signature ? "pass" : "fail";
      attempt.checks[2].status = merchantChecks.registry_status ? "pass" : "fail";
    }
    const base = publicBaseUrl(req);
    return json({
      attempt,
      decision: attempt.decision,
      reason_code: attempt.reason_code ?? null,
      payment_token: attempt.payment_token ?? null,
      approval_id: evaluation.data.approval_id ?? null,
      state,
      public_base_url: base,
      server_time: new Date().toISOString(),
    });
  });
}
