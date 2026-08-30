export type MerchantEnvironment = "test" | "live";
export type MerchantVerificationStatus = "unverified" | "pending" | "verified" | "failed";

export type DeveloperMerchant = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  website_url: string | null;
  discovery_url: string | null;
  checkout_url: string | null;
  environment: MerchantEnvironment;
  hosted_store: boolean;
  publicly_listed: boolean;
  agent_ready: boolean;
  verification_status: MerchantVerificationStatus;
  verification_error: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DeveloperProduct = {
  id: string;
  merchant_id: string;
  name: string;
  description: string;
  category: string;
  sku: string;
  price_cents: number;
  currency: "USD";
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type MerchantApiKey = {
  id: string;
  merchant_id: string;
  name: string;
  environment: MerchantEnvironment;
  prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type MerchantAttempt = {
  id: string;
  merchant_id: string;
  product_id: string;
  amount_cents: number;
  shipping_cents: number | null;
  currency: string;
  decision: "approved" | "refused" | "escalated";
  reason_code: string | null;
  created_at: string;
  /** The buyer's own words for why the agent bought this. Required on every attempt. */
  purchase_reason: string | null;
  shipping_address_source: "registered" | "custom" | null;
  fulfillment: {
    method?: string;
    carrier?: string;
    estimated_delivery?: { text?: string };
    shipping_cents?: number;
  } | null;
};

export type SupportedStore = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  website_url: string;
  discovery_url: string;
};

export const MERCHANT_FIELDS =
  "id, name, category, description, website_url, discovery_url, checkout_url, environment, hosted_store, publicly_listed, agent_ready, verification_status, verification_error, last_verified_at, created_at, updated_at";

export const PRODUCT_FIELDS =
  "id, merchant_id, name, description, category, sku, price_cents, currency, active, created_at, updated_at";

export const API_KEY_FIELDS =
  "id, merchant_id, name, environment, prefix, last_used_at, expires_at, revoked_at, created_at";

export function formatMerchantId(id: string): string {
  return id.replace(/^mrc_/, "");
}

export function merchantTone(status: MerchantVerificationStatus) {
  if (status === "verified") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "pending") return "warn" as const;
  return "neutral" as const;
}
