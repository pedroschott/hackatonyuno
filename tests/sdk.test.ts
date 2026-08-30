import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/canonical-json";
import { generateEd25519KeyPair, signText } from "@/lib/crypto";
import type { AgentPayCatalogProduct, RegistryMandate } from "@/lib/domain";
import type { FulfillmentRequest } from "@/sdk";
import {
  createAgentPayCatalogHandler,
  createAgentPayCheckoutHandler,
  deliveryWindow,
  discoverAgentPayCatalog,
  discoverAgentPayMerchant,
  filterCatalogProducts,
  merchantManifest,
  parseCatalogQuery,
  signAgentPayRequest,
} from "@/sdk";

describe("merchant discovery", () => {
  it("discovers a store-owned well-known manifest", async () => {
    const manifest = merchantManifest({
      origin: "https://autoparts.example",
      merchantId: "mrc_autoparts",
      merchantName: "AutoParts",
      registryUrl: "https://agentpay.example",
    });
    const fetcher: typeof fetch = async (input) => {
      expect(input.toString()).toBe("https://autoparts.example/.well-known/agentpay.json");
      return Response.json(manifest);
    };
    await expect(discoverAgentPayMerchant("https://autoparts.example/products/tires", fetcher)).resolves.toEqual(
      manifest,
    );
  });

  it("advertises the catalog, categories, currency and product URL template when given", () => {
    const manifest = merchantManifest({
      origin: "https://autoparts.example/anything",
      merchantId: "mrc_autoparts",
      merchantName: "AutoParts",
      registryUrl: "https://agentpay.example",
      catalogPath: "/api/agentpay/catalog",
      categories: ["Tires", "accessories", "tires"],
      currency: "usd",
      productUrlTemplate: "/product/{id}",
    });
    expect(manifest.catalog_endpoint).toBe("https://autoparts.example/api/agentpay/catalog");
    expect(manifest.categories).toEqual(["accessories", "tires"]);
    expect(manifest.currency).toBe("USD");
    expect(manifest.product_url_template).toBe("https://autoparts.example/product/{id}");
    expect(manifest.capabilities).toContain("catalog-search");
  });

  it("still accepts the original three-field manifest from SDK 0.1.0", async () => {
    const legacy = {
      protocol: "agentpay/1.0",
      merchant: { id: "mrc_legacy", name: "Legacy Store" },
      checkout_endpoint: "https://legacy.example/api/agentpay/checkout",
      registry_url: "https://agentpay.example/",
      capabilities: ["intent-mandates", "live-revocation", "mock-payment"],
    };
    const fetcher: typeof fetch = async () => Response.json(legacy);
    const manifest = await discoverAgentPayMerchant("https://legacy.example/", fetcher);
    expect(manifest.merchant.id).toBe("mrc_legacy");
    expect(manifest.catalog_endpoint).toBeUndefined();
    await expect(discoverAgentPayCatalog(manifest, {}, fetcher)).rejects.toThrow(/does not publish an AgentPay catalog/);
  });
});

const PRODUCTS: AgentPayCatalogProduct[] = [
  { product_id: "prd_tire_std", name: "Standard tire set", description: "4× 205/55 R16 all-season", category: "tires", price_cents: 154_800, currency: "USD", sku: "TR-205-STD-4" },
  { product_id: "prd_tire_prm", name: "Premium tire set", description: "4× 205/55 R16 performance", category: "tires", price_cents: 172_000, currency: "USD", sku: "TR-205-PRM-4" },
  { product_id: "prd_acc_jack", name: "Hydraulic jack 2t", description: "Low-profile trolley jack", category: "accessories", price_cents: 38_900, currency: "USD", sku: "AC-JACK-2T", availability: "out_of_stock" },
  { product_id: "prd_acc_mats", name: "All-weather floor mats", description: "Set of 4", category: "accessories", price_cents: 12_900, currency: "USD", sku: "AC-MATS-4" },
];

