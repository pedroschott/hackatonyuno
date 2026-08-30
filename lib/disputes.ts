/**
 * Disputes are the corrective control. Every other rule in AgentPay is
 * preventive — a mandate refuses what it does not cover — but a charge that was
 * inside the mandate and still wrong needs somewhere to go. The buyer opens one
 * against a single approved attempt; the merchant answers it; both read the same
 * timeline.
 */

export const DISPUTE_REASON_CODES = [
  "not_recognized",
  "not_received",
  "not_as_described",
  "duplicate_charge",
  "wrong_amount",
  "outside_mandate",
  "cancelled_order",
  "other",
] as const;

export type DisputeReasonCode = (typeof DISPUTE_REASON_CODES)[number];

export const DISPUTE_STATUSES = [
  "open",
  "under_review",
  "evidence_requested",
  "resolved_refunded",
  "resolved_upheld",
  "withdrawn",
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** Statuses a merchant may set. A buyer withdraws; only a merchant resolves. */
export const MERCHANT_DISPUTE_STATUSES = [
  "under_review",
  "evidence_requested",
  "resolved_refunded",
  "resolved_upheld",
] as const;

export type MerchantDisputeStatus = (typeof MERCHANT_DISPUTE_STATUSES)[number];

export const DISPUTE_REASON_LABELS: Record<DisputeReasonCode, string> = {
  not_recognized: "I do not recognise this charge",
  not_received: "It never arrived",
  not_as_described: "It is not what was ordered",
  duplicate_charge: "I was charged twice for the same thing",
  wrong_amount: "The amount is wrong",
  outside_mandate: "My agent should not have bought this",
  cancelled_order: "I cancelled this order",
  other: "Something else",
};

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  open: "Open",
  under_review: "Under review",
  evidence_requested: "Evidence requested",
  resolved_refunded: "Refunded",
  resolved_upheld: "Charge upheld",
  withdrawn: "Withdrawn",
};

export function isOpenDispute(status: DisputeStatus): boolean {
  return status === "open" || status === "under_review" || status === "evidence_requested";
}

export function disputeTone(status: DisputeStatus): "success" | "danger" | "warn" | "neutral" {
  if (status === "resolved_refunded") return "success";
  if (status === "resolved_upheld") return "danger";
  if (status === "withdrawn") return "neutral";
  return "warn";
}

export type Dispute = {
  id: string;
  attempt_id: string;
  merchant_id: string;
  mandate_id: string | null;
  reason_code: DisputeReasonCode;
  status: DisputeStatus;
  amount_cents: number;
  currency: string;
  buyer_statement: string;
  merchant_response: string | null;
  resolution: string | null;
  resolved_at: string | null;
  analysis: DisputeAnalysis | null;
  analyzed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DisputeEvent = {
  id: string;
  dispute_id: string;
  actor: "buyer" | "merchant" | "agentpay" | "analysis";
  action: string;
  detail: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

/**
 * What the model produces from one dispute plus the buyer's history at that
 * merchant. It is advisory: `recommendation` is a suggestion a person accepts or
 * rejects, and nothing here changes a dispute's status on its own.
 */
export type DisputeAnalysis = {
  likely_cause: DisputeReasonCode;
  confidence: "high" | "medium" | "low";
  summary: string;
  evidence: string[];
  recommendation: "refund" | "uphold" | "request_evidence";
  recommendation_rationale: string;
  /** Counts a person can check against the history themselves. */
  signals: {
    purchases_at_merchant: number;
    prior_disputes: number;
    repeat_product_purchase: boolean;
    shipped_to_custom_address: boolean;
    delivery_window_passed: boolean;
  };
  model: string;
  /** "claude" when the model produced it, "rules" for the offline fallback. */
  engine: "claude" | "rules";
  generated_at: string;
};

export const DISPUTE_FIELDS =
  "id, attempt_id, merchant_id, mandate_id, reason_code, status, amount_cents, currency, buyer_statement, merchant_response, resolution, resolved_at, analysis, analyzed_at, created_at, updated_at";
