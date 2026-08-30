import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { evaluatePolicy } from "@/lib/agentpay-policy";
import {
  appendAudit,
  ensureAgent,
  getAgentPrivateKey,
  getOwnedPaymentCard,
} from "@/lib/data";
import { isIdentityVerified } from "@/lib/didit";
import type {
  AgentPayCatalogProduct,
  AgentPayMerchantManifest,
  Fulfillment,
  MandateLimits,
  MandateScope,
  MandateValidity,
  RegistryMandate,
} from "@/lib/domain";
import { agentPayBaseUrl } from "@/lib/env";
import { loadLatestIdentityVerification } from "@/lib/identity-verification";
import {
  describeMandate,
  explainDecision,
  formatMoney,
  isMerchantId,
  mandateStateGuidance,
  MERCHANT_ID_PATTERN,
  normalizeCategories,
  validateCategories,
  type GuidanceContext,
} from "@/lib/mcp/guidance";
import { createPaymentSetupToken } from "@/lib/payment-setup";
import { auditSentence } from "@/lib/plain";
import { verifyChain } from "@/lib/seed";
import type { AuditEntry } from "@/lib/types";
import {
  formatShippingAddress,
  isDeliverable,
  mergeShippingAddress,
  registeredShippingAddress,
  SHIPPING_FIELDS,
  type CustomerProfileRow,
  type ResolvedShipping,
} from "@/lib/shipping";
import { createBearerSupabase } from "@/lib/supabase/bearer";
import { discoverAgentPayCatalog, discoverAgentPayMerchant, signAgentPayRequest } from "@/sdk";

const DEFAULT_EXPIRY_DAYS = 7;
const MANDATE_FIELDS =
  "id, status, agent_id, scope, limits, validity, payment, origin, natural_language_description, created_at, revoked_at";

type MandateRow = {
  id: string;
  status: "draft" | "active" | "revoked" | "expired" | "declined";
  agent_id: string;
  scope: MandateScope;
  limits: MandateLimits;
  validity: MandateValidity;
  payment: { vault_card_id: string };
  origin: Record<string, unknown> | null;
  natural_language_description: string | null;
  created_at: string;
  revoked_at: string | null;
};

type ResolvedMerchant = {
  id: string;
  name: string;
  store_url: string;
  manifest_url: string;
  manifest: AgentPayMerchantManifest;
  categories: string[] | null;
};

/**
 * Every tool returns the same data twice: as structuredContent for clients
 * that render it, and as JSON text for models that only read `content`. An
 * agent that cannot see the mandate id or product id it was just given is the
 * root of most retry loops.
 */
function mcpResult(data: Record<string, unknown>, narration: string) {
  return {
    structuredContent: data,
    content: [
      { type: "text" as const, text: narration },
      { type: "text" as const, text: JSON.stringify(data) },
    ],
  };
}

function authContext(ctx: ServerContext) {
  const auth = ctx.http?.authInfo;
  const userId = auth?.extra?.userId;
  if (!auth?.token || typeof userId !== "string") throw new Error("Authenticated AgentPay account required");
  return {
    token: auth.token,
    userId,
    origin: typeof auth.extra?.origin === "string" ? auth.extra.origin : agentPayBaseUrl(),
    supabase: createBearerSupabase(auth.token),
  };
}

type Auth = ReturnType<typeof authContext>;

/**
 * Hosted test stores live under AgentPay's own origin, so their manifest is
 * not at /.well-known. Everything else follows the protocol: any URL on the
 * merchant resolves to its origin's well-known document.
 */
function manifestUrlFor(merchantUrl: string, agentPayOrigin: string): string {
  const url = new URL(merchantUrl);
  if (url.origin === agentPayOrigin) {
    const hosted = url.pathname.match(/^\/(?:api\/)?stores\/([^/]+)/);
    if (hosted) return new URL(`/api/stores/${hosted[1]}/agentpay.json`, url.origin).toString();
  }
  return merchantUrl;
}

async function resolveMerchant(merchantUrl: string, agentPayOrigin: string): Promise<ResolvedMerchant> {
  const manifestUrl = manifestUrlFor(merchantUrl, agentPayOrigin);
  const manifest = await discoverAgentPayMerchant(manifestUrl);
  let categories = manifest.categories ? normalizeCategories(manifest.categories) : null;
  if (!categories && manifest.catalog_endpoint) {
    const catalog = await discoverAgentPayCatalog(manifest, { limit: 1 });
    categories = normalizeCategories(catalog.categories);
  }
  return {
    id: manifest.merchant.id,
    name: manifest.merchant.name,
    store_url: new URL(merchantUrl).origin === agentPayOrigin ? merchantUrl : new URL(merchantUrl).origin,
    manifest_url: manifestUrl.endsWith("agentpay.json")
      ? manifestUrl
      : new URL("/.well-known/agentpay.json", manifestUrl).toString(),
    manifest,
    categories,
  };
}

async function resolveMerchants(urls: string[], agentPayOrigin: string): Promise<ResolvedMerchant[]> {
  const unique = Array.from(new Set(urls.map((url) => manifestUrlFor(url, agentPayOrigin))));
  const resolved = await Promise.all(unique.map((url) => resolveMerchant(url, agentPayOrigin)));
  const byId = new Map<string, ResolvedMerchant>();
  for (const merchant of resolved) byId.set(merchant.id, merchant);
  return Array.from(byId.values());
}

async function loadMandate(auth: Auth, mandateId: string): Promise<MandateRow> {
  const result = await auth.supabase.from("mandates").select(MANDATE_FIELDS).eq("id", mandateId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Mandate not found in this AgentPay account. Call get_account to list mandates.");
  return result.data as MandateRow;
}

async function registryMandate(auth: Auth, mandateId: string): Promise<RegistryMandate | null> {
  const result = await auth.supabase.rpc("get_mandate_registry", { p_mandate_id: mandateId });
  if (result.error || !result.data) return null;
  return result.data as RegistryMandate;
}

function effectiveStatus(row: MandateRow, now = new Date()): MandateRow["status"] {
  if (row.status === "active" && now > new Date(row.validity.expires_at)) return "expired";
  return row.status;
}

function authorizationUrl(origin: string, mandateId: string) {
  return `${origin}/m/mandates/${mandateId}`;
}

function approvalUrl(origin: string, approvalId: string) {
  return `${origin}/m/approvals/${approvalId}`;
}

function mandateView(row: MandateRow, registry: RegistryMandate | null, origin: string) {
  const status = effectiveStatus(row);
  const usage = registry?.usage ?? { approved_uses: 0, cumulative_cents: 0 };
  const remaining = {
    uses: Math.max(0, row.limits.max_uses - usage.approved_uses),
    cumulative_cents: Math.max(0, row.limits.cumulative_cents - usage.cumulative_cents),
  };
  const state = mandateStateGuidance(status, { authorizationUrl: authorizationUrl(origin, row.id) });
  const supersedes = typeof row.origin?.supersedes === "string" ? row.origin.supersedes : null;
  return {
    mandate_id: row.id,
    status,
    summary: describeMandate(row.scope, row.limits, row.validity),
    scope: row.scope,
    limits: row.limits,
    validity: row.validity,
    usage,
    remaining,
    payment_method_id: row.payment.vault_card_id,
    natural_language_description: row.natural_language_description,
    ...(supersedes ? { replaces_mandate_id: supersedes } : {}),
    ...(status === "draft" ? { authorization_url: authorizationUrl(origin, row.id) } : {}),
    revoked_at: row.revoked_at,
    can_purchase: state.can_purchase,
    next_step: state.next_step,
    next_tool: state.next_tool,
  };
}

function expiryFrom(input: { expires_at?: string; expires_in_days?: number }, fallback?: string): string {
  if (input.expires_at) return input.expires_at;
  if (input.expires_in_days) return new Date(Date.now() + input.expires_in_days * 86_400_000).toISOString();
  if (fallback && new Date(fallback) > new Date()) return fallback;
  return new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86_400_000).toISOString();
}

