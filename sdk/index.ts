import { z } from "zod";

import {
  agentSigningMessage,
  signText,
  verifyText,
} from "@/lib/crypto";
import { canonicalJson } from "@/lib/canonical-json";
import type {
  AgentPayCatalogProduct,
  AgentPayCatalogQuery,
  AgentPayMerchantCatalog,
  AgentPayMerchantManifest,
  CheckoutCart,
  CheckoutCharge,
  Fulfillment,
  PolicyDecision,
  RegistryMandate,
  ShippingAddress,
  ShippingAddressSource,
} from "@/lib/domain";
import { evaluatePolicy } from "@/lib/agentpay-policy";

/**
 * Re-exported so a merchant can build fixtures and sign test requests without
 * depending on AgentPay internals. Everything here is generic Ed25519 and
 * canonical-JSON plumbing; none of it holds a secret.
 */
export {
  agentSigningMessage,
  generateEd25519KeyPair,
  signCanonical,
  signText,
  verifyText,
} from "@/lib/crypto";
export { canonicalJson } from "@/lib/canonical-json";
export { evaluatePolicy } from "@/lib/agentpay-policy";
export type {
  AgentPayCapability,
  AgentPayCatalogProduct,
  AgentPayCatalogQuery,
  AgentPayMerchantCatalog,
  AgentPayMerchantManifest,
  CheckoutCart,
  CheckoutCharge,
  Fulfillment,
  MandateStatus,
  PolicyDecision,
  PolicyReason,
  RegistryMandate,
  ShippingAddress,
  ShippingAddressSource,
} from "@/lib/domain";

/**
 * Manifest schema. Every field added after protocol 0.1.0 is optional so an
 * agent on the newest SDK still discovers a store that published the original
 * three-field document, and a store on the newest SDK is still readable by an
 * older agent that ignores what it does not know.
 */
const manifestSchema = z.object({
  protocol: z.literal("agentpay/1.0"),
  merchant: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  checkout_endpoint: z.url(),
  registry_url: z.url(),
  capabilities: z.array(z.string().min(1)).min(1),
  catalog_endpoint: z.url().optional(),
  categories: z.array(z.string().min(1)).optional(),
  currency: z.string().length(3).optional(),
  product_url_template: z.string().min(1).optional(),
  documentation_url: z.url().optional(),
  ships_to: z.array(z.string().length(2)).optional(),
});

const catalogProductSchema = z.object({
  product_id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  price_cents: z.number().int().positive(),
  currency: z.string().length(3),
  description: z.string().optional(),
  sku: z.string().optional(),
  brand: z.string().optional(),
  availability: z.enum(["in_stock", "out_of_stock"]).optional(),
  url: z.url().optional(),
});

const catalogSchema = z.object({
  protocol: z.literal("agentpay-catalog/1.0"),
  merchant: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  currency: z.string().length(3),
  categories: z.array(z.string().min(1)),
  query: z.object({
    q: z.string().nullable(),
    category: z.string().nullable(),
    product_id: z.string().nullable(),
    max_price_cents: z.number().int().nullable(),
    limit: z.number().int(),
  }),
  total: z.number().int().nonnegative(),
  products: z.array(catalogProductSchema),
});

/**
 * A delivery address for one order. Exported so a store can validate an address
 * it received from somewhere else with exactly the rules the handler applies.
 */
export const shippingAddressSchema = z.object({
  recipient: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(160),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100).optional(),
  postal_code: z.string().trim().min(3).max(20),
  country_code: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase()),
  phone: z.string().trim().max(32).optional(),
  instructions: z.string().trim().max(280).optional(),
});

const checkoutBodySchema = z.object({
  mandate_id: z.uuid(),
  merchant_id: z.string().min(1),
  product_id: z.string().min(1),
  exception_id: z.uuid().optional(),
  /**
   * Where this order ships. Omitted means the buyer's registered address, which
   * AgentPay already holds; a store that needs the address to quote delivery
   * receives it here and never has to ask the agent for it in conversation.
   */
  shipping_address: shippingAddressSchema.optional(),
  shipping_address_source: z.enum(["registered", "custom"]).optional(),
  /** Why the agent is buying this, in the buyer's own terms. Recorded, never scored. */
  purchase_reason: z.string().trim().min(1).max(500).optional(),
});

export type MerchantProduct = {
  id: string;
  merchant_id: string;
  name: string;
  category: string;
  price_cents: number;
  currency: "USD";
};

