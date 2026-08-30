# AgentPay merchant SDK

`@agentpay/merchant-sdk` lets each store advertise AgentPay on its own domain and protect its own checkout endpoint. Product discovery remains with search, the agent and the store; there is no AgentPay merchant directory.

## Create the merchant identity

Sign in at `https://agentpay-yuno.vercel.app/developers` and create a merchant before configuring the SDK. The console assigns the immutable `mrc_...` identifier recognized by AgentPay. Do not invent one locally.

For the shortest end-to-end test, choose **Hosted test store**. AgentPay creates a working storefront, manifest, checkout endpoint, sample product, and server-side catalog API key. Choose **Existing live store** to publish the routes below on your own domain and run HTTPS discovery verification.

**The complete guide is the documentation site at [`/docs`](https://agentpay-yuno.vercel.app/docs)** — quickstart, installation, discovery, checkout, framework recipes, testing, the SDK and protocol reference, and troubleshooting. It lives in `app/(docs)/docs/**` and deploys with the code it describes. This file is the short version for readers browsing the repository.

## Install

One command from this repository, pointed at the merchant project:

```bash
npm run sdk:install -- ../my-store
```

It builds and packs the SDK, copies the tarball into `my-store/vendor/` and installs it there, so the dependency is a relative path the store can commit. The manual equivalent:

```bash
npm run sdk:pack
npm install ./dist/agentpay-merchant-sdk-0.1.0.tgz
```

Requirements: Node 22+, zod 4, a public HTTPS origin, and a stable merchant id. Full detail: [`/docs/installation`](https://agentpay-yuno.vercel.app/docs/installation).

## Publish discovery

Serve `/.well-known/agentpay.json` from the store:

```ts
import { merchantManifest } from "@agentpay/merchant-sdk";

export function GET(request: Request) {
  return Response.json(
    merchantManifest({
      origin: request.url,
      merchantId: process.env.AGENTPAY_MERCHANT_ID!,
      merchantName: "Example Store",
      checkoutPath: "/api/agentpay/checkout",
      registryUrl: "https://agentpay-yuno.vercel.app",
    }),
  );
}
```

`registryUrl` defaults to the store's own origin, which is almost never what a merchant wants — set it explicitly. Full detail: [`/docs/discovery`](https://agentpay-yuno.vercel.app/docs/discovery).

## Protect checkout

Create the handler once and pass it the store's own product lookup:

```ts
import { createAgentPayCheckoutHandler } from "@agentpay/merchant-sdk";

const checkout = createAgentPayCheckoutHandler({
  merchantId: process.env.AGENTPAY_MERCHANT_ID!,
  registryUrl: "https://agentpay-yuno.vercel.app",
  resolveProduct: async (productId) => database.products.find(productId),
});

export async function POST(request: Request) {
  return checkout(request);
}
```

The handler verifies the Ed25519 agent request signature, timestamp and nonce, the registry's mandate signature, live mandate status, merchant/category/amount/use/expiry policy and any approved one-time exception. Only then should the store ask its payment provider to charge. AgentPay's challenge implementation returns a mock single-use payment token instead of moving money.

The agent sends a product id and never an amount: price, currency and category come from the store's own `resolveProduct`. The handler reads the raw request body itself, so a JSON body parser or a path rewrite in front of the route breaks signature verification. Full detail: [`/docs/checkout`](https://agentpay-yuno.vercel.app/docs/checkout) and [`/docs/frameworks`](https://agentpay-yuno.vercel.app/docs/frameworks).

## Decisions

| Decision | Meaning | Store action |
|---|---|---|
| `approved` | Signed, live, in scope, within every limit | Charge and fulfil |
| `escalated` | Above the per-purchase limit with no approved exception | Charge nothing; the agent asks the buyer for a one-time approval and retries with `exception_id` |
| `refused` | Revoked, expired, out of scope, out of budget or unverifiable | Charge nothing; surface the reason code |

Every reason code is enumerated in [`/docs/reference/decisions`](https://agentpay-yuno.vercel.app/docs/reference/decisions).

## Test before you demo

The SDK exports the signing and canonical-JSON helpers used by AgentPay itself, so a merchant can drive approved, refused and escalated paths offline with a stubbed registry and a deterministic clock. The full copy-paste test is in [`/docs/testing`](https://agentpay-yuno.vercel.app/docs/testing).

Do not copy the demo catalog into AgentPay. Keep products and checkout on the store domain, and make revocation effective by checking the live registry for every purchase.

## Keeping this current

This file, the docs site and `sdk/index.ts` describe one thing and must change together. When the SDK's exports, options, verification steps or response shape change, update `/docs/reference`, `/docs/checkout` and this summary in the same pull request. See the Documentation section of [`AGENTS.md`](../AGENTS.md).
