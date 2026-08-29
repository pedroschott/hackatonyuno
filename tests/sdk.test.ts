import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/canonical-json";
import { generateEd25519KeyPair, signText } from "@/lib/crypto";
import type { RegistryMandate } from "@/lib/domain";
import {
  createAgentPayCheckoutHandler,
  discoverAgentPayMerchant,
  merchantManifest,
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
        currency: "BRL",
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
        currency: "BRL",
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
