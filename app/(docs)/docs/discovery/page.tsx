import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { CodeTabs } from "@/components/docs/CodeTabs";
import { A, C, Callout, CodeBlock, DataTable, LI, Lead, List, P, PropTable } from "@/components/docs/prose";

const HREF = "/docs/discovery";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <>
          <Lead>
            An agent finds your store the way a person does: search, a link, a product page. What it cannot guess is
            whether you accept AgentPay and where to send a purchase. That is what{" "}
            <C>/.well-known/agentpay.json</C> answers.
          </Lead>
          <Callout tone="note" title="The supported-store registry is not a catalog">
            <p>
              Discovery still lives on your domain, under your control, and an agent reads it from the origin it is
              already browsing. AgentPay keeps only an opt-in list of verified live store URLs; it does not ingest,
              rank, or search merchant products. Register the immutable ID in the <A href="/developers">merchant console</A>.
            </p>
          </Callout>
        </>
      }
      sections={[
        {
          id: "publish",
          title: "Publish the manifest",
          body: (
            <>
              <P>
                <C>merchantManifest</C> builds the document for you, so the shape stays correct as the protocol moves.
                Serve it at exactly <C>/.well-known/agentpay.json</C>.
              </P>
              <CodeTabs
                tabs={[
                  {
                    label: "Next.js",
                    sample: {
                      lang: "ts",
                      filename: "app/.well-known/agentpay.json/route.ts",
                      code: `import { merchantManifest } from "@agentpay/merchant-sdk";

export function GET(request: Request) {
  return Response.json(
    merchantManifest({
      origin: request.url,
      merchantId: process.env.AGENTPAY_MERCHANT_ID!,
      merchantName: "Demo Store",
      checkoutPath: "/api/agentpay/checkout",
      registryUrl: process.env.AGENTPAY_REGISTRY_URL!,
    }),
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } },
  );
}`,
                    },
                  },
                  {
                    label: "Hono",
                    sample: {
                      lang: "ts",
                      filename: "src/routes/well-known.ts",
                      code: `import { Hono } from "hono";
import { merchantManifest } from "@agentpay/merchant-sdk";

export const wellKnown = new Hono().get("/.well-known/agentpay.json", (c) =>
  c.json(
    merchantManifest({
      origin: c.req.url,
      merchantId: process.env.AGENTPAY_MERCHANT_ID!,
      merchantName: "Demo Store",
      checkoutPath: "/api/agentpay/checkout",
      registryUrl: process.env.AGENTPAY_REGISTRY_URL!,
    }),
    200,
    { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  ),
);`,
                    },
                  },
                  {
                    label: "Express",
                    sample: {
                      lang: "ts",
                      filename: "src/server.ts",
                      code: `import express from "express";
import { merchantManifest } from "@agentpay/merchant-sdk";

const app = express();

app.get("/.well-known/agentpay.json", (req, res) => {
  res.set({ "access-control-allow-origin": "*", "cache-control": "public, max-age=300" });
  res.json(
    merchantManifest({
      origin: \`\${req.protocol}://\${req.get("host")}\`,
      merchantId: process.env.AGENTPAY_MERCHANT_ID!,
      merchantName: "Demo Store",
      checkoutPath: "/api/agentpay/checkout",
      registryUrl: process.env.AGENTPAY_REGISTRY_URL!,
    }),
  );
});`,
                    },
                  },
                  {
                    label: "Static file",
                    sample: {
                      lang: "json",
                      filename: "public/.well-known/agentpay.json",
                      code: `{
  "protocol": "agentpay/1.0",
  "merchant": { "id": "mrc_demo_store", "name": "Demo Store" },
  "checkout_endpoint": "https://my-store.example/api/agentpay/checkout",
  "registry_url": "https://agentpay-yuno.vercel.app/",
  "capabilities": ["intent-mandates", "live-revocation", "mock-payment"]
}`,
                    },
                  },
                ]}
              />
              <Callout tone="warn" title="A static file hard-codes your origin">
                <p>
                  Preview deployments and local development will then advertise the production checkout endpoint. Prefer
                  the route versions, which derive the origin from the request.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "options",
          title: "merchantManifest options",
          body: (
            <PropTable
              rows={[
                {
                  name: "origin",
                  type: "string",
                  required: true,
                  description: (
                    <>
                      Any URL on your store; only its origin is used. Pass <C>request.url</C> so previews and production
                      each advertise themselves.
                    </>
                  ),
                },
                {
                  name: "merchantId",
                  type: "string",
                  required: true,
                  description: (
                    <>
                      The immutable ID assigned by the AgentPay merchant console. Buyers scope mandates to this exact
                      value and the checkout handler refuses any request naming a different one.
                    </>
                  ),
                },
                {
                  name: "merchantName",
                  type: "string",
                  required: true,
                  description: "The human name shown to the buyer in the mandate they sign. Use your real store name.",
                },
                {
                  name: "checkoutPath",
                  type: "string",
                  description: (
                    <>
                      Path of your verified checkout route. Defaults to <C>/api/store/checkout</C>.
                    </>
                  ),
                },
                {
                  name: "registryUrl",
                  type: "string",
                  description: (
                    <>
                      The AgentPay deployment that issues and revokes mandates. Defaults to your own origin, which is
                      almost never what a merchant wants — set it explicitly.
                    </>
                  ),
                },
                {
                  name: "catalogPath",
                  type: "string",
                  description: (
                    <>
                      Path of the route built with <C>createAgentPayCatalogHandler</C>. Advertised as{" "}
                      <C>catalog_endpoint</C> and adds the <C>catalog-search</C> capability. This is what lets an agent
                      get exact product ids instead of scraping your pages.
                    </>
                  ),
                },
                {
                  name: "categories",
                  type: "string[]",
                  description:
                    "The exact category slugs a buyer may scope a mandate to. AgentPay rejects a mandate naming any other category before the buyer signs it. Keep them coarse, lowercase and stable.",
                },
                {
                  name: "currency",
                  type: "string",
                  description: "The ISO 4217 code every product is quoted in. Mandates must match it exactly; nothing is converted.",
                },
                {
                  name: "productUrlTemplate",
                  type: "string",
                  description: (
                    <>
                      Path template with <C>{"{id}"}</C>, such as <C>/product/{"{id}"}</C>, so an agent can cite the
                      canonical page for any product id.
                    </>
                  ),
                },
                {
                  name: "documentationUrl",
                  type: "string",
                  description: "Optional link an agent may follow for store-specific instructions.",
                },
              ]}
            />
          ),
        },
        {
          id: "catalog",
          title: "Publish the catalog",
          body: (
            <>
              <P>
                The manifest says how to pay. The catalog says what exists, in the exact terms a mandate and a checkout
                use: product id, category slug, price in minor units, currency. Without it an agent has to guess an id
                from a name or a URL and learns it was wrong only at purchase time.
              </P>
              <CodeBlock
                lang="ts"
                filename="app/api/agentpay/catalog/route.ts"
                code={`import { createAgentPayCatalogHandler } from "@agentpay/merchant-sdk";

export const GET = createAgentPayCatalogHandler({
  merchantId: process.env.AGENTPAY_MERCHANT_ID!,
  merchantName: "Demo Store",
  currency: "USD",
  products: async () =>
    (await db.products.list()).map((p) => ({
      product_id: p.id,
      name: p.name,
      description: p.description,
      category: p.mandateCategory,   // the same slug resolveProduct returns at checkout
      price_cents: p.priceCents,     // the same integer resolveProduct returns at checkout
      currency: "USD",
      sku: p.sku,
      availability: p.stock > 0 ? "in_stock" : "out_of_stock",
      url: \`https://my-store.example/product/\${p.id}\`,
    })),
});`}
              />
              <P>
                The handler owns the query semantics so every store on the SDK answers the same way: every word of{" "}
                <C>q</C> must match the name, description, SKU, brand or category; <C>category</C> and{" "}
                <C>product_id</C> are exact; <C>max_price_cents</C> is a ceiling; <C>limit</C> defaults to 10 and caps
                at 50; in-stock items sort first. The response carries <C>total</C> (matches before the limit), the
                normalized <C>query</C>, and the store&apos;s category vocabulary.
              </P>
              <CodeBlock
                lang="bash"
                code={`curl -s "https://my-store.example/api/agentpay/catalog?q=tire&max_price_cents=160000" | jq '.products[] | {product_id, category, price_cents}'`}
              />
              <Callout tone="warn" title="Catalog and checkout must agree">
                <p>
                  An agent sizes the mandate from <C>price_cents</C> and <C>category</C> in the catalog. If{" "}
                  <C>resolveProduct</C> returns a different number or slug at checkout, the purchase is refused with a
                  reason the buyer cannot explain. Derive both from the same function.
                </p>
              </Callout>
              <Callout tone="note" title="No catalog? Put the id on the page">
                <p>
                  Every manifest field added for the catalog is optional, so a store that cannot publish one is still
                  discovered. In that case put the exact id on the product page as{" "}
                  <C>{'<meta name="agentpay:product_id" content="…">'}</C> or JSON-LD <C>productID</C>; AgentPay tells
                  the agent to read it from there instead of guessing.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "fields",
          title: "What each field means to an agent",
          body: (
            <DataTable
              head={["Field", "Meaning"]}
              rows={[
                [<C key="p">protocol</C>, "Always agentpay/1.0. An agent that does not understand this version stops here."],
                [<C key="m">merchant.id</C>, "The id the agent must put in the mandate scope and in the checkout body."],
                [<C key="n">merchant.name</C>, "Shown to the buyer while they read the mandate before signing."],
                [<C key="c">checkout_endpoint</C>, "Absolute URL the agent posts its signed purchase to."],
                [<C key="r">registry_url</C>, "Where the agent asks for a mandate, and where your handler verifies one."],
                [
                  <C key="cap">capabilities</C>,
                  "Intent mandates, live revocation and the mocked payment rail; plus catalog-search when a catalog endpoint is advertised.",
                ],
                [<C key="cat">catalog_endpoint</C>, "Optional. Where find_products sends its one question about your products."],
                [<C key="cats">categories</C>, "Optional. The only category slugs a mandate for this store may name."],
                [<C key="cur">currency</C>, "Optional. The currency a mandate must be denominated in to buy here."],
                [<C key="tpl">product_url_template</C>, "Optional. Resolved with a product id to cite the canonical product page."],
              ]}
            />
          ),
        },
        {
          id: "headers",
          title: "Headers that matter",
          body: (
            <>
              <List>
                <LI>
                  <C>access-control-allow-origin: *</C> — the manifest is public metadata; a browser-based agent needs to
                  read it cross-origin.
                </LI>
                <LI>
                  <C>cache-control: public, max-age=300</C> — cheap for crawlers, still fast to correct a mistake. Do not
                  cache for hours while you are still iterating.
                </LI>
                <LI>
                  <C>content-type: application/json</C> — set automatically by <C>Response.json</C>.
                </LI>
              </List>
              <Callout tone="tip" title="Let crawlers see it">
                <p>
                  If your <C>robots.txt</C> disallows broad paths, explicitly allow <C>/.well-known/agentpay.json</C>.
                  AgentPay does the same for its own demo manifest.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "verify",
          title: "Verify discovery",
          body: (
            <>
              <P>From the outside, exactly as an agent sees it:</P>
              <CodeBlock lang="bash" code={`curl -s https://my-store.example/.well-known/agentpay.json | jq`} />
              <P>
                Or from code — the SDK ships the same discovery client an agent uses, which accepts any product URL on
                your domain and finds the manifest from its origin:
              </P>
              <CodeBlock
                lang="ts"
                code={`import { discoverAgentPayMerchant } from "@agentpay/merchant-sdk";

const manifest = await discoverAgentPayMerchant("https://my-store.example/products/tires");
console.log(manifest.checkout_endpoint);`}
              />
              <P>
                It throws if the document is missing, unreadable, or fails schema validation — a fast check that you
                published a shape agents will accept.
              </P>
            </>
          ),
        },
        {
          id: "mistakes",
          title: "Common mistakes",
          body: (
            <DataTable
              head={["Symptom", "Cause and fix"]}
              rows={[
                [
                  "Agent reports no AgentPay support",
                  <>
                    The path is not exactly <C>/.well-known/agentpay.json</C>, or a rewrite strips the dot-folder. Curl it
                    from outside your network.
                  </>,
                ],
                [
                  "checkout_endpoint points at localhost",
                  <>
                    <C>origin</C> was hard-coded. Pass <C>request.url</C> instead.
                  </>,
                ],
                [
                  "registry_url is your own domain",
                  <>
                    <C>registryUrl</C> was omitted, so it defaulted to your origin. Set it to the AgentPay deployment.
                  </>,
                ],
                [
                  "Purchases refused with MERCHANT_NOT_IN_SCOPE",
                  <>
                    The manifest advertises a different id than the handler enforces. Both must read the same{" "}
                    <A href="/docs/installation">environment variable</A>.
                  </>,
                ],
              ]}
            />
          ),
        },
      ]}
    />
  );
}