export type MerchantCheckoutResult = PolicyDecision & {
  product?: MerchantProduct;
  /**
   * What the store will actually charge: the product plus the delivery it just
   * quoted. The registry evaluates `total_cents` against the mandate, so a limit
   * covers the whole charge rather than the sticker price.
   */
  charge?: CheckoutCharge;
  /** Present whenever the store resolved a delivery for this order. */
  fulfillment?: Fulfillment;
  checks: {
    agent_signature: boolean;
    mandate_signature: boolean;
    registry_status: boolean;
    policy: boolean;
  };
};

/** What `resolveFulfillment` is given: the priced product and where it must go. */
export type FulfillmentRequest = {
  product: MerchantProduct;
  address: ShippingAddress;
  address_source: ShippingAddressSource;
  now: Date;
};

type FetchLike = typeof fetch;

export const DEFAULT_CATALOG_LIMIT = 10;
export const MAX_CATALOG_LIMIT = 50;

export function merchantManifest(input: {
  origin: string;
  merchantId: string;
  merchantName: string;
  checkoutPath?: string;
  registryUrl?: string;
  /** Path of the catalog route built with createAgentPayCatalogHandler. */
  catalogPath?: string;
  /** Exact category slugs a buyer may scope a mandate to. Keep them coarse and stable. */
  categories?: string[];
  /** The currency every product is quoted in. Mandates must match it exactly. */
  currency?: string;
  /** Path template containing `{id}` for a product page, e.g. "/product/{id}". */
  productUrlTemplate?: string;
  documentationUrl?: string;
  /**
   * The store reads `shipping_address` on a checkout and quotes delivery back.
   * Advertise it so an agent knows it may send a one-off address instead of
   * defaulting to the buyer's registered one.
   */
  customShipping?: boolean;
  /** ISO 3166-1 alpha-2 codes the store delivers to. Omitted means unstated. */
  shipsTo?: string[];
}): AgentPayMerchantManifest {
  const origin = new URL(input.origin).origin;
  const capabilities = ["intent-mandates", "live-revocation", "mock-payment"];
  if (input.catalogPath) capabilities.push("catalog-search");
  if (input.customShipping) capabilities.push("custom-shipping");
  return {
    protocol: "agentpay/1.0",
    merchant: { id: input.merchantId, name: input.merchantName },
    checkout_endpoint: new URL(input.checkoutPath ?? "/api/store/checkout", origin).toString(),
    registry_url: input.registryUrl ? new URL(input.registryUrl).toString() : origin,
    capabilities,
    ...(input.catalogPath ? { catalog_endpoint: new URL(input.catalogPath, origin).toString() } : {}),
    ...(input.categories ? { categories: uniqueSlugs(input.categories) } : {}),
    ...(input.currency ? { currency: input.currency.toUpperCase() } : {}),
    ...(input.shipsTo?.length
      ? { ships_to: Array.from(new Set(input.shipsTo.map((code) => code.trim().toUpperCase()))).sort() }
      : {}),
    // Joined as text, not through URL, so the `{id}` placeholder survives.
    ...(input.productUrlTemplate
      ? { product_url_template: `${origin}${input.productUrlTemplate.startsWith("/") ? "" : "/"}${input.productUrlTemplate}` }
      : {}),
    ...(input.documentationUrl ? { documentation_url: new URL(input.documentationUrl).toString() } : {}),
  };
}

