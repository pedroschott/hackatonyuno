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
      checkoutPath: "/api/agentpay/checkout",
      registryUrl: "https://agentpay-yuno.vercel.app",
    }),
  );
}
```

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

Do not copy the demo catalog into AgentPay. Keep products and checkout on the store domain, and make revocation effective by checking the live registry for every purchase.
