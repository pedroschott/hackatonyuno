export type MandateStatus = "draft" | "active" | "revoked" | "expired";

export type MandateScope = {
  merchants: string[];
  categories: string[];
};

export type MandateLimits = {
  per_purchase_cents: number;
  cumulative_cents: number;
  max_uses: number;
  period: "month";
  currency: "USD";
};

export type MandateValidity = {
  not_before: string;
  expires_at: string;
};

export type RegistryMandate = {
  mandate_id: string;
  type: "intent";
  issuer: { user_id: string };
  agent: { agent_id: string; public_key: string };
  scope: MandateScope;
  limits: MandateLimits;
  validity: MandateValidity;
  payment: { vault_card_id: string };
  authorization: {
    credential_id: string;
    mandate_hash: string;
    signed_at: string;
  } | null;
  server_sig: string | null;
  status: MandateStatus;
  usage: { approved_uses: number; cumulative_cents: number };
};

export type CheckoutCart = {
  mandate_id: string;
  merchant_id: string;
  product_id: string;
  category: string;
  amount_cents: number;
  currency: string;
  exception_id?: string;
};

export type PolicyReason =
  | "AGENT_SIGNATURE_INVALID"
  | "MANDATE_SIGNATURE_INVALID"
  | "MANDATE_NOT_FOUND"
  | "MANDATE_REVOKED"
  | "MANDATE_EXPIRED"
  | "MERCHANT_NOT_IN_SCOPE"
  | "CATEGORY_NOT_IN_SCOPE"
  | "CURRENCY_MISMATCH"
  | "USES_EXCEEDED"
  | "CUMULATIVE_EXCEEDED"
  | "AMOUNT_EXCEEDS_LIMIT";

export type PolicyDecision =
  | { decision: "approved"; reason_code: null }
  | { decision: "refused"; reason_code: PolicyReason }
  | { decision: "escalated"; reason_code: "AMOUNT_EXCEEDS_LIMIT" };

export type AgentPayMerchantManifest = {
  protocol: "agentpay/1.0";
  merchant: { id: string; name: string };
  checkout_endpoint: string;
  registry_url: string;
  capabilities: ["intent-mandates", "live-revocation", "mock-payment"];
};
