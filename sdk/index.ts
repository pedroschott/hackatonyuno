import { z } from "zod";

import {
  agentSigningMessage,
  signText,
  verifyText,
} from "@/lib/crypto";
import { canonicalJson } from "@/lib/canonical-json";
import type {
  AgentPayMerchantCatalog,
  AgentPayMerchantManifest,
  CheckoutCart,
  PolicyDecision,
  RegistryMandate,
} from "@/lib/domain";
import { evaluatePolicy } from "@/lib/agentpay-policy";

const manifestSchema = z.object({
  protocol: z.literal("agentpay/1.0"),
  merchant: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  catalog_endpoint: z.url(),
  checkout_endpoint: z.url(),
  registry_url: z.url(),
  mcp_endpoint: z.url(),
  oauth_protected_resource: z.url(),
  documentation_url: z.url(),
  capabilities: z.tuple([
    z.literal("store-owned-catalog"),
    z.literal("intent-mandates"),
    z.literal("live-revocation"),
    z.literal("mock-payment"),
  ]),
});

const checkoutBodySchema = z.object({
  mandate_id: z.uuid(),
  merchant_id: z.string().min(1),
  product_id: z.string().min(1),
  exception_id: z.uuid().optional(),
});

const catalogSchema = z.object({
  protocol: z.literal("agentpay-catalog/1.0"),
  merchant: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  products: z.array(
    z.object({
      product_id: z.string().min(1),
      merchant_id: z.string().min(1),
      sku: z.string().min(1),
      name: z.string().min(1),
      description: z.string(),
      category: z.string().min(1),
      price_cents: z.number().int().positive(),
      currency: z.string().length(3),
      availability: z.enum(["in_stock", "out_of_stock"]),
      product_url: z.url(),
    }),
  ),
});

export type MerchantProduct = {
  id: string;
  merchant_id: string;
  name: string;
  category: string;
  price_cents: number;
  currency: string;
};

export type MerchantCheckoutResult = PolicyDecision & {
  product?: MerchantProduct;
  checks: {
    agent_signature: boolean;
    mandate_signature: boolean;
    registry_status: boolean;
    policy: boolean;
  };
};

type FetchLike = typeof fetch;

export function merchantManifest(input: {
  origin: string;
  merchantId: string;
  merchantName: string;
  catalogPath?: string;
  checkoutPath?: string;
  registryUrl?: string;
  mcpUrl?: string;
  oauthProtectedResourceUrl?: string;
  documentationUrl?: string;
}): AgentPayMerchantManifest {
  const origin = new URL(input.origin).origin;
  const registryUrl = input.registryUrl ? new URL(input.registryUrl) : new URL(origin);
  return {
    protocol: "agentpay/1.0",
    merchant: { id: input.merchantId, name: input.merchantName },
    catalog_endpoint: new URL(input.catalogPath ?? "/api/agentpay/catalog", origin).toString(),
    checkout_endpoint: new URL(input.checkoutPath ?? "/api/store/checkout", origin).toString(),
    registry_url: registryUrl.toString(),
    mcp_endpoint: input.mcpUrl
      ? new URL(input.mcpUrl).toString()
      : new URL("/mcp", registryUrl).toString(),
    oauth_protected_resource: input.oauthProtectedResourceUrl
      ? new URL(input.oauthProtectedResourceUrl).toString()
      : new URL("/.well-known/oauth-protected-resource/mcp", registryUrl).toString(),
    documentation_url: input.documentationUrl
      ? new URL(input.documentationUrl).toString()
      : new URL("/llms.txt", origin).toString(),
    capabilities: [
      "store-owned-catalog",
      "intent-mandates",
      "live-revocation",
      "mock-payment",
    ],
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

export async function discoverAgentPayCatalog(
  catalogUrl: string,
  fetcher: FetchLike = fetch,
): Promise<AgentPayMerchantCatalog> {
  const response = await fetcher(new URL(catalogUrl), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Merchant catalog is unavailable (${response.status})`);
  }
  return catalogSchema.parse(await response.json());
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
    const cart: CheckoutCart = {
      mandate_id: parsedBody.data.mandate_id,
      merchant_id: config.merchantId,
      product_id: product.id,
      category: product.category,
      amount_cents: product.price_cents,
      currency: product.currency,
      exception_id: parsedBody.data.exception_id,
    };
    const policy = mandateSignatureValid
      ? evaluatePolicy(mandate, cart, now)
      : ({ decision: "refused", reason_code: "MANDATE_SIGNATURE_INVALID" } as const);

    return Response.json({
      ...policy,
      product,
      checks: {
        agent_signature: true,
        mandate_signature: mandateSignatureValid,
        registry_status: mandate?.status === "active",
        policy: policy.decision === "approved",
      },
    } satisfies MerchantCheckoutResult);
  };
}
