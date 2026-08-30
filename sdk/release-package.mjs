import { writeFile } from "node:fs/promises";

const packageJson = {
  name: "@agentpay/merchant-sdk",
  version: "0.3.0",
  description: "Store-owned discovery, catalog search, delivery quoting and cryptographic checkout verification for AgentPay",
  license: "MIT",
  main: "./index.js",
  module: "./index.mjs",
  types: "./index.d.ts",
  exports: {
    ".": {
      types: "./index.d.ts",
      import: "./index.mjs",
      require: "./index.js",
    },
  },
  files: ["index.js", "index.mjs", "index.d.ts", "index.d.mts", "README.md"],
  dependencies: { zod: "^4.5.4" },
  engines: { node: ">=22" },
};

const readme = `# @agentpay/merchant-sdk

Publish store-owned AgentPay discovery metadata and a searchable catalog, quote delivery to the buyer's address, and protect a checkout route with request, registry-signature, live-status, replay, and deterministic policy verification.

Quickstart: https://agentpay-yuno.vercel.app/docs/quickstart
Full documentation: https://agentpay-yuno.vercel.app/docs
Repository: https://github.com/pedroschott/hackatonyuno

## Three routes

\`\`\`ts
// app/.well-known/agentpay.json/route.ts
import { merchantManifest } from "@agentpay/merchant-sdk";

export function GET(request: Request) {
  return Response.json(
    merchantManifest({
      origin: request.url,
      merchantId: process.env.AGENTPAY_MERCHANT_ID,
      merchantName: "Demo Store",
      checkoutPath: "/api/agentpay/checkout",
      catalogPath: "/api/agentpay/catalog",
      categories: ["tires", "accessories"],
      currency: "USD",
      productUrlTemplate: "/product/{id}",
      customShipping: true,
      shipsTo: ["US"],
      registryUrl: process.env.AGENTPAY_REGISTRY_URL,
    }),
  );
}

// app/api/agentpay/catalog/route.ts
import { createAgentPayCatalogHandler } from "@agentpay/merchant-sdk";

export const GET = createAgentPayCatalogHandler({
  merchantId: process.env.AGENTPAY_MERCHANT_ID,
  merchantName: "Demo Store",
  currency: "USD",
  products: () => database.products.list(),
});

// app/api/agentpay/checkout/route.ts
import { createAgentPayCheckoutHandler, deliveryWindow } from "@agentpay/merchant-sdk";

const checkout = createAgentPayCheckoutHandler({
  merchantId: process.env.AGENTPAY_MERCHANT_ID,
  registryUrl: process.env.AGENTPAY_REGISTRY_URL,
  resolveProduct: async (productId) => database.products.find(productId),
  // Optional. Return null for an address you do not serve: the handler refuses
  // with SHIPPING_ADDRESS_UNSUPPORTED before the buyer's limit is touched.
  resolveFulfillment: async ({ product, address, now }) => ({
    address_source: "registered",
    ships_to: address,
    method: "Ground",
    carrier: "Demo Freight",
    handling_time: "Ships the next business day",
    estimated_delivery: deliveryWindow({ from: now, minBusinessDays: 2, maxBusinessDays: 4 }),
    shipping_cents: 995,
    currency: "USD",
  }),
});

export async function POST(request: Request) {
  return checkout(request);
}
\`\`\`

Charge only when the decision is \`approved\`, and charge \`charge.total_cents\` — the product plus the delivery you just quoted, which is the amount the buyer's mandate was checked against.
`;

await Promise.all([
  writeFile(new URL("../dist/sdk/package.json", import.meta.url), `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(new URL("../dist/sdk/README.md", import.meta.url), readme),
]);
