import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { DISPUTE_REASON_CODES, type DisputeAnalysis, type DisputeReasonCode } from "@/lib/disputes";

/**
 * Reads one dispute against the buyer's own purchase history at that merchant
 * and says what most likely happened.
 *
 * The history is the whole point. "I do not recognise this charge" against a
 * first order and against the fourth identical one are different claims, and the
 * thing that distinguishes them is not in the disputed row — it is in the rows
 * around it, including the reason the buyer gave the agent at the time.
 *
 * Two properties this deliberately keeps:
 *
 *   - It never decides. `recommendation` is advisory; a dispute's status only
 *     changes when a person sets it. A model that could close a case would be a
 *     new way to lose money without anyone having agreed to it.
 *   - It always answers. With no ANTHROPIC_API_KEY, or when the API fails, the
 *     deterministic reading below runs instead and says so in `engine`. A demo
 *     that silently loses a feature because a key is missing is worse than one
 *     that says which engine produced the answer.
 */

const MODEL = "claude-opus-5";

const analysisSchema = z.object({
  likely_cause: z.enum(DISPUTE_REASON_CODES),
  confidence: z.enum(["high", "medium", "low"]),
  summary: z.string(),
  evidence: z.array(z.string()),
  recommendation: z.enum(["refund", "uphold", "request_evidence"]),
  recommendation_rationale: z.string(),
});

export type DisputeContext = {
  merchant_id: string;
  buyer_ref: string;
  dispute: {
    id: string;
    reason_code: DisputeReasonCode;
    status: string;
    amount_cents: number;
    currency: string;
    buyer_statement: string;
    created_at: string;
  };
  disputed_purchase: {
    id: string;
    created_at: string;
    product_id: string;
    amount_cents: number;
    shipping_cents: number | null;
    purchase_reason: string | null;
    shipping_address_source: string | null;
    fulfillment: {
      method?: string;
      estimated_delivery?: { earliest?: string; latest?: string; text?: string };
    } | null;
  } | null;
  mandate: {
    id: string;
    status: string;
    scope: { merchants: string[]; categories: string[] };
    limits: Record<string, unknown>;
    natural_language_description: string | null;
    created_at: string;
    revoked_at: string | null;
  } | null;
  purchase_history: Array<{
    id: string;
    created_at: string;
    product_id: string;
    product_name: string | null;
    amount_cents: number;
    decision: string;
    reason_code: string | null;
    purchase_reason: string | null;
    shipping_address_source: string | null;
    estimated_delivery: string | null;
    shipping_method: string | null;
  }>;
  prior_disputes: Array<{
    id: string;
    created_at: string;
    reason_code: string;
    status: string;
    amount_cents: number;
  }>;
};

/** Facts a person could count themselves, computed once and shared by both engines. */
function signals(context: DisputeContext, now: Date): DisputeAnalysis["signals"] {
  const approved = context.purchase_history.filter((row) => row.decision === "approved");
  const disputedProductId = context.disputed_purchase?.product_id;
  const latest = context.disputed_purchase?.fulfillment?.estimated_delivery?.latest;
  return {
    purchases_at_merchant: approved.length,
    prior_disputes: context.prior_disputes.length,
    repeat_product_purchase:
      Boolean(disputedProductId) &&
      approved.filter((row) => row.product_id === disputedProductId).length > 1,
    shipped_to_custom_address: context.disputed_purchase?.shipping_address_source === "custom",
    delivery_window_passed: Boolean(latest) && new Date(`${latest}T23:59:59Z`) < now,
  };
}

export async function analyzeDispute(
  context: DisputeContext,
  options: { now?: Date; apiKey?: string | null } = {},
): Promise<DisputeAnalysis> {
  const now = options.now ?? new Date();
  const computed = signals(context, now);
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!apiKey) return ruleBasedAnalysis(context, computed, now, "No ANTHROPIC_API_KEY is configured.");

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt(context, computed, now) }],
      output_config: { format: zodOutputFormat(analysisSchema) },
    });
    const parsed = response.parsed_output;
    if (!parsed) {
      return ruleBasedAnalysis(context, computed, now, "The model returned no parseable analysis.");
    }
    return {
      ...parsed,
      signals: computed,
      model: response.model ?? MODEL,
      engine: "claude",
      generated_at: now.toISOString(),
    };
  } catch (error) {
    return ruleBasedAnalysis(
      context,
      computed,
      now,
      error instanceof Error ? error.message : "The analysis request failed.",
    );
  }
}

const SYSTEM_PROMPT = `You review payment disputes for AgentPay, where purchases are made by an autonomous agent under a spending mandate the account holder signed with a passkey.

Two things about this record are unusual and you should lean on both:
- Every purchase carries a purchase_reason: what the buyer asked for, in their own words, at the moment the agent bought it. A personal reason such as "I just want it" is legitimate and is not evidence of anything.
- Every purchase names the mandate that allowed it, with its scope and limits. A charge inside an active mandate was authorised even if the buyer now regrets it; that distinction matters to the recommendation.

Read the disputed charge against the buyer's history at this merchant. Say what most likely happened and what the merchant should do.

Rules:
- Ground every claim in the supplied record. Cite specific rows, dates, amounts and quoted purchase reasons in evidence. Never invent an order, a delivery, a refund or a conversation.
- likely_cause is your reading of what happened, which may differ from the reason the buyer selected. Say so in the summary when it does.
- Recommend refund when the record supports the buyer, uphold when it contradicts them, and request_evidence when the deciding fact is genuinely not in the record — say which fact.
- "regret" is not "unauthorised". A charge inside a live mandate, matching the buyer's own stated reason, is authorised; recommend uphold and say plainly that the mandate covered it.
- Be brief. summary is two or three sentences a support agent can act on. Do not moralise and do not hedge every sentence.`;

