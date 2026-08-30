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

/**
 * Where an order is physically delivered. The buyer's registered address is the
 * default and is the one AgentPay verified; `ship_to` on a purchase overrides it
 * for that order only and is never stored on the account.
 */
export type ShippingAddress = {
  recipient: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postal_code: string;
  country_code: string;
  phone?: string;
  /** Free-text delivery note, e.g. "loading dock, ask for the shift lead". */
  instructions?: string;
};

export type ShippingAddressSource = "registered" | "custom";

/**
 * What the store commits to about getting the order there. Returned with every
 * checkout decision so the agent can tell the buyer when the part arrives and
 * what the delivery costs before the mandate is charged.
 */
export type Fulfillment = {
  address_source: ShippingAddressSource;
  ships_to: ShippingAddress;
  /** Store's own service name, e.g. "Local courier" or "Ground". */
  method: string;
  carrier?: string;
  ship_from?: string;
  /** Human sentence: "Ships within 2 business hours". */
  handling_time: string;
  estimated_delivery: {
    /** ISO 8601 dates, earliest and latest the store commits to. */
    earliest: string;
    latest: string;
    /** Human sentence the agent can repeat verbatim, e.g. "Tomorrow, Sep 1". */
    text: string;
  };
  shipping_cents: number;
  currency: string;
  notes?: string[];
};

/**
 * The amount the mandate is actually evaluated against. Shipping is inside it:
 * a buyer's per-purchase limit covers what is charged, not the sticker price.
 */
export type CheckoutCharge = {
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  currency: string;
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
  | "AMOUNT_EXCEEDS_LIMIT"
  | "SHIPPING_ADDRESS_UNSUPPORTED";

export type PolicyDecision =
  | { decision: "approved"; reason_code: null }
  | { decision: "refused"; reason_code: PolicyReason }
  | { decision: "escalated"; reason_code: "AMOUNT_EXCEEDS_LIMIT" };

export type AgentPayCapability =
  | "intent-mandates"
  | "live-revocation"
  | "mock-payment"
  | "catalog-search"
  /** The store accepts a per-order `shipping_address` and quotes delivery back. */
  | "custom-shipping";

export type AgentPayMerchantManifest = {
  protocol: "agentpay/1.0";
  merchant: { id: string; name: string };
  checkout_endpoint: string;
  registry_url: string;
  /** Known values are listed in AgentPayCapability; unknown values are ignored. */
  capabilities: string[];
  /** Store-owned catalog endpoint. Optional: merchants on SDK 0.1.0 omit it. */
  catalog_endpoint?: string;
  /** Exact category slugs a mandate may be scoped to at this merchant. */
  categories?: string[];
  /** Currency every product is quoted in and every mandate must be denominated in. */
  currency?: string;
  /** Template containing `{id}`, resolved against the store origin, for a product page. */
  product_url_template?: string;
  documentation_url?: string;
  /** ISO 3166-1 alpha-2 country codes the store delivers to. Omitted means unstated. */
  ships_to?: string[];
};

export type AgentPayCatalogProduct = {
  product_id: string;
  name: string;
  category: string;
  price_cents: number;
  currency: string;
  description?: string;
  sku?: string;
  brand?: string;
  availability?: "in_stock" | "out_of_stock";
  url?: string;
};

export type AgentPayCatalogQuery = {
  q: string | null;
  category: string | null;
  product_id: string | null;
  max_price_cents: number | null;
  limit: number;
};

export type AgentPayMerchantCatalog = {
  protocol: "agentpay-catalog/1.0";
  merchant: { id: string; name: string };
  currency: string;
  categories: string[];
  query: AgentPayCatalogQuery;
  /** Matches before `limit` was applied. */
  total: number;
  products: AgentPayCatalogProduct[];
};