describe("catalog filtering", () => {
  it("matches every search token across name, description, sku and category", () => {
    const query = parseCatalogQuery(new URL("https://s.example/api/catalog?q=tire%20205"));
    expect(filterCatalogProducts(PRODUCTS, query).products.map((p) => p.product_id)).toEqual(["prd_tire_std", "prd_tire_prm"]);
    expect(filterCatalogProducts(PRODUCTS, parseCatalogQuery(new URL("https://s.example/c?q=premium%20mats"))).total).toBe(0);
  });

  it("filters by exact category, price ceiling and product id, with in-stock items first", () => {
    const cheap = parseCatalogQuery(new URL("https://s.example/c?category=Accessories&max_price_cents=40000"));
    expect(filterCatalogProducts(PRODUCTS, cheap).products.map((p) => p.product_id)).toEqual(["prd_acc_mats", "prd_acc_jack"]);
    const exact = parseCatalogQuery(new URL("https://s.example/c?product_id=prd_tire_prm"));
    expect(filterCatalogProducts(PRODUCTS, exact).products).toHaveLength(1);
  });

  it("caps and defaults the limit while reporting the total", () => {
    expect(parseCatalogQuery(new URL("https://s.example/c")).limit).toBe(10);
    expect(parseCatalogQuery(new URL("https://s.example/c?limit=500")).limit).toBe(50);
    const one = filterCatalogProducts(PRODUCTS, parseCatalogQuery(new URL("https://s.example/c?limit=1")));
    expect(one.total).toBe(4);
    expect(one.products).toHaveLength(1);
  });
});

describe("catalog handler and discovery", () => {
  const handler = createAgentPayCatalogHandler({
    merchantId: "mrc_autoparts",
    merchantName: "AutoParts",
    currency: "USD",
    products: () => PRODUCTS,
  });

  it("serves the merchant's own products in the catalog shape", async () => {
    const response = await handler(new Request("https://autoparts.example/api/agentpay/catalog?q=jack"));
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json();
    expect(body).toMatchObject({
      protocol: "agentpay-catalog/1.0",
      merchant: { id: "mrc_autoparts", name: "AutoParts" },
      currency: "USD",
      categories: ["accessories", "tires"],
      total: 1,
      query: { q: "jack", category: null, product_id: null, max_price_cents: null, limit: 10 },
    });
    expect(body.products[0].product_id).toBe("prd_acc_jack");
  });

  it("lets an agent query the catalog through the manifest with one call", async () => {
    const manifest = merchantManifest({
      origin: "https://autoparts.example",
      merchantId: "mrc_autoparts",
      merchantName: "AutoParts",
      registryUrl: "https://agentpay.example",
      catalogPath: "/api/agentpay/catalog",
    });
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(input.toString());
      if (url.pathname === "/.well-known/agentpay.json") return Response.json(manifest);
      expect(url.pathname).toBe("/api/agentpay/catalog");
      expect(url.searchParams.get("category")).toBe("tires");
      expect(url.searchParams.get("max_price_cents")).toBe("160000");
      return handler(new Request(url));
    };
    const catalog = await discoverAgentPayCatalog(
      "https://autoparts.example/store/products/prd_tire_std",
      { category: "tires", maxPriceCents: 160_000 },
      fetcher,
    );
    expect(catalog.products.map((p) => p.product_id)).toEqual(["prd_tire_std"]);
  });

  it("refuses a catalog that names a different merchant than the manifest", async () => {
    const manifest = merchantManifest({
      origin: "https://autoparts.example",
      merchantId: "mrc_autoparts",
      merchantName: "AutoParts",
      catalogPath: "/api/agentpay/catalog",
    });
    const other = createAgentPayCatalogHandler({ merchantId: "mrc_other", merchantName: "Other", currency: "USD", products: () => [] });
    const fetcher: typeof fetch = async (input) => other(new Request(input.toString()));
    await expect(discoverAgentPayCatalog(manifest, {}, fetcher)).rejects.toThrow(/different merchants/);
  });
});

