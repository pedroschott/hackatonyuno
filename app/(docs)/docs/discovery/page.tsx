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
              ]}
            />
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
                  "Fixed for this version: intent mandates, live revocation, and the mocked payment rail.",
                ],
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