export async function discoverAgentPayMerchant(
  merchantUrl: string,
  fetcher: FetchLike = fetch,
): Promise<AgentPayMerchantManifest> {
  const candidate = new URL(merchantUrl);
  const manifestUrl = candidate.pathname.endsWith("agentpay.json")
    ? candidate
    : new URL("/.well-known/agentpay.json", candidate.origin);
  const response = await fetcher(manifestUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Merchant does not publish AgentPay discovery metadata (${response.status})`);
  }
  return manifestSchema.parse(await response.json());
}

export type CatalogSearch = {
  q?: string;
  category?: string;
  productId?: string;
  maxPriceCents?: number;
  limit?: number;
};

/**
 * Reads a store's catalog through the endpoint its manifest advertises. The
 * store does the filtering, so an agent asks one question and receives exact
 * product ids, categories and prices instead of scraping a rendered page.
 */
export async function discoverAgentPayCatalog(
  source: string | AgentPayMerchantManifest,
  search: CatalogSearch = {},
  fetcher: FetchLike = fetch,
): Promise<AgentPayMerchantCatalog> {
  const manifest = typeof source === "string" ? await discoverAgentPayMerchant(source, fetcher) : source;
  if (!manifest.catalog_endpoint) {
    throw new Error(`${manifest.merchant.name} does not publish an AgentPay catalog endpoint`);
  }
  const url = new URL(manifest.catalog_endpoint);
  if (search.q) url.searchParams.set("q", search.q);
  if (search.category) url.searchParams.set("category", search.category);
  if (search.productId) url.searchParams.set("product_id", search.productId);
  if (typeof search.maxPriceCents === "number") url.searchParams.set("max_price_cents", String(search.maxPriceCents));
  if (typeof search.limit === "number") url.searchParams.set("limit", String(search.limit));
  const response = await fetcher(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Merchant catalog is unavailable (${response.status})`);
  }
  const catalog = catalogSchema.parse(await response.json());
  if (catalog.merchant.id !== manifest.merchant.id) {
    throw new Error("Merchant manifest and catalog identify different merchants");
  }
  return catalog;
}

export function parseCatalogQuery(url: URL): AgentPayCatalogQuery {
  const q = url.searchParams.get("q")?.trim() || null;
  const category = url.searchParams.get("category")?.trim().toLowerCase() || null;
  const productId = url.searchParams.get("product_id")?.trim() || null;
  const rawMax = Number(url.searchParams.get("max_price_cents"));
  const rawLimit = Number(url.searchParams.get("limit"));
  return {
    q,
    category,
    product_id: productId,
    max_price_cents: Number.isInteger(rawMax) && rawMax > 0 ? rawMax : null,
    limit:
      Number.isInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_CATALOG_LIMIT)
        : DEFAULT_CATALOG_LIMIT,
  };
}

/**
 * Deterministic catalog filtering shared by every store on the SDK, so an agent
 * gets the same semantics everywhere: every search token must appear in the
 * product text, category and product id are exact, and in-stock items sort
 * first. Returns the matches before and after `limit`.
 */
export function filterCatalogProducts(
  products: AgentPayCatalogProduct[],
  query: AgentPayCatalogQuery,
): { total: number; products: AgentPayCatalogProduct[] } {
  const tokens = (query.q ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const matches = products.filter((product) => {
    if (query.product_id && product.product_id !== query.product_id) return false;
    if (query.category && product.category.toLowerCase() !== query.category) return false;
    if (query.max_price_cents !== null && product.price_cents > query.max_price_cents) return false;
    if (tokens.length === 0) return true;
    const haystack = [
      product.product_id,
      product.name,
      product.description ?? "",
      product.sku ?? "",
      product.brand ?? "",
      product.category,
    ]
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
  const ranked = [...matches].sort((a, b) => {
    const stockA = a.availability === "out_of_stock" ? 1 : 0;
    const stockB = b.availability === "out_of_stock" ? 1 : 0;
    return stockA - stockB;
  });
  return { total: matches.length, products: ranked.slice(0, query.limit) };
}

/**
 * Builds the catalog route a manifest advertises as `catalog_endpoint`. The
 * store keeps ownership of its products; the handler only makes them
 * addressable by exact id, category and price so an agent can size a mandate
 * and purchase without guessing.
 */
export function createAgentPayCatalogHandler(config: {
  merchantId: string;
  merchantName: string;
  currency: string;
  /** Defaults to the distinct categories of the products returned. */
  categories?: string[];
  products: () => Promise<AgentPayCatalogProduct[]> | AgentPayCatalogProduct[];
  /** Cache-control max-age in seconds. Defaults to 60. */
  maxAgeSeconds?: number;
}) {
  return async function catalog(request: Request): Promise<Response> {
    const query = parseCatalogQuery(new URL(request.url));
    const all = (await config.products()).map((product) => ({
      ...product,
      currency: (product.currency ?? config.currency).toUpperCase(),
    }));
    const { total, products } = filterCatalogProducts(all, query);
    const body: AgentPayMerchantCatalog = {
      protocol: "agentpay-catalog/1.0",
      merchant: { id: config.merchantId, name: config.merchantName },
      currency: config.currency.toUpperCase(),
      categories: config.categories ? uniqueSlugs(config.categories) : uniqueSlugs(all.map((p) => p.category)),
      query,
      total,
      products,
    };
    return Response.json(body, {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": `public, max-age=${config.maxAgeSeconds ?? 60}`,
      },
    });
  };
}

/**
 * Business-day delivery window in the shape `Fulfillment.estimated_delivery`
 * expects. Weekends are skipped because "2 days" from a Friday is not Sunday,
 * and an agent that repeats a Sunday date to a buyer has told them something
 * false. Dates are plain ISO `YYYY-MM-DD` in UTC: a delivery estimate is a day,
 * not an instant, and a timestamp would imply a precision no store has.
 */
export function deliveryWindow(input: {
  from: Date;
  minBusinessDays: number;
  maxBusinessDays: number;
}): Fulfillment["estimated_delivery"] {
  const earliest = addBusinessDays(input.from, input.minBusinessDays);
  const latest = addBusinessDays(input.from, Math.max(input.minBusinessDays, input.maxBusinessDays));
  const day = (date: Date) =>
    date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  return {
    earliest: earliest.toISOString().slice(0, 10),
    latest: latest.toISOString().slice(0, 10),
    text: earliest.getTime() === latest.getTime() ? day(earliest) : `${day(earliest)} – ${day(latest)}`,
  };
}

function addBusinessDays(from: Date, days: number): Date {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return date;
}

function uniqueSlugs(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))).sort();
}

