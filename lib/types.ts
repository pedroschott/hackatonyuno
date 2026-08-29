// Domain types — mirror the Supabase schema in the tech spec (§4).

export type VaultCard = {
  id: string; // 'card_9281'
  brand: "mastercard" | "visa";
  last4: string; // NEVER more than last4, not even mocked
  label?: string;
};

export type Agent = {
  id: string; // 'agt_fleetbuyer'
  name: string;
  publicKey: string; // Ed25519, base64 (mock in v1)
  currentMandateId: string | null; // what the agent "holds"
};

export type Merchant = {
  id: string; // 'mrc_autoparts'
  name: string;
  category: string;
  agentReady: boolean;
};

export type Product = {
  id: string;
  merchantId: string;
  name: string;
  description: string;
  category: "tires" | "accessories";
  priceCents: number;
  sku: string;
};

export type MandateStatus = "draft" | "active" | "revoked" | "expired" | "declined";

export type MandateLimits = {
  per_purchase_cents: number;
  cumulative_cents: number;
  max_uses: number;
  period: "month";
  currency: "BRL";
};

export type MandateScope = { merchants: string[]; categories: string[] };
export type MandateValidity = { not_before: string; expires_at: string };

export type Mandate = {
  id: string; // 'mnd_...'
  type: "intent"; // AP2 Intent Mandate
  issuer: { user_id: string; display_name: string };
  agent: { agent_id: string; public_key: string };
  scope: MandateScope;
  limits: MandateLimits;
  validity: MandateValidity;
  payment: { vault_card_id: string };
  /** AP2 IntentMandate.natural_language_description — what the agent asked for, in words. Signed. */
  natural_language_description?: string;
  /** Who asked for this mandate and how it arrived. Not part of the signed canonical form. */
  origin?: { requested_by: string; via: "api" | "panel"; requested_at: string };
  authorization?: {
    method: "webauthn" | "simulated";
    webauthn_credential_id: string;
    assertion: string;
    challenge: string;
    signed_at: string;
  };
  server_sig?: string;
  status: MandateStatus;
  revoked_at?: string;
  declined_at?: string;
  created_at: string;
};

export type ReasonCode =
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
  | "AMOUNT_EXCEEDS_LIMIT"
  | "EXCEPTION_INVALID";

export type CheckId = "agent_signature" | "mandate_signature" | "registry_status" | "policy";
export type Check = {
  id: CheckId;
  label: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
};

export type Decision = "approved" | "refused" | "escalated";

export type PaymentToken = {
  token: string;
  allowance: {
    reason: "one_time";
    max_amount_cents: number;
    currency: "BRL";
    merchant_id: string;
    attempt_id: string;
    expires_at: string;
  };
};

export type Attempt = {
  id: string;
  mandate_id: string | null;
  agent_id: string;
  merchant_id: string;
  product_id: string;
  product_name: string;
  amount_cents: number;
  decision: Decision;
  reason_code?: ReasonCode;
  exception_id?: string;
  payment_token?: PaymentToken;
  checks: Check[];
  request: { signed: boolean; nonce: string; timestamp: string; scenario: string };
  created_at: string;
};

export type Approval = {
  id: string;
  attempt_id: string;
  cart_hash: string;
  amount_cents: number;
  product_name: string;
  merchant_id: string;
  status: "pending" | "approved" | "denied";
  exception_id?: string;
  consumed?: boolean;
  decided_by?: string;
  decided_at?: string;
  authorization?: { method: "webauthn" | "simulated"; assertion: string };
  created_at: string;
};

export type AuditEntry = {
  seq: number;
  ts: string;
  actor: string; // 'user:cfo' | 'agent:fleetbuyer' | 'merchant:autoparts' | 'judge' | 'registry'
  action: string; // mandate.created | mandate.authorized | mandate.revoked | attempt.approved | ...
  entity: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
};

export type Scenario =
  | "standard" // R$1,548 standard set — within limit
  | "premium" // R$1,720 premium set — over per-purchase → escalate
  | "accessory" // other category → CATEGORY_NOT_IN_SCOPE
  | "pneufast" // other merchant → MERCHANT_NOT_IN_SCOPE
  | "unsigned" // impersonation → AGENT_SIGNATURE_INVALID
  | "replay"; // reused nonce → AGENT_SIGNATURE_INVALID