describe("merchant checkout handler", () => {
  it("verifies the agent, checks live mandate status, and applies policy", async () => {
    const keys = generateEd25519KeyPair();
    const registryKeys = generateEd25519KeyPair();
    const artifact: Omit<RegistryMandate, "server_sig" | "status" | "usage"> = {
      mandate_id: "3eb0f49d-2c10-4d3a-8f34-08a47e2fca6e",
      type: "intent",
      issuer: { user_id: "user" },
      agent: { agent_id: "agt_test", public_key: keys.publicKey },
      scope: { merchants: ["mrc_autoparts"], categories: ["tires"] },
      limits: {
        per_purchase_cents: 160_000,
        cumulative_cents: 400_000,
        max_uses: 3,
        period: "month",
        currency: "USD",
      },
      validity: {
        not_before: "2026-08-01T00:00:00.000Z",
        expires_at: "2026-09-01T00:00:00.000Z",
      },
      payment: { vault_card_id: "card" },
      authorization: {
        credential_id: "credential",
        mandate_hash: "hash",
        signed_at: "2026-08-29T12:00:00.000Z",
      },
    };
    const mandate: RegistryMandate = {
      ...artifact,
      server_sig: signText(registryKeys.privateKey, canonicalJson(artifact)),
      status: "active",
      usage: { approved_uses: 0, cumulative_cents: 0 },
    };
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(input.toString());
      if (url.pathname.startsWith("/api/registry/agents/")) {
        return Response.json({ id: "agt_test", public_key: keys.publicKey });
      }
      if (url.pathname === "/api/registry/nonces") {
        expect(init?.method).toBe("POST");
        return Response.json({ consumed: true }, { status: 201 });
      }
      if (url.pathname.startsWith("/api/registry/mandates/")) {
        return Response.json(mandate);
      }
      if (url.pathname === "/api/registry/keys") {
        return Response.json({ algorithm: "Ed25519", public_key: registryKeys.publicKey });
      }
      return new Response(null, { status: 404 });
    };
    const handler = createAgentPayCheckoutHandler({
      merchantId: "mrc_autoparts",
      registryUrl: "https://agentpay.example",
      fetcher,
      now: () => new Date("2026-08-29T12:00:00.000Z"),
      resolveProduct: async () => ({
        id: "prd_standard_tires",
        merchant_id: "mrc_autoparts",
        name: "Standard tire set",
        category: "tires",
        price_cents: 154_800,
        currency: "USD",
      }),
    });
    const body = JSON.stringify({
      mandate_id: mandate.mandate_id,
      merchant_id: "mrc_autoparts",
      product_id: "prd_standard_tires",
    });
    const url = "https://autoparts.example/api/store/checkout";
    const headers = signAgentPayRequest({
      agentId: "agt_test",
      privateKey: keys.privateKey,
      method: "POST",
      url,
      body,
      now: new Date("2026-08-29T12:00:00.000Z"),
      nonce: "nonce-test",
    });
    const response = await handler(new Request(url, { method: "POST", headers, body }));
    await expect(response.json()).resolves.toMatchObject({
      decision: "approved",
      checks: { agent_signature: true, registry_status: true, policy: true },
      // A store on 0.2.0 quotes no delivery, so the charge is the product alone.
      charge: { subtotal_cents: 154_800, shipping_cents: 0, total_cents: 154_800 },
    });
  });
});