export function signAgentPayRequest(input: {
  agentId: string;
  privateKey: string;
  method: string;
  url: string;
  body: string;
  now?: Date;
  nonce?: string;
}): Headers {
  const url = new URL(input.url);
  const timestamp = (input.now ?? new Date()).toISOString();
  const nonce = input.nonce ?? crypto.randomUUID();
  const signature = signText(
    input.privateKey,
    agentSigningMessage({
      method: input.method,
      path: url.pathname,
      body: input.body,
      timestamp,
      nonce,
    }),
  );

  return new Headers({
    "content-type": "application/json",
    "x-agent-id": input.agentId,
    "x-timestamp": timestamp,
    "x-nonce": nonce,
    "x-signature": signature,
  });
}

export function createAgentPayCheckoutHandler(config: {
  merchantId: string;
  registryUrl: string;
  resolveProduct: (productId: string) => Promise<MerchantProduct | null>;
  /**
   * Quotes delivery to the address on the request. Return `null` for an address
   * the store does not serve: the handler refuses with
   * `SHIPPING_ADDRESS_UNSUPPORTED` before any limit is spent. Omit this option
   * entirely and the store keeps SDK 0.2.0 behaviour — no delivery quote, and
   * the charge is the product price.
   */
  resolveFulfillment?: (request: FulfillmentRequest) => Promise<Fulfillment | null> | Fulfillment | null;
  fetcher?: FetchLike;
  now?: () => Date;
}) {
  return async function checkout(request: Request): Promise<Response> {
    const fetcher = config.fetcher ?? fetch;
    const now = config.now?.() ?? new Date();
    const rawBody = await request.text();
    const agentId = request.headers.get("x-agent-id");
    const timestamp = request.headers.get("x-timestamp");
    const nonce = request.headers.get("x-nonce");
    const signature = request.headers.get("x-signature");

    const invalidSignature = () =>
      Response.json(
        {
          decision: "refused",
          reason_code: "AGENT_SIGNATURE_INVALID",
          checks: {
            agent_signature: false,
            mandate_signature: false,
            registry_status: false,
            policy: false,
          },
        } satisfies MerchantCheckoutResult,
        { status: 401 },
      );

    if (!agentId || !timestamp || !nonce || !signature) {
      return invalidSignature();
    }

    const signedAt = new Date(timestamp);
    if (!Number.isFinite(signedAt.valueOf()) || Math.abs(now.valueOf() - signedAt.valueOf()) > 60_000) {
      return invalidSignature();
    }

    const agentResponse = await fetcher(
      new URL(`/api/registry/agents/${encodeURIComponent(agentId)}`, config.registryUrl),
      { headers: { Accept: "application/json" } },
    );
    if (!agentResponse.ok) {
      return invalidSignature();
    }
    const agent = z.object({ id: z.string(), public_key: z.string() }).parse(await agentResponse.json());
    const validAgentSignature = verifyText(
      agent.public_key,
      agentSigningMessage({
        method: request.method,
        path: new URL(request.url).pathname,
        body: rawBody,
        timestamp,
        nonce,
      }),
      signature,
    );
    if (!validAgentSignature) {
      return invalidSignature();
    }

    const nonceResponse = await fetcher(new URL("/api/registry/nonces", config.registryUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, nonce, timestamp }),
    });
    if (!nonceResponse.ok) {
      return invalidSignature();
    }

    const parsedBody = checkoutBodySchema.safeParse(JSON.parse(rawBody));
    if (!parsedBody.success || parsedBody.data.merchant_id !== config.merchantId) {
      return Response.json({ error: "Invalid checkout payload" }, { status: 400 });
    }

    const product = await config.resolveProduct(parsedBody.data.product_id);
    if (!product || product.merchant_id !== config.merchantId) {
      return Response.json({ error: "Product not found" }, { status: 404 });
    }

    const mandateResponse = await fetcher(
      new URL(`/api/registry/mandates/${parsedBody.data.mandate_id}`, config.registryUrl),
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    const mandate = mandateResponse.ok
      ? (z.custom<RegistryMandate>().parse(await mandateResponse.json()) as RegistryMandate)
      : null;
    const registryKeyResponse = await fetcher(new URL("/api/registry/keys", config.registryUrl), {
      headers: { Accept: "application/json" },
      cache: "force-cache",
    });
    const registryKey = registryKeyResponse.ok
      ? z.object({ algorithm: z.literal("Ed25519"), public_key: z.string() }).parse(await registryKeyResponse.json())
      : null;
    const mandateArtifact = mandate
      ? {
          mandate_id: mandate.mandate_id,
          type: mandate.type,
          issuer: mandate.issuer,
          agent: mandate.agent,
          scope: mandate.scope,
          limits: mandate.limits,
          validity: mandate.validity,
          payment: mandate.payment,
          ...(mandate.authorization ? { authorization: mandate.authorization } : {}),
        }
      : null;
    const mandateSignatureValid = Boolean(
      mandateArtifact &&
        mandate?.server_sig &&
        registryKey &&
        mandate.agent.agent_id === agentId &&
        mandate.agent.public_key === agent.public_key &&
        verifyText(registryKey.public_key, canonicalJson(mandateArtifact), mandate.server_sig),
    );
    // Delivery is quoted before the policy runs, because what the buyer is
    // charged — and therefore what the mandate limit has to cover — is the
    // product plus the shipping this exact address costs.
    let fulfillment: Fulfillment | undefined;
    if (config.resolveFulfillment) {
      const address = parsedBody.data.shipping_address;
      if (!address) {
        return Response.json(
          {
            decision: "refused",
            reason_code: "SHIPPING_ADDRESS_UNSUPPORTED",
            product,
            checks: { agent_signature: true, mandate_signature: false, registry_status: false, policy: false },
          } satisfies MerchantCheckoutResult,
          { status: 200 },
        );
      }
      const quoted = await config.resolveFulfillment({
        product,
        address,
        address_source: parsedBody.data.shipping_address_source ?? "registered",
        now,
      });
      if (!quoted) {
        return Response.json(
          {
            decision: "refused",
            reason_code: "SHIPPING_ADDRESS_UNSUPPORTED",
            product,
            checks: { agent_signature: true, mandate_signature: false, registry_status: false, policy: false },
          } satisfies MerchantCheckoutResult,
          { status: 200 },
        );
      }
      fulfillment = quoted;
    }

    const shippingCents = fulfillment?.shipping_cents ?? 0;
    const charge: CheckoutCharge = {
      subtotal_cents: product.price_cents,
      shipping_cents: shippingCents,
      total_cents: product.price_cents + shippingCents,
      currency: product.currency,
    };
    const cart: CheckoutCart = {
      mandate_id: parsedBody.data.mandate_id,
      merchant_id: config.merchantId,
      product_id: product.id,
      category: product.category,
      amount_cents: charge.total_cents,
      currency: product.currency,
      exception_id: parsedBody.data.exception_id,
    };
    const policy = mandateSignatureValid
      ? evaluatePolicy(mandate, cart, now)
      : ({ decision: "refused", reason_code: "MANDATE_SIGNATURE_INVALID" } as const);

    return Response.json({
      ...policy,
      product,
      charge,
      ...(fulfillment ? { fulfillment } : {}),
      checks: {
        agent_signature: true,
        mandate_signature: mandateSignatureValid,
        registry_status: mandate?.status === "active",
        policy: policy.decision === "approved",
      },
    } satisfies MerchantCheckoutResult);
  };
}