function assertLimits(limits: MandateLimits, expiresAt: string) {
  if (limits.cumulative_cents < limits.per_purchase_cents) {
    throw new Error("cumulative_cents must be at least per_purchase_cents");
  }
  if (new Date(expiresAt) <= new Date()) throw new Error("Expiry must be in the future");
}

async function catalogProduct(
  manifest: AgentPayMerchantManifest,
  productId: string,
): Promise<AgentPayCatalogProduct | null> {
  if (!manifest.catalog_endpoint) return null;
  const catalog = await discoverAgentPayCatalog(manifest, { productId, limit: 1 });
  return catalog.products.find((product) => product.product_id === productId) ?? null;
}

function guidanceContext(input: {
  row?: MandateRow;
  registry?: RegistryMandate | null;
  merchant?: { id: string; name: string };
  product?: { category: string; price_cents: number; currency: string } | null;
  approvalId?: string | null;
  origin: string;
}): GuidanceContext {
  const usage = input.registry?.usage;
  return {
    mandateId: input.row?.id,
    merchantId: input.merchant?.id,
    merchantName: input.merchant?.name,
    category: input.product?.category,
    scopeMerchants: input.row?.scope.merchants,
    scopeCategories: input.row?.scope.categories,
    amountCents: input.product?.price_cents,
    currency: input.product?.currency,
    mandateCurrency: input.row?.limits.currency,
    perPurchaseCents: input.row?.limits.per_purchase_cents,
    cumulativeRemainingCents:
      input.row && usage ? Math.max(0, input.row.limits.cumulative_cents - usage.cumulative_cents) : undefined,
    usesRemaining: input.row && usage ? Math.max(0, input.row.limits.max_uses - usage.approved_uses) : undefined,
    approvalId: input.approvalId ?? undefined,
    approvalUrl: input.approvalId ? approvalUrl(input.origin, input.approvalId) : undefined,
    authorizationUrl: input.row ? authorizationUrl(input.origin, input.row.id) : undefined,
  };
}

const merchantUrlsField = z
  .array(z.url())
  .max(10)
  .optional()
  .describe(
    "Preferred. Store URLs from the user or from find_products (a product page, storefront or /.well-known/agentpay.json). AgentPay resolves each one to its exact merchant id and checks the categories against that store's catalog before the user is asked to sign.",
  );
const merchantIdsField = z
  .array(z.string().regex(MERCHANT_ID_PATTERN, "Merchant ids look like mrc_…; pass merchant_urls to resolve a store"))
  .max(10)
  .optional()
  .describe("Exact mrc_… ids returned by find_products. Never a store name, domain or URL.");
const categoriesField = z
  .array(z.string().min(1))
  .max(10)
  .describe('Exact category slugs from find_products (for example "tires"). Lowercase; a category the store does not sell is rejected here rather than at purchase time.');
const perPurchaseField = z
  .number()
  .int()
  .positive()
  .describe("Maximum price of one purchase in minor units (USD cents). Set it at or above products[].price_cents of what the user wants.");
const cumulativeField = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Monthly total across all purchases, in cents. Defaults to per_purchase_cents × max_uses.");
const maxUsesField = z.number().int().positive().max(100).optional().describe("How many purchases the mandate allows. Defaults to 1.");
const expiresInDaysField = z
  .number()
  .int()
  .positive()
  .max(365)
  .optional()
  .describe("Validity from now, in days. Defaults to 7 when expires_at is omitted.");
const expiresAtField = z.iso.datetime().optional().describe("Absolute ISO 8601 expiry. Prefer expires_in_days unless the user named a date.");
const descriptionField = z
  .string()
  .max(500)
  .optional()
  .describe("The user's request in their own words. Shown to them on the signing screen so they can check it matches.");

/**
 * Required on every purchase. Months later, a buyer reading a charge they do not
 * recognise has the mandate (what was allowed) and the attempt (what was bought)
 * but nothing about the request that caused it. "I just want it" is a complete
 * and acceptable answer; an invented business justification is not.
 */
const purchaseReasonField = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .describe(
    "Required. Why the user is buying this, in their own words — quote or closely paraphrase their request. A personal reason such as \"I just want it\" is fine; never invent a justification they did not give. Shown to them in the purchase trail and to the merchant when a charge is disputed.",
  );

const shipToField = z
  .object({
    recipient: z.string().trim().min(1).max(120).optional().describe("Defaults to the registered recipient."),
    line1: z.string().trim().min(1).max(160).describe("Street address."),
    line2: z.string().trim().max(160).optional(),
    city: z.string().trim().min(1).max(100),
    region: z.string().trim().max(100).optional().describe("State, province or region."),
    postal_code: z.string().trim().min(3).max(20),
    country_code: z.string().trim().length(2).optional().describe("ISO 3166-1 alpha-2. Defaults to the registered country."),
    phone: z.string().trim().max(32).optional(),
    instructions: z.string().trim().max(280).optional().describe("Delivery note, e.g. \"loading dock, ask for the shift lead\"."),
  })
  .optional()
  .describe(
    "Optional one-off delivery address. Omit it and the order goes to the buyer's registered address, which AgentPay already holds — do not ask for an address you were not given. Send this only when the user said the order goes somewhere else. It applies to this order alone and is never saved to the account.",
  );

/**
 * Resolves the address one order ships to: the registered one, or the
 * registered one with the user's one-off override merged over it.
 */