describe("delivery quoting", () => {
  const ADDRESS = {
    recipient: "Dana Ruiz",
    line1: "88 Wythe Ave",
    city: "Brooklyn",
    region: "NY",
    postal_code: "11249",
    country_code: "US",
  };
  const NOW = new Date("2026-08-29T12:00:00.000Z");
  const keys = generateEd25519KeyPair();
  const registryKeys = generateEd25519KeyPair();
  const artifact: Omit<RegistryMandate, "server_sig" | "status" | "usage"> = {
    mandate_id: "3eb0f49d-2c10-4d3a-8f34-08a47e2fca6e",
    type: "intent",
    issuer: { user_id: "user" },
    agent: { agent_id: "agt_test", public_key: keys.publicKey },
    scope: { merchants: ["mrc_autoparts"], categories: ["tires"] },
    limits: { per_purchase_cents: 156_000, cumulative_cents: 400_000, max_uses: 3, period: "month", currency: "USD" },
    validity: { not_before: "2026-08-01T00:00:00.000Z", expires_at: "2026-09-01T00:00:00.000Z" },
    payment: { vault_card_id: "card" },
    authorization: { credential_id: "credential", mandate_hash: "hash", signed_at: "2026-08-29T12:00:00.000Z" },
  };
  const mandate: RegistryMandate = {
    ...artifact,
    server_sig: signText(registryKeys.privateKey, canonicalJson(artifact)),
    status: "active",
    usage: { approved_uses: 0, cumulative_cents: 0 },
  };
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(input.toString());
    if (url.pathname.startsWith("/api/registry/agents/")) return Response.json({ id: "agt_test", public_key: keys.publicKey });
    if (url.pathname === "/api/registry/nonces") return Response.json({ consumed: true }, { status: 201 });
    if (url.pathname.startsWith("/api/registry/mandates/")) return Response.json(mandate);
    if (url.pathname === "/api/registry/keys") return Response.json({ algorithm: "Ed25519", public_key: registryKeys.publicKey });
    return new Response(null, { status: 404 });
  };
  const CHECKOUT_URL = "https://autoparts.example/api/store/checkout";

  function handlerWith(resolveFulfillment: Parameters<typeof createAgentPayCheckoutHandler>[0]["resolveFulfillment"]) {
    return createAgentPayCheckoutHandler({
      merchantId: "mrc_autoparts",
      registryUrl: "https://agentpay.example",
      fetcher,
      now: () => NOW,
      resolveProduct: async () => ({
        id: "prd_standard_tires",
        merchant_id: "mrc_autoparts",
        name: "Standard tire set",
        category: "tires",
        price_cents: 154_800,
        currency: "USD",
      }),
      resolveFulfillment,
    });
  }

  function signed(nonce: string, body: Record<string, unknown>) {
    const payload = JSON.stringify(body);
    const headers = signAgentPayRequest({
      agentId: "agt_test",
      privateKey: keys.privateKey,
      method: "POST",
      url: CHECKOUT_URL,
      body: payload,
      now: NOW,
      nonce,
    });
    return new Request(CHECKOUT_URL, { method: "POST", headers, body: payload });
  }

  const quote = ({ address, address_source, now }: FulfillmentRequest) =>
    address.country_code === "US"
      ? {
          address_source,
          ships_to: address,
          method: "Ground",
          carrier: "Test Freight",
          handling_time: "Ships the next business day",
          estimated_delivery: deliveryWindow({ from: now, minBusinessDays: 2, maxBusinessDays: 4 }),
          shipping_cents: 1_295,
          currency: "USD",
        }
      : null;

  it("skips weekends so an estimate never promises a Sunday", () => {
    // Friday 2026-08-28 + 1 business day is Monday, not Saturday.
    const window = deliveryWindow({ from: new Date("2026-08-28T12:00:00.000Z"), minBusinessDays: 1, maxBusinessDays: 3 });
    expect(window.earliest).toBe("2026-08-31");
    expect(window.latest).toBe("2026-09-02");
    expect(window.text).toContain("Mon, Aug 31");
  });

  it("adds the quoted delivery to the amount the policy is evaluated against", async () => {
    const response = await handlerWith(quote)(
      signed("nonce-quote", {
        mandate_id: mandate.mandate_id,
        merchant_id: "mrc_autoparts",
        product_id: "prd_standard_tires",
        shipping_address: ADDRESS,
        shipping_address_source: "custom",
        purchase_reason: "Van needs tires before Monday's run.",
      }),
    );
    const body = await response.json();
    expect(body.charge).toEqual({ subtotal_cents: 154_800, shipping_cents: 1_295, total_cents: 156_095, currency: "USD" });
    expect(body.fulfillment.address_source).toBe("custom");
    // 156,095 is above the 156,000 per-purchase limit: delivery is what escalated it.
    expect(body.decision).toBe("escalated");
    expect(body.reason_code).toBe("AMOUNT_EXCEEDS_LIMIT");
  });

  it("refuses an address the store does not serve before any limit is spent", async () => {
    const response = await handlerWith(quote)(
      signed("nonce-abroad", {
        mandate_id: mandate.mandate_id,
        merchant_id: "mrc_autoparts",
        product_id: "prd_standard_tires",
        shipping_address: { ...ADDRESS, country_code: "BR" },
        purchase_reason: "Van needs tires.",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      decision: "refused",
      reason_code: "SHIPPING_ADDRESS_UNSUPPORTED",
    });
  });

  it("uppercases the country code so US and us are the same address", async () => {
    const response = await handlerWith(quote)(
      signed("nonce-lower", {
        mandate_id: mandate.mandate_id,
        merchant_id: "mrc_autoparts",
        product_id: "prd_standard_tires",
        shipping_address: { ...ADDRESS, country_code: "us" },
        purchase_reason: "Van needs tires.",
      }),
    );
    const body = await response.json();
    expect(body.fulfillment.ships_to.country_code).toBe("US");
  });

  it("leaves a store that quotes nothing on the 0.2.0 contract", async () => {
    const response = await handlerWith(undefined)(
      signed("nonce-nofulfil", {
        mandate_id: mandate.mandate_id,
        merchant_id: "mrc_autoparts",
        product_id: "prd_standard_tires",
      }),
    );
    const body = await response.json();
    expect(body.fulfillment).toBeUndefined();
    expect(body.charge.total_cents).toBe(154_800);
    expect(body.decision).toBe("approved");
  });
});
