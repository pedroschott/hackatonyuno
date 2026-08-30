# AgentPay merchant SDK

`@agentpay/merchant-sdk` lets each store advertise AgentPay on its own domain and protect its own checkout endpoint. Product discovery remains with search, the agent and the store; there is no AgentPay merchant directory.

## Install the challenge build

```bash
npm run sdk:pack
npm install ./dist/agentpay-merchant-sdk-0.1.0.tgz
```

## Publish discovery

Serve `/.well-known/agentpay.json` from the store:

```ts
import { merchantManifest } from "@agentpay/merchant-sdk";

export function GET(request: Request) {
  return Response.json(
    merchantManifest({
      origin: request.url,
      merchantId: "merchant_example",
      merchantName: "Example Store",
      catalogPath: "/api/agentpay/catalog",
      checkoutPath: "/api/agentpay/checkout",
      registryUrl: "https://agentpay-yuno.vercel.app",
    }),
  );
}
```

The generated manifest publishes these agent-facing URLs:

- `catalog_endpoint`: the store-owned product catalog with stable checkout IDs.
- `checkout_endpoint`: the signed merchant checkout handler.
- `mcp_endpoint`: the OAuth-protected AgentPay MCP server.
- `oauth_protected_resource`: MCP OAuth protected-resource metadata.
- `registry_url`: live agent, nonce, key and mandate verification.
- `documentation_url`: merchant-specific agent operating instructions.

## Publish a machine catalog

The catalog is public merchant data, not an AgentPay directory. Serve it from the `catalog_endpoint` named in the manifest:

```ts
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const products = await database.products.listAvailable();

  return Response.json({
    protocol: "agentpay-catalog/1.0",
    merchant: { id: "merchant_example", name: "Example Store" },
    products: products.map((product) => ({
      product_id: product.id,
      merchant_id: "merchant_example",
      sku: product.sku,
      name: product.name,
      description: product.description,
      category: product.category,
      price_cents: product.priceCents,
      currency: product.currency,
      availability: product.inStock ? "in_stock" : "out_of_stock",
      product_url: new URL(`/products/${product.slug}`, origin).toString(),
    })),
  });
}
```

`product_id` is the checkout identifier. Keep it stable and pass it unchanged to `resolveProduct`; do not require agents to derive it from a product name, SKU, URL slug or list position. Prices use integer minor currency units.

## Protect checkout

Create the handler once and pass it the store's own product lookup:

```ts
import { createAgentPayCheckoutHandler } from "@agentpay/merchant-sdk";

const checkout = createAgentPayCheckoutHandler({
  merchantId: "merchant_example",
  registryUrl: "https://agentpay-yuno.vercel.app",
  resolveProduct: async (productId) => database.products.find(productId),
});

export async function POST(request: Request) {
  return checkout(request);
}
```

The handler verifies the Ed25519 agent request signature, timestamp and nonce, the registry's mandate signature, live mandate status, merchant/category/amount/use/expiry policy and any approved one-time exception. Only then should the store ask its payment provider to charge. AgentPay's challenge implementation returns a mock single-use payment token instead of moving money.

Do not copy the demo catalog into AgentPay. Keep products and checkout on the store domain, expose the catalog through the store-owned manifest, and make revocation effective by checking the live registry for every purchase.
