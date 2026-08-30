# AgentPay merchant SDK

`@agentpay/merchant-sdk` lets each store advertise AgentPay on its own domain, answer an agent's product question from its own catalog, and protect its own checkout endpoint. Product discovery remains with search, the agent and the store; there is no AgentPay merchant directory and AgentPay never copies a catalog.

## Create the merchant identity

Sign in at `https://agentpay-yuno.vercel.app/developers` and create a merchant before configuring the SDK. The console assigns the immutable `mrc_...` identifier recognized by AgentPay. Do not invent one locally.

For the shortest end-to-end test, choose **Hosted test store**. AgentPay creates a working storefront, manifest, catalog endpoint, checkout endpoint, sample product, and server-side catalog API key. Choose **Existing live store** to publish the routes below on your own domain and run HTTPS discovery verification.

**The complete guide is the documentation site at [`/docs`](https://agentpay-yuno.vercel.app/docs)** — quickstart, installation, discovery, checkout, framework recipes, testing, the SDK and protocol reference, the agent flow, and troubleshooting. It lives in `app/(docs)/docs/**` and deploys with the code it describes. This file is the short version for readers browsing the repository.

## Install

One command from this repository, pointed at the merchant project:

```bash
npm run sdk:install -- ../my-store
```

It builds and packs the SDK, copies the tarball into `my-store/vendor/` and installs it there, so the dependency is a relative path the store can commit. The manual equivalent:

```bash
npm run sdk:pack
npm install ./dist/agentpay-merchant-sdk-0.3.0.tgz
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
      catalogPath: "/api/agentpay/catalog",
      categories: ["tires", "accessories"],
      currency: "USD",
      productUrlTemplate: "/product/{id}",
      customShipping: true,
      shipsTo: ["US"],
      registryUrl: "https://agentpay-yuno.vercel.app",
    }),
  );
}
```

`registryUrl` defaults to the store's own origin, which is almost never what a merchant wants — set it explicitly. `catalogPath`, `categories`, `currency` and `productUrlTemplate` are optional and were added in SDK 0.2.0; `customShipping` and `shipsTo` in 0.3.0. Every one of them is optional, so an agent on the newest SDK still discovers a store that omits them all. Full detail: [`/docs/discovery`](https://agentpay-yuno.vercel.app/docs/discovery).

## Publish the catalog

The catalog endpoint is why an agent no longer has to scrape a rendered page or guess a product id. The handler filters the store's own products with one deterministic semantics every store shares — every search word must match, category and product id are exact, price is a ceiling, in-stock items come first — and returns exact ids, categories and prices in minor units:

```ts
import { createAgentPayCatalogHandler } from "@agentpay/merchant-sdk";

export const GET = createAgentPayCatalogHandler({
  merchantId: process.env.AGENTPAY_MERCHANT_ID!,
  merchantName: "Example Store",
  currency: "USD",
  products: async () =>
    (await database.products.list()).map((p) => ({
      product_id: p.id,
      name: p.name,
      description: p.description,
      category: p.mandateCategory,
      price_cents: p.priceCents,
      currency: "USD",
      sku: p.sku,
      availability: p.stock > 0 ? "in_stock" : "out_of_stock",
      url: `https://my-store.example/product/${p.id}`,
    })),
});
```

Return the same `category`, `price_cents` and `currency` that `resolveProduct` returns at checkout: the agent sizes the mandate from the catalog, and a difference between the two is a refusal the buyer cannot explain. If a store cannot publish a catalog, it should at least put the exact id in the product page as `<meta name="agentpay:product_id">` or JSON-LD `productID`; `find_products` tells the agent to read it from there.

## Protect checkout

Create the handler once and pass it the store's own product lookup:

```ts
import { createAgentPayCheckoutHandler, deliveryWindow } from "@agentpay/merchant-sdk";

const checkout = createAgentPayCheckoutHandler({
  merchantId: process.env.AGENTPAY_MERCHANT_ID!,
  registryUrl: "https://agentpay-yuno.vercel.app",
  resolveProduct: async (productId) => database.products.find(productId),

  // Optional, added in 0.3.0. Return null for an address you do not serve.
  resolveFulfillment: async ({ product, address, address_source, now }) => {
    if (address.country_code !== "US") return null;
    return {
      address_source,
      ships_to: address,
      method: "Ground",
      carrier: "Example Freight",
      handling_time: "Ships the next business day",
      estimated_delivery: deliveryWindow({ from: now, minBusinessDays: 2, maxBusinessDays: 4 }),
      shipping_cents: product.price_cents >= 15_000 ? 0 : 1_295,
      currency: "USD",
    };
  },
});