async function resolveShipping(
  auth: Auth,
  shipTo: z.infer<typeof shipToField>,
): Promise<{ shipping: ResolvedShipping } | { missing: string[] }> {
  const profile = await auth.supabase.from("customer_profiles").select(SHIPPING_FIELDS).maybeSingle();
  if (profile.error) throw new Error(profile.error.message);
  const registered = registeredShippingAddress((profile.data as CustomerProfileRow | null) ?? null);
  if (!shipTo) {
    return "missing" in registered ? { missing: registered.missing } : { shipping: { address: registered.address, source: "registered" } };
  }
  const address = mergeShippingAddress("missing" in registered ? null : registered.address, shipTo);
  if (!isDeliverable(address)) {
    // The override was partial and the registered address could not fill the
    // gaps, so neither address alone is deliverable.
    return { missing: "missing" in registered ? registered.missing : ["recipient"] };
  }
  return { shipping: { address, source: "custom" } };
}

export function registerAgentPayTools(server: McpServer) {
  server.registerTool(
    "get_account",
    {
      title: "Get AgentPay account",
      description:
        "Start here. Returns identity-verification state, saved cards, every mandate with its status and summary, and pending one-time approvals. Tells you the single next step for this account.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async (_input, ctx) => {
      const auth = authContext(ctx);
      const [profile, identityVerification, cards, mandates, approvals, attempts] = await Promise.all([
        auth.supabase
          .from("customer_profiles")
          .select("legal_name, tax_id, phone, address_line1, address_line2, city, region, postal_code, country_code, updated_at")
          .maybeSingle(),
        loadLatestIdentityVerification(auth.supabase),
        auth.supabase
          .from("vault_cards")
          .select("id, brand, last4, label, is_default, created_at")
          .order("is_default", { ascending: false })
          .order("created_at"),
        auth.supabase.from("mandates").select(MANDATE_FIELDS).order("created_at", { ascending: false }),
        auth.supabase.from("approvals").select("id, mandate_id, attempt_id, status, created_at").eq("status", "pending"),
        auth.supabase
          .from("attempts")
          .select("mandate_id, decision, created_at")
          .eq("decision", "approved")
          .order("created_at", { ascending: false }),
      ]);
      const error = profile.error ?? cards.error ?? mandates.error ?? approvals.error ?? attempts.error;
      if (error) throw new Error(error.message);
      const mandateRows = (mandates.data ?? []) as MandateRow[];
      const cardRows = (cards.data ?? []).map((card) => {
        const mandateIds = new Set(
          mandateRows.filter((mandate) => mandate.payment?.vault_card_id === card.id).map((mandate) => mandate.id),
        );
        const uses = (attempts.data ?? []).filter((attempt) => mandateIds.has(attempt.mandate_id));
        return {
          ...card,
          successful_purchase_count: uses.length,
          last_used_at: uses[0]?.created_at ?? null,
        };
      });
      const approvalRows = (approvals.data ?? []).map((approval) => ({
        ...approval,
        approval_url: approvalUrl(auth.origin, approval.id),
      }));
      const identityReady = isIdentityVerified(identityVerification);
      const verificationUrl = `${auth.origin}/account`;
      const registered = registeredShippingAddress((profile.data as CustomerProfileRow | null) ?? null);
      const orderProfile = profile.data
        ? {
            ...profile.data,
            compliance_ready: Boolean(profile.data.legal_name && profile.data.tax_id),
            fulfillment_ready: !("missing" in registered),
            // The address every order defaults to. An agent that has this never
            // needs to ask a chat participant where to send someone's parcel.
            registered_shipping_address: "missing" in registered ? null : registered.address,
            missing_address_fields: "missing" in registered ? registered.missing : [],
            sharing_note:
              "Use this personal data only for a checkout the user explicitly requested, and share only the fields the merchant needs. Pass ship_to on purchase only when the user says this order goes somewhere else; it applies to that order alone.",
          }
        : null;
      const mandateViews = mandateRows.map((row) => mandateView(row, null, auth.origin));
      const active = mandateViews.filter((mandate) => mandate.status === "active");
      const drafts = mandateViews.filter((mandate) => mandate.status === "draft");
      const nextStep = !identityReady
        ? `Identity verification is required before any mandate can be signed or used. Send the user to ${verificationUrl}, wait, then call get_account again.`
        : cardRows.length === 0
          ? "No payment method is saved. Call get_payment_setup_link and wait for the user to finish in the browser."
          : drafts.length > 0
            ? `A draft is waiting for the user's passkey: ${drafts[0].authorization_url}. Do not create another mandate for the same request.`
            : active.length > 0
              ? "An active mandate exists. Call find_products on the store, then check_purchase and purchase under it."
              : "Call find_products on the store the user named, then create_mandate with the exact merchant and category values it returns.";
      return mcpResult(
        {
          order_profile: orderProfile,
          identity_verification: {
            status: identityVerification?.status ?? "Required",
            entity_status: identityVerification?.entity_status ?? null,
            verified: identityReady,
            verification_url: verificationUrl,
          },
          cards: cardRows,
          mandates: mandateViews,
          pending_approvals: approvalRows,
          next_step: nextStep,
        },
        `AgentPay is connected. ${cardRows.length} card(s), ${active.length} active mandate(s), ${drafts.length} draft(s) awaiting signature, ${approvalRows.length} pending approval(s). Next: ${nextStep}`,
      );
    },
  );

  server.registerTool(
    "get_payment_setup_link",
    {
      title: "Get secure payment setup link",
      description:
        "Use this when the AgentPay account has no saved payment method or the user asks to add one. Returns a short-lived browser link and accepts no card details. Never request or accept a full card number, CVC, PIN, bank password, or vault credential in chat.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Creating secure payment setup link",
        "openai/toolInvocation/invoked": "Secure payment setup link ready",
      },
    },
    async (_input, ctx) => {
      const auth = authContext(ctx);
      const cards = await auth.supabase
        .from("vault_cards")
        .select("id, brand, last4, label, is_default, created_at")
        .order("is_default", { ascending: false })
        .order("created_at");
      if (cards.error) throw new Error(cards.error.message);
      const { token, expiresAt } = createPaymentSetupToken(auth.userId);
      const setupUrl = `${auth.origin}/payment-methods/setup?token=${encodeURIComponent(token)}`;
      const savedCards = cards.data ?? [];
      return mcpResult(
        {
          status: savedCards.length === 0 ? "payment_method_required" : "ready_to_add_another",
          saved_cards: savedCards,
          setup_url: setupUrl,
          expires_at: expiresAt,
          safety: {
            agent_receives_card_details: false,
            agent_can_authorize_purchase: false,
            agent_visible_fields: ["payment_method_id", "brand", "last4"],
            never_share_in_chat: ["full_card_number", "cvc", "pin", "bank_password", "vault_credential"],
          },
          next_step:
            "Ask the user to open setup_url and complete payment setup inside AgentPay. Wait for them to return, then call get_account again before creating a mandate.",
        },
        `Open ${setupUrl} to add a payment method securely inside AgentPay. Do not send card details in chat: the agent never sees or uses the full card number, CVC, PIN, bank password, or vault credential. Saving a payment method does not approve a purchase. After setup, return here so I can check the account and prepare the passkey-limited mandate. This link expires at ${expiresAt}.`,
      );
    },
  );

  server.registerTool(
    "find_products",
    {
      title: "Find products at a store",
      description:
        "Use this first for any store. Give it any URL on the merchant (a product page, the storefront, or its /.well-known/agentpay.json) and it returns the exact merchant id, category slugs, currency, prices in cents and product ids that create_mandate and purchase require. Never guess those values from a page, a name, a SKU or a URL slug. AgentPay is not a store directory; the URL must come from the user or from search.",
      inputSchema: z.object({
        merchant_url: z.url().describe("Any URL on the store's own domain."),
        query: z
          .string()
          .max(200)
          .optional()
          .describe("Free-text search. Every word must appear in the product name, description, SKU, brand or category."),
        category: z.string().max(80).optional().describe("Exact category slug to filter by."),
        max_price_cents: z.number().int().positive().optional().describe("Only products at or below this price, in cents."),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum products to return. Defaults to 10."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (input, ctx) => {
      const auth = authContext(ctx);
      const manifestUrl = manifestUrlFor(input.merchant_url, auth.origin);
      const manifest = await discoverAgentPayMerchant(manifestUrl);
      const merchant = {
        id: manifest.merchant.id,
        name: manifest.merchant.name,
        store_url: input.merchant_url,
        checkout_endpoint: manifest.checkout_endpoint,
        catalog_endpoint: manifest.catalog_endpoint ?? null,
      };
      if (!manifest.catalog_endpoint) {
        const categories = manifest.categories ? normalizeCategories(manifest.categories) : null;
        return mcpResult(
          {
            merchant,
            catalog_available: false,
            currency: manifest.currency ?? null,
            categories,
            products: [],
            next_step:
              'This store accepts AgentPay but publishes no catalog endpoint. Read the product page itself: the exact product id is in its <meta name="agentpay:product_id"> tag or JSON-LD "productID". Then call check_purchase or purchase with that exact id and this merchant_url.',
          },
          `${manifest.merchant.name} (${manifest.merchant.id}) accepts AgentPay but has no searchable catalog. Take the product id from the product page metadata, never from its name or URL.${
            categories ? ` Mandate categories it accepts: ${categories.join(", ")}.` : ""
          }`,
        );
      }
      const catalog = await discoverAgentPayCatalog(manifest, {
        q: input.query,
        category: input.category,
        maxPriceCents: input.max_price_cents,
        limit: input.limit,
      });
      const productCategories = normalizeCategories(catalog.products.map((product) => product.category));
      const maxPrice = catalog.products.reduce((max, product) => Math.max(max, product.price_cents), 0);
      const mandateHint = {
        merchant_urls: [input.merchant_url],
        merchant_ids: [manifest.merchant.id],
        categories: productCategories.length > 0 ? productCategories : catalog.categories,
        currency: catalog.currency,
        per_purchase_cents: maxPrice || null,
      };
      return mcpResult(
        {
          merchant,
          catalog_available: true,
          currency: catalog.currency,
          categories: catalog.categories,
          query: catalog.query,
          total: catalog.total,
          products: catalog.products,
          mandate_hint: mandateHint,
          next_step:
            catalog.products.length === 0
              ? "No product matched. Retry with a broader query, another category from `categories`, or a higher max_price_cents."
              : "Confirm the product with the user. If no active mandate covers this merchant and category, call create_mandate with mandate_hint. Then check_purchase and purchase with products[].product_id verbatim.",
        },
        `Found ${catalog.products.length} of ${catalog.total} matching product(s) at ${manifest.merchant.name} (${manifest.merchant.id}), priced in ${catalog.currency} cents. Use products[].product_id verbatim. A mandate for this store needs merchant_urls ["${input.merchant_url}"] and categories from ${JSON.stringify(mandateHint.categories)}${
          maxPrice ? `, with per_purchase_cents at least ${maxPrice} (${formatMoney(maxPrice, catalog.currency)})` : ""
        }.`,
      );
    },
  );

  server.registerTool(
    "create_mandate",
    {
      title: "Create purchase mandate",
      description:
        "Use this after find_products, when the user has described what may be bought and within which limits. Creates an unsigned draft and returns the authorization_url the user must open to sign with their passkey. Validation happens here: an unknown merchant or a category the store does not sell fails now, not at purchase time. Never create a second mandate while a draft for the same request is waiting.",
      inputSchema: z.object({
        merchant_urls: merchantUrlsField,
        merchant_ids: merchantIdsField,
        categories: categoriesField.min(1),
        per_purchase_cents: perPurchaseField,
        cumulative_cents: cumulativeField,
        max_uses: maxUsesField,
        expires_in_days: expiresInDaysField,
        expires_at: expiresAtField,
        vault_card_id: z.uuid().optional().describe("Saved card id from get_account. Defaults to the account's default card."),
        natural_language_description: descriptionField,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    },
    async (input, ctx) => {
      const auth = authContext(ctx);
      const merchants = await resolveMerchants(input.merchant_urls ?? [], auth.origin);
      const merchantIds = Array.from(
        new Set([...merchants.map((merchant) => merchant.id), ...(input.merchant_ids ?? [])]),
      );
      if (merchantIds.length === 0) {
        throw new Error("Pass merchant_urls (preferred) or merchant_ids. Get them from find_products; never invent a merchant id.");
      }
      const vocabulary = merchants.flatMap((merchant) => merchant.categories ?? []);
      const categories = validateCategories(
        input.categories,
        vocabulary.length > 0 ? vocabulary : undefined,
        merchants.map((merchant) => merchant.name).join(", ") || "This store",
      );
      const maxUses = input.max_uses ?? 1;
      const limits: MandateLimits = {
        per_purchase_cents: input.per_purchase_cents,
        cumulative_cents: input.cumulative_cents ?? input.per_purchase_cents * maxUses,
        max_uses: maxUses,
        period: "month",
        currency: "USD",
      };
      const expiresAt = expiryFrom(input);
      assertLimits(limits, expiresAt);
      const foreignCurrency = merchants.find((merchant) => merchant.manifest.currency && merchant.manifest.currency !== "USD");
      if (foreignCurrency) {
        throw new Error(
          `${foreignCurrency.name} quotes ${foreignCurrency.manifest.currency}, but mandates are denominated in USD and AgentPay never converts. Choose a merchant that quotes USD.`,
        );
      }
      const card = await getOwnedPaymentCard(auth.supabase, input.vault_card_id);
      if (!card) {
        throw new Error(
          input.vault_card_id
            ? "The selected card was not found in this AgentPay account. Call get_account for the saved card ids."
            : "No saved card is available. Call get_payment_setup_link and wait for the user to finish payment setup.",
        );
      }
      const agent = await ensureAgent(auth.supabase, auth.userId);
      const scope: MandateScope = { merchants: merchantIds, categories };
      const validity: MandateValidity = { not_before: new Date().toISOString(), expires_at: expiresAt };
      const created = await auth.supabase
        .from("mandates")
        .insert({
          issuer_user_id: auth.userId,
          agent_id: agent.id,
          scope,
          limits,
          validity,
          payment: { vault_card_id: card.id },
          natural_language_description: input.natural_language_description ?? null,
          origin: { via: "api", requested_at: new Date().toISOString(), merchant_urls: input.merchant_urls ?? [] },
        })
        .select(MANDATE_FIELDS)
        .single();
      if (created.error) throw new Error(created.error.message);
      const row = created.data as MandateRow;
      await appendAudit(auth.supabase, `agent:${agent.id}`, "mandate.created", row.id, {
        source: "mcp",
        scope,
        limits,
        payment_method_id: card.id,
      });
      const view = mandateView(row, null, auth.origin);
      const unverified = merchantIds.filter((id) => !merchants.some((merchant) => merchant.id === id));
      return mcpResult(
        {
          ...view,
          merchants: merchants.map((merchant) => ({ id: merchant.id, name: merchant.name, store_url: merchant.store_url })),
          ...(unverified.length > 0 ? { unverified_merchant_ids: unverified } : {}),
          selected_card: { id: card.id, brand: card.brand, last4: card.last4, label: card.label, is_default: card.is_default },
        },
        `Draft mandate ${row.id} created: ${view.summary}. It charges ${card.brand} ending ${card.last4}. Send the user ${view.authorization_url} to sign with their passkey, then call get_mandate. Do not purchase or create another mandate until it reports active.${
          unverified.length > 0
            ? ` Merchant id(s) ${unverified.join(", ")} were taken verbatim and not checked against a manifest; ${isMerchantId(unverified[0]) ? "pass merchant_urls next time to validate them" : ""}.`
            : ""
        }`,
      );
    },
  );

  server.registerTool(
    "amend_mandate",
    {
      title: "Amend a mandate (widen scope, raise limits, extend expiry)",
      description:
        "Use this instead of revoke_mandate when a purchase was refused with MERCHANT_NOT_IN_SCOPE, CATEGORY_NOT_IN_SCOPE, CUMULATIVE_EXCEEDED or USES_EXCEEDED, or when the user wants to change what the mandate allows. An unsigned draft is edited in place. A signed mandate is immutable, so this proposes a replacement that carries everything forward plus your changes; the user signs it once and the old mandate is revoked automatically at that moment, never earlier.",
      inputSchema: z.object({
        mandate_id: z.uuid().describe("The mandate to amend, from get_account or get_mandate."),
        add_merchant_urls: merchantUrlsField,
        add_categories: categoriesField.optional(),
        per_purchase_cents: perPurchaseField.optional(),
        cumulative_cents: cumulativeField,
        max_uses: maxUsesField,
        expires_in_days: expiresInDaysField,
        expires_at: expiresAtField,
        natural_language_description: descriptionField,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    },
    async (input, ctx) => {
      const auth = authContext(ctx);
      const row = await loadMandate(auth, input.mandate_id);
      const status = effectiveStatus(row);
      if (status === "declined") {
        throw new Error("The user declined this mandate. Ask what they would accept before proposing another.");
      }
      const merchants = await resolveMerchants(input.add_merchant_urls ?? [], auth.origin);
      const addedCategories = input.add_categories
        ? validateCategories(
            input.add_categories,
            merchants.flatMap((merchant) => merchant.categories ?? []).length > 0
              ? merchants.flatMap((merchant) => merchant.categories ?? [])
              : undefined,
            merchants.map((merchant) => merchant.name).join(", ") || "This store",
          )
        : [];
      const scope: MandateScope = {
        merchants: Array.from(new Set([...row.scope.merchants, ...merchants.map((merchant) => merchant.id)])),
        categories: Array.from(new Set([...row.scope.categories, ...addedCategories])),
      };
      const perPurchase = input.per_purchase_cents ?? row.limits.per_purchase_cents;
      const maxUses = input.max_uses ?? row.limits.max_uses;
      const limits: MandateLimits = {
        ...row.limits,
        per_purchase_cents: perPurchase,
        max_uses: maxUses,
        cumulative_cents: input.cumulative_cents ?? Math.max(row.limits.cumulative_cents, perPurchase * maxUses),
      };
      const expiresAt = expiryFrom(input, row.validity.expires_at);
      assertLimits(limits, expiresAt);
      const changed =
        scope.merchants.length !== row.scope.merchants.length ||
        scope.categories.length !== row.scope.categories.length ||
        JSON.stringify(limits) !== JSON.stringify(row.limits) ||
        expiresAt !== row.validity.expires_at ||
        (input.natural_language_description !== undefined &&
          input.natural_language_description !== row.natural_language_description);
      if (!changed) {
        throw new Error("Nothing to amend: the mandate already covers this. Call get_mandate for its current state.");
      }
      const validity: MandateValidity = { not_before: new Date().toISOString(), expires_at: expiresAt };
      const description = input.natural_language_description ?? row.natural_language_description;
      const agent = await ensureAgent(auth.supabase, auth.userId);

      if (status === "draft") {
        const updated = await auth.supabase
          .from("mandates")
          .update({ scope, limits, validity, natural_language_description: description, updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("status", "draft")
          .select(MANDATE_FIELDS)
          .single();
        if (updated.error) throw new Error(updated.error.message);
        await appendAudit(auth.supabase, `agent:${agent.id}`, "mandate.draft_amended", row.id, { scope, limits, validity });
        const view = mandateView(updated.data as MandateRow, null, auth.origin);
        return mcpResult(
          { ...view, amended_in_place: true },
          `Updated the unsigned draft ${row.id}: ${view.summary}. The user still signs it at ${view.authorization_url}; call get_mandate afterwards.`,
        );
      }

      const card = (await getOwnedPaymentCard(auth.supabase, row.payment.vault_card_id)) ?? (await getOwnedPaymentCard(auth.supabase));
      if (!card) throw new Error("No saved card is available for the replacement. Call get_payment_setup_link first.");
      const created = await auth.supabase
        .from("mandates")
        .insert({
          issuer_user_id: auth.userId,
          agent_id: agent.id,
          scope,
          limits,
          validity,
          payment: { vault_card_id: card.id },
          natural_language_description: description,
          origin: {
            via: "api",
            requested_at: new Date().toISOString(),
            supersedes: row.id,
            merchant_urls: input.add_merchant_urls ?? [],
          },
        })
        .select(MANDATE_FIELDS)
        .single();
      if (created.error) throw new Error(created.error.message);
      const replacement = created.data as MandateRow;
      await appendAudit(auth.supabase, `agent:${agent.id}`, "mandate.replacement_requested", replacement.id, {
        supersedes: row.id,
        scope,
        limits,
        validity,
      });
      const view = mandateView(replacement, null, auth.origin);
      return mcpResult(
        {
          ...view,
          replaces_mandate_id: row.id,
          replaced_mandate_status: status,
          amended_in_place: false,
        },
        `Proposed replacement mandate ${replacement.id} for ${row.id}: ${view.summary}. Send the user ${view.authorization_url}. Mandate ${row.id} stays ${status} until they sign the replacement, at which point it is revoked automatically. Then call get_mandate with the new id.`,
      );
    },
  );

  server.registerTool(
    "get_mandate",
    {
      title: "Check mandate status",
      description:
        "Returns the live status, remaining uses and remaining budget of one mandate, plus the next step. A draft is not an error: it means the user has not signed yet, so keep the authorization_url in front of them and poll this tool. Use it before purchase and whenever a decision surprised you.",
      inputSchema: z.object({ mandate_id: z.uuid() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async ({ mandate_id }, ctx) => {
      const auth = authContext(ctx);
      const row = await loadMandate(auth, mandate_id);
      const registry = row.status === "draft" ? null : await registryMandate(auth, mandate_id);
      const view = mandateView(row, registry, auth.origin);
      return mcpResult(
        view,
        `Mandate ${mandate_id} is ${view.status}: ${view.summary}. Remaining: ${view.remaining.uses} purchase(s), ${formatMoney(view.remaining.cumulative_cents, row.limits.currency)}. ${view.next_step}`,
      );
    },
  );

  server.registerTool(
    "check_purchase",
    {
      title: "Check a purchase before making it",
      description:
        "Dry run. Evaluates the exact product against the mandate's live status, scope, limits and remaining budget without contacting the merchant's checkout and without recording an attempt. It also confirms the order has a deliverable address. Call it before purchase; if it says refused, follow remedy and next_tool instead of trying purchase repeatedly.",
      inputSchema: z.object({
        mandate_id: z.uuid(),
        merchant_url: z.url().describe("The same store URL you gave find_products."),
        product_id: z.string().min(1).describe("Exact products[].product_id from find_products."),
        purchase_reason: purchaseReasonField.optional().describe(
          "Optional here, required on purchase. Pass it so the returned purchase_args are ready to use verbatim.",
        ),
        ship_to: shipToField,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (input, ctx) => {
      const auth = authContext(ctx);
      const row = await loadMandate(auth, input.mandate_id);
      const manifest = await discoverAgentPayMerchant(manifestUrlFor(input.merchant_url, auth.origin));
      const merchant = { id: manifest.merchant.id, name: manifest.merchant.name };
      const identity = await loadLatestIdentityVerification(auth.supabase);
      const shipping = await resolveShipping(auth, input.ship_to);
      const purchaseArgs = {
        mandate_id: input.mandate_id,
        merchant_url: input.merchant_url,
        product_id: input.product_id,
        purchase_reason: input.purchase_reason ?? "<why the user wants this, in their own words>",
        ...(input.ship_to ? { ship_to: input.ship_to } : {}),
      };

      const respond = (
        wouldBe: "approved" | "escalated" | "refused",
        reasonCode: string | null,
        product: AgentPayCatalogProduct | null,
        registry: RegistryMandate | null,
      ) => {
        const guidance = explainDecision(
          wouldBe,
          reasonCode,
          guidanceContext({ row, registry, merchant, product, origin: auth.origin }),
        );
        const view = mandateView(row, registry, auth.origin);
        return mcpResult(
          {
            checked: true,
            would_be: wouldBe,
            reason_code: reasonCode,
            ...guidance,
            product,
            merchant,
            mandate: { mandate_id: row.id, status: view.status, remaining: view.remaining, scope: row.scope, limits: row.limits },
            ships_to: "missing" in shipping ? null : shipping.shipping.address,
            shipping_address_source: "missing" in shipping ? null : shipping.shipping.source,
            ...("missing" in shipping
              ? { missing_address_fields: shipping.missing, address_url: `${auth.origin}/account` }
              : {}),
            purchase_args: purchaseArgs,
            attempt_recorded: false,
          },
          wouldBe === "approved"
            ? `Purchase of ${product?.name ?? input.product_id} for ${formatMoney(product?.price_cents ?? 0, product?.currency)} would be approved under mandate ${row.id}. Call purchase with purchase_args.`
            : `Purchase would be ${wouldBe}${reasonCode ? ` (${reasonCode})` : ""}: ${guidance.explanation} ${guidance.remedy}`,
        );
      };

      if (!isIdentityVerified(identity)) return respond("refused", "IDENTITY_VERIFICATION_REQUIRED", null, null);
      if ("missing" in shipping) return respond("refused", "SHIPPING_ADDRESS_REQUIRED", null, null);
      if (!manifest.catalog_endpoint) {
        return mcpResult(
          {
            checked: false,
            reason: "MERCHANT_HAS_NO_CATALOG",
            merchant,
            mandate: mandateView(row, null, auth.origin),
            next_step:
              "This store publishes no catalog, so the price and category are only known at checkout. Confirm get_mandate reports active and the scope names this merchant, then call purchase; a refusal records an attempt but charges nothing.",
            purchase_args: purchaseArgs,
          },
          `${merchant.name} has no catalog endpoint, so the purchase cannot be simulated. Mandate ${row.id} is ${effectiveStatus(row)} and covers ${row.scope.merchants.join(", ")}.`,
        );
      }
      const product = await catalogProduct(manifest, input.product_id);
      if (!product) return respond("refused", "PRODUCT_NOT_FOUND", null, null);
      const status = effectiveStatus(row);
      if (status === "draft") return respond("refused", "MANDATE_DRAFT", product, null);
      if (status === "declined") return respond("refused", "MANDATE_NOT_FOUND", product, null);
      const registry = await registryMandate(auth, row.id);
      if (!registry) return respond("refused", "MANDATE_NOT_FOUND", product, null);
      const decision = evaluatePolicy(registry, {
        mandate_id: row.id,
        merchant_id: merchant.id,
        product_id: product.product_id,
        category: product.category,
        amount_cents: product.price_cents,
        currency: product.currency,
      });
      return respond(decision.decision, decision.reason_code, product, registry);
    },
  );

  server.registerTool(
    "search_security_log",
    {
      title: "Search the account's security log",
      description:
        "The account's hash-chained record of everything that happened: mandate requests and signatures, revocations, every purchase decision, one-time approvals, payment-method changes and disputes. Use it to answer questions about the past — \"what did I buy at that store\", \"when was that mandate revoked\", \"why was that charge refused\" — instead of guessing from what you remember of this conversation. Pass attempt_id or mandate_id to pull the full trail of one purchase or one mandate. Every result carries the hash-chain verification, so you can say whether the record has been edited.",
      inputSchema: z.object({
        query: z
          .string()
          .max(200)
          .optional()
          .describe("Free text. Every word must appear somewhere in the entry: its action, actor, entity id or payload."),
        action: z
          .string()
          .max(60)
          .optional()
          .describe('Exact action or prefix, e.g. "attempt.refused" or "mandate." for every mandate event.'),
        attempt_id: z.uuid().optional().describe("Every entry about one purchase, including any approval raised against it."),
        mandate_id: z.uuid().optional().describe("Every entry about one mandate, including purchases made under it."),
        merchant_id: z.string().max(80).optional().describe("Exact mrc_… id from find_products."),
        since: z.iso.datetime().optional().describe("Only entries at or after this ISO 8601 instant."),
        until: z.iso.datetime().optional().describe("Only entries at or before this ISO 8601 instant."),
        limit: z.number().int().positive().max(200).optional().describe("Newest first. Defaults to 25."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async (input, ctx) => {
      const auth = authContext(ctx);
      // The whole chain is read, not just the matches: verification is only
      // meaningful over an unbroken sequence, and a filtered slice would let a
      // removed entry pass unnoticed.
      const rows = await auth.supabase
        .from("audit_log")
        .select("seq, ts, actor, action, entity, payload, prev_hash, hash")
        .order("seq");
      if (rows.error) throw new Error(rows.error.message);
      const chain = (rows.data ?? []) as AuditEntry[];
      const integrity = verifyChain(chain);

      const tokens = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const since = input.since ? new Date(input.since).valueOf() : null;
      const until = input.until ? new Date(input.until).valueOf() : null;
      const limit = input.limit ?? 25;

      const matches = chain.filter((entry) => {
        const payload = entry.payload as Record<string, unknown>;
        const at = new Date(entry.ts).valueOf();
        if (since !== null && at < since) return false;
        if (until !== null && at > until) return false;
        if (input.action && !entry.action.startsWith(input.action)) return false;
        if (input.attempt_id && entry.entity !== input.attempt_id && payload.attempt_id !== input.attempt_id) return false;
        if (input.mandate_id && entry.entity !== input.mandate_id && payload.mandate_id !== input.mandate_id) return false;
        if (input.merchant_id && payload.merchant_id !== input.merchant_id) return false;
        if (tokens.length === 0) return true;
        const haystack = `${entry.action} ${entry.actor} ${entry.entity} ${JSON.stringify(payload)}`.toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      });

      const page = matches.slice(-limit).reverse();
      const entries = page.map((entry) => ({
        seq: entry.seq,
        at: entry.ts,
        actor: entry.actor,
        action: entry.action,
        // The same sentence the account holder reads in the security log, so the
        // agent and the screen never describe the same event differently.
        summary: auditSentence(entry.action),
        entity: entry.entity,
        payload: entry.payload,
        hash: entry.hash,
      }));

      const result = {
        entries,
        matched: matches.length,
        returned: entries.length,
        total_events: chain.length,
        integrity: {
          verified: integrity.ok,
          // A break means an entry was altered or removed after the fact.
          broken_at_seq: integrity.ok ? null : (integrity.brokenAt ?? null),
          note: integrity.ok
            ? "Every event hashes onto the one before it, so nothing has been altered or removed."
            : "The hash chain does not verify. Tell the user immediately and do not treat this history as reliable.",
        },
        security_log_url: `${auth.origin}/audit`,
        next_step:
          entries.length === 0
            ? "Nothing matched. Widen the query, drop a filter, or check the date range before telling the user something did not happen."
            : "Quote the summaries and timestamps back to the user. Payloads carry the mandate, merchant, product, amount and reason code behind each event.",
      };
      return mcpResult(
        result,
        `${matches.length} of ${chain.length} security-log event(s) matched; returning the newest ${entries.length}. Hash chain ${integrity.ok ? "verifies" : `BREAKS at event ${integrity.brokenAt}`}.`,
      );
    },
  );

  server.registerTool(
    "revoke_mandate",
    {
      title: "Revoke purchase mandate",
      description:
        "Use this immediately when the user asks the agent to stop, cancel, or revoke autonomous purchasing under a mandate. Revocation is final and takes effect on the very next checkout. Do not use it to fix scope or limits: that is amend_mandate.",
      inputSchema: z.object({ mandate_id: z.uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ mandate_id }, ctx) => {
      const auth = authContext(ctx);
      const result = await auth.supabase.rpc("revoke_agentpay_mandate", { p_mandate_id: mandate_id });
      if (result.error) throw new Error(result.error.message);
      return mcpResult(
        { ...result.data, next_step: "Tell the user nothing more can be charged under this mandate. Only create a new one if they explicitly ask." },
        `Mandate ${mandate_id} is revoked. Every future purchase attempt under it will be refused.`,
      );
    },
  );

  server.registerTool(
    "purchase",
    {
      title: "Purchase with AgentPay",
      description:
        "Buys one product under an active mandate. Sends a signed checkout to the merchant, then makes the final atomic policy decision at the registry. Read the response: approved is done; escalated means send the user approval_url and call purchase again with exception_id; refused includes explanation, remedy and next_tool — follow them rather than retrying. Use products[].product_id from find_products verbatim. purchase_reason is required. The order ships to the buyer's registered address unless you pass ship_to. On approval the response carries fulfillment: the delivery method, the estimated window and the shipping charge — tell the user when it arrives.",
      inputSchema: z.object({
        mandate_id: z.uuid().describe("An active mandate id. Confirm with get_mandate or check_purchase first."),
        merchant_url: z.url().describe("The same store URL you gave find_products."),
        product_id: z.string().min(1).describe("Exact products[].product_id from find_products."),
        purchase_reason: purchaseReasonField,
        ship_to: shipToField,
        exception_id: z
          .uuid()
          .optional()
          .describe("Only when a previous purchase returned escalated and the user approved it: the approval_id from that response."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    },
    async (input, ctx) => {
      const auth = authContext(ctx);
      const row = await loadMandate(auth, input.mandate_id);
      const manifest = await discoverAgentPayMerchant(manifestUrlFor(input.merchant_url, auth.origin));
      const merchant = { id: manifest.merchant.id, name: manifest.merchant.name };
      const agent = await ensureAgent(auth.supabase, auth.userId);
      if (row.agent_id !== agent.id) throw new Error("Mandate belongs to another agent credential");

      const refuseEarly = (reasonCode: string, extra: Record<string, unknown> = {}) => {
        const guidance = explainDecision("refused", reasonCode, guidanceContext({ row, merchant, origin: auth.origin }));
        return mcpResult(
          {
            decision: "refused",
            reason_code: reasonCode,
            ...guidance,
            merchant,
            mandate: mandateView(row, null, auth.origin),
            attempt_recorded: false,
            ...extra,
          },
          `Purchase refused (${reasonCode}) before contacting the merchant: ${guidance.explanation} ${guidance.remedy}`,
        );
      };

      const identity = await loadLatestIdentityVerification(auth.supabase);
      if (!isIdentityVerified(identity)) {
        return refuseEarly("IDENTITY_VERIFICATION_REQUIRED", { verification_url: `${auth.origin}/account` });
      }
      if (row.status === "draft") return refuseEarly("MANDATE_DRAFT");

      // The address is settled before the store is contacted: a merchant that
      // quotes delivery needs it, and an incomplete profile is the buyer's to
      // fix in the browser, not something to improvise in chat.
      const resolved = await resolveShipping(auth, input.ship_to);
      if ("missing" in resolved) {
        return refuseEarly("SHIPPING_ADDRESS_REQUIRED", {
          missing_address_fields: resolved.missing,
          address_url: `${auth.origin}/account`,
        });
      }
      const { address: shippingAddress, source: shippingSource } = resolved.shipping;

      const privateKey = await getAgentPrivateKey(auth.supabase, auth.userId, agent.id);
      const checkoutBody = JSON.stringify({
        mandate_id: input.mandate_id,
        merchant_id: manifest.merchant.id,
        product_id: input.product_id,
        shipping_address: shippingAddress,
        shipping_address_source: shippingSource,
        purchase_reason: input.purchase_reason,
        ...(input.exception_id ? { exception_id: input.exception_id } : {}),
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
      const merchantDecision = (await merchantResponse.json().catch(() => ({}))) as {
        decision?: string;
        reason_code?: string | null;
        product?: { id: string; name?: string; category: string; price_cents: number; currency: string };
        charge?: { subtotal_cents: number; shipping_cents: number; total_cents: number; currency: string };
        fulfillment?: Fulfillment;
        checks?: Record<string, boolean>;
        error?: string;
        order_id?: string;
      };
      // A store that cannot deliver to this address says so before any limit is
      // spent, so the buyer gets an address to fix rather than a failed order.
      if (merchantDecision.reason_code === "SHIPPING_ADDRESS_UNSUPPORTED") {
        return refuseEarly("SHIPPING_ADDRESS_UNSUPPORTED", {
          ships_to: shippingAddress,
          merchant_ships_to: manifest.ships_to ?? null,
        });
      }
      if (!merchantResponse.ok || !merchantDecision.product) {
        const reasonCode =
          merchantResponse.status === 401
            ? "AGENT_SIGNATURE_INVALID"
            : merchantResponse.status === 404
              ? "PRODUCT_NOT_FOUND"
              : (merchantDecision.reason_code ?? "MERCHANT_REJECTED");
        return refuseEarly(reasonCode, {
          merchant_status: merchantResponse.status,
          merchant_error: merchantDecision.error ?? null,
          merchant_checks: merchantDecision.checks ?? null,
        });
      }
      // The mandate is checked against what the buyer is actually charged. A
      // store on SDK 0.2.0 sends no `charge`, so the product price stands in.
      const charge = merchantDecision.charge ?? {
        subtotal_cents: merchantDecision.product.price_cents,
        shipping_cents: 0,
        total_cents: merchantDecision.product.price_cents,
        currency: merchantDecision.product.currency,
      };
      const final = await auth.supabase.rpc("evaluate_agentpay_checkout", {
        p_mandate_id: input.mandate_id,
        p_agent_id: agent.id,
        p_merchant_id: manifest.merchant.id,
        p_product_id: merchantDecision.product.id,
        p_category: merchantDecision.product.category,
        p_amount_cents: charge.total_cents,
        p_currency: charge.currency,
        p_exception_id: input.exception_id ?? null,
        p_purchase_reason: input.purchase_reason,
        p_shipping_address: shippingAddress,
        p_shipping_source: shippingSource,
        p_shipping_cents: charge.shipping_cents,
        p_fulfillment: merchantDecision.fulfillment ?? null,
      });
      if (final.error) throw new Error(final.error.message);
      const decision = final.data.decision as "approved" | "escalated" | "refused";
      const registry = decision === "approved" ? null : await registryMandate(auth, row.id);
      const guidance = explainDecision(
        decision,
        final.data.reason_code ?? null,
        guidanceContext({
          row,
          registry,
          merchant,
          product: { ...merchantDecision.product, price_cents: charge.total_cents, currency: charge.currency },
          approvalId: final.data.approval_id ?? null,
          origin: auth.origin,
        }),
      );
      const result = {
        ...final.data,
        ...guidance,
        merchant,
        product: merchantDecision.product,
        charge,
        fulfillment: merchantDecision.fulfillment ?? null,
        ships_to: shippingAddress,
        shipping_address_source: shippingSource,
        purchase_reason: input.purchase_reason,
        merchant_checks: merchantDecision.checks,
        merchant_order_id: merchantDecision.order_id ?? null,
        payment_mode: "mock",
        attempt_recorded: true,
        ...(final.data.approval_id
          ? {
              approval_url: approvalUrl(auth.origin, final.data.approval_id),
              retry_with: { ...input, exception_id: final.data.approval_id },
            }
          : {}),
        mandate: mandateView(row, registry, auth.origin),
      };
      const total = formatMoney(charge.total_cents, charge.currency);
      const shippingNote = merchantDecision.fulfillment
        ? ` ${charge.shipping_cents > 0 ? `${formatMoney(charge.shipping_cents, charge.currency)} of that is delivery.` : "Delivery is free."} ${merchantDecision.fulfillment.method} to ${shippingSource === "custom" ? "the address the user gave" : "the registered address"} (${formatShippingAddress(shippingAddress)}), arriving ${merchantDecision.fulfillment.estimated_delivery.text}.`
        : "";
      const narration =
        decision === "approved"
          ? `Purchase approved: ${merchantDecision.product.name ?? merchantDecision.product.id} for ${total} at ${merchant.name}.${shippingNote} A mock single-use payment token was minted; no real money moved.`
          : decision === "escalated"
            ? `Purchase held for a one-time approval: ${guidance.explanation} Send the user ${result.approval_url}; once they approve, call purchase again with exception_id "${final.data.approval_id}".`
            : `Purchase refused (${final.data.reason_code}): ${guidance.explanation} ${guidance.remedy}`;
      return mcpResult(result, narration);
    },
  );
}