function userPrompt(context: DisputeContext, computed: DisputeAnalysis["signals"], now: Date): string {
  return [
    `Today is ${now.toISOString().slice(0, 10)}.`,
    "",
    "## The dispute",
    JSON.stringify(context.dispute, null, 2),
    "",
    "## The charge being disputed",
    JSON.stringify(context.disputed_purchase, null, 2),
    "",
    "## The mandate that allowed it",
    JSON.stringify(context.mandate, null, 2),
    "",
    `## This buyer's other purchases at this merchant (${context.purchase_history.length})`,
    JSON.stringify(context.purchase_history, null, 2),
    "",
    `## This buyer's prior disputes at this merchant (${context.prior_disputes.length})`,
    JSON.stringify(context.prior_disputes, null, 2),
    "",
    "## Counts already computed for you",
    JSON.stringify(computed, null, 2),
  ].join("\n");
}

/**
 * The offline reading. It is not a smaller model — it is a handful of checks a
 * support agent would make first, so the console still answers when the API key
 * is absent or the request fails, and so a judge changing inputs live always
 * gets a response.
 */
export function ruleBasedAnalysis(
  context: DisputeContext,
  computed: DisputeAnalysis["signals"],
  now: Date,
  note: string,
): DisputeAnalysis {
  const evidence: string[] = [];
  const purchase = context.disputed_purchase;
  const mandate = context.mandate;

  if (purchase?.purchase_reason) {
    evidence.push(`The agent recorded the buyer's own reason at the time: "${purchase.purchase_reason}".`);
  }
  if (mandate) {
    evidence.push(
      `Mandate ${mandate.id} was ${mandate.status} and covered categories ${mandate.scope.categories.join(", ")} at ${mandate.scope.merchants.join(", ")}.`,
    );
  }
  evidence.push(
    `${computed.purchases_at_merchant} approved purchase(s) at this merchant, ${computed.prior_disputes} prior dispute(s).`,
  );
  if (computed.shipped_to_custom_address) {
    evidence.push("This order shipped to a one-off address rather than the registered one.");
  }
  const window = purchase?.fulfillment?.estimated_delivery?.text;
  if (window) {
    evidence.push(
      `The merchant quoted delivery ${window}; that window ${computed.delivery_window_passed ? "has passed" : "has not passed yet"}.`,
    );
  }
  if (computed.repeat_product_purchase) {
    evidence.push("The same product was bought more than once under this account at this merchant.");
  }

  const claimed = context.dispute.reason_code;
  let likelyCause: DisputeReasonCode = claimed;
  let recommendation: DisputeAnalysis["recommendation"] = "request_evidence";
  let rationale = "The deciding fact is not in the record; ask the buyer for it.";
  let summary = `Buyer reports "${claimed}" on a ${(context.dispute.amount_cents / 100).toFixed(2)} ${context.dispute.currency} charge.`;

  if (claimed === "not_received" && !computed.delivery_window_passed) {
    recommendation = "request_evidence";
    rationale = "The quoted delivery window has not passed yet, so the order is not late.";
    summary = `${summary} The merchant's own estimate has not elapsed, so this is early rather than missing.`;
  } else if (claimed === "not_received" && computed.delivery_window_passed) {
    recommendation = "refund";
    rationale = "The merchant's own quoted delivery window has passed with no delivery reported.";
    summary = `${summary} The delivery window the merchant quoted has passed.`;
  } else if (claimed === "duplicate_charge" && computed.repeat_product_purchase) {
    recommendation = "request_evidence";
    rationale = "The same product was bought more than once, which the buyer's own recorded reasons may explain.";
    summary = `${summary} The account did buy this product more than once, so this may be intentional rather than duplicated.`;
  } else if (
    (claimed === "not_recognized" || claimed === "outside_mandate") &&
    mandate &&
    purchase?.purchase_reason
  ) {
    likelyCause = "other";
    recommendation = "uphold";
    rationale =
      "The purchase was made under a signed mandate that covered it, and the buyer's own reason was recorded at the time.";
    summary = `${summary} The charge was inside mandate ${mandate.id} and the buyer's stated reason was recorded, so this reads as regret rather than an unauthorised charge.`;
  }

  return {
    likely_cause: likelyCause,
    confidence: "low",
    summary: `${summary} Produced without the model: ${note}`,
    evidence,
    recommendation,
    recommendation_rationale: rationale,
    signals: computed,
    model: "deterministic-rules-v1",
    engine: "rules",
    generated_at: now.toISOString(),
  };
}

export { signals as disputeSignals };