export async function POST(request: Request) {
  return checkout(request);
}
```

The handler verifies the Ed25519 agent request signature, timestamp and nonce, the registry's mandate signature, live mandate status, merchant/category/amount/use/expiry policy and any approved one-time exception. Only then should the store ask its payment provider to charge. AgentPay's challenge implementation returns a mock single-use payment token instead of moving money.

The agent sends a product id and never an amount: price, currency and category come from the store's own `resolveProduct`. AgentPay currently accepts USD only, expressed as integer cents; it performs no foreign-exchange conversion and refuses a non-USD product. The handler reads the raw request body itself, so a JSON body parser or a path rewrite in front of the route breaks signature verification. Full detail: [`/docs/checkout`](https://agentpay-yuno.vercel.app/docs/checkout) and [`/docs/frameworks`](https://agentpay-yuno.vercel.app/docs/frameworks).

### Delivery, and what the buyer is actually charged

The checkout body carries `shipping_address` — the buyer's registered address, or a one-off one they named for this order — and `purchase_reason`, their own words for why they are buying it. Both come from AgentPay, which already holds them; the agent never collects an address in conversation.

`resolveFulfillment` is called before the policy runs, because what the mandate has to cover is what will be charged. The response adds two fields:

- `charge` — `subtotal_cents`, `shipping_cents`, `total_cents`. **Charge `total_cents`.** It is the amount the mandate was evaluated against, and the amount an approved one-time exception is bound to.
- `fulfillment` — the method, carrier, handling time, estimated window and delivery price you just quoted, relayed to the agent so it can tell the buyer when the part arrives.

Return `null` and the handler refuses with `SHIPPING_ADDRESS_UNSUPPORTED` before a mandate use is consumed. Omit `resolveFulfillment` entirely and the store keeps 0.2.0 behaviour: no quote, and `charge.total_cents` equals the product price.

## After the sale: transactions and disputes

Two key-authenticated endpoints on AgentPay give a store the other half of the record. Both take `Authorization: Bearer ap_live_…` from the console's Keys tab.

```bash
curl -H "authorization: Bearer $AGENTPAY_KEY" \
  "https://agentpay-yuno.vercel.app/api/v1/merchants/$MERCHANT_ID/transactions?decision=approved&limit=50"
```

`/transactions` returns every attempt against the merchant with the reason the buyer gave their agent, where it shipped, the delivery quoted and any dispute. `/disputes` returns the cases raised against you; `POST /disputes/:id` answers one; `POST /disputes/:id/analyze` reads it against that buyer's history here and recommends refund, uphold or request-evidence — advisory, never changing the case's status. The merchant console shows the same data under **Activity** and **Disputes**.

Buyers appear as a stable per-merchant pseudonym, never an account id: enough to recognise a repeat customer, not enough to identify a person.

## Decisions

| Decision | Meaning | Store action |
|---|---|---|
| `approved` | Signed, live, in scope, within every limit | Charge and fulfil |
| `escalated` | Above the per-purchase limit with no approved exception | Charge nothing; the agent asks the buyer for a one-time approval and retries with `exception_id` |
| `refused` | Revoked, expired, out of scope, out of budget or unverifiable | Charge nothing; surface the reason code |

Every reason code is enumerated in [`/docs/reference/decisions`](https://agentpay-yuno.vercel.app/docs/reference/decisions). On the agent side, AgentPay turns each one into an explanation, a remedy and the next tool to call; a scope refusal leads to `amend_mandate`, never to a revoke-and-retry loop. That flow is documented at [`/docs/agents`](https://agentpay-yuno.vercel.app/docs/agents).

## Test before you demo

The SDK exports the signing and canonical-JSON helpers used by AgentPay itself, so a merchant can drive approved, refused and escalated paths offline with a stubbed registry and a deterministic clock, and `filterCatalogProducts` so the catalog route can be tested without HTTP. The full copy-paste test is in [`/docs/testing`](https://agentpay-yuno.vercel.app/docs/testing).

Do not copy the demo catalog into AgentPay. Keep products, catalog and checkout on the store domain, and make revocation effective by checking the live registry for every purchase.

## Keeping this current

This file, the docs site and `sdk/index.ts` describe one thing and must change together. When the SDK's exports, options, verification steps or response shape change, update `/docs/reference`, `/docs/checkout`, `/docs/discovery` and this summary in the same pull request. See the Documentation section of [`AGENTS.md`](../AGENTS.md).
