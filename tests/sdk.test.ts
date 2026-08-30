import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/canonical-json";
import { generateEd25519KeyPair, signText } from "@/lib/crypto";
import type { AgentPayCatalogProduct, RegistryMandate } from "@/lib/domain";
import {
  createAgentPayCatalogHandler,
  createAgentPayCheckoutHandler,
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
    });
  });
});
