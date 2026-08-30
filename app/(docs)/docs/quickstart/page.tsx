import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, CodeBlock, LI, Lead, List, P, Steps, Step } from "@/components/docs/prose";

const HREF = "/docs/quickstart";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <>
          <Lead>
            This is the shortest working integration: install the package, publish a manifest, wrap a checkout route,
            and watch an unsigned request get refused. Everything below is copy-paste for a Next.js App Router store —
            other frameworks are in <A href="/docs/frameworks">Framework recipes</A>.
          </Lead>
          <Callout tone="note" title="What you need before you start">
            <p>
              A store project you can add two routes to, Node.js 22+, and a merchant ID from the{" "}
              <A href="/developers">AgentPay merchant console</A>. Do not invent the ID in configuration: the registry
              must recognize it before a mandate can target it.
            </p>
          </Callout>
        </>
      }
      sections={[
        {
          id: "steps",
          title: "Six steps",
          body: (
            <Steps>
              <Step n={1} title="Create the merchant identity">
                <P>
                  Sign in at <A href="/developers/merchants/new">AgentPay Developers</A>. Choose a hosted test store for
                  an immediately working catalog and checkout, or an existing live store if you already have a public
                  HTTPS deployment. Copy the assigned <C>mrc_…</C> value.
                </P>
              </Step>

              <Step n={2} title="Install the SDK">
                <P>
                  The package is built from the AgentPay repository. One command builds it, packs it, drops the tarball
                  into your store under <C>vendor/</C> and installs it:
                </P>
                <CodeBlock
                  lang="bash"
                  code={`git clone https://github.com/pedroschott/hackatonyuno.git
cd hackatonyuno
npm install
npm run sdk:install -- ~/code/my-store`}
                />
                <P>
                  Your store now has <C>@agentpay/merchant-sdk</C> in <C>package.json</C>, resolved from a relative path
                  you can commit. Details and the manual route are in <A href="/docs/installation">Install the SDK</A>.
                </P>
              </Step>

              <Step n={3} title="Set two environment variables">
                <P>Your merchant id and the AgentPay registry your buyers use.</P>
                <CodeBlock
                  lang="bash"
                  filename=".env.local"
                  code={`AGENTPAY_MERCHANT_ID=mrc_your_assigned_id
AGENTPAY_REGISTRY_URL=https://agentpay-yuno.vercel.app`}
                />
              </Step>

              <Step n={4} title="Publish discovery">
                <P>
                  Create the file below. It tells any agent standing on your product page who you are and where to send
                  a purchase.
                </P>
                <CodeBlock
                  lang="ts"
                  filename="app/.well-known/agentpay.json/route.ts"
                  code={`import { merchantManifest } from "@agentpay/merchant-sdk";

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
}`}
                />
              </Step>

              <Step n={5} title="Protect checkout">
                <P>
                  Create the handler once, hand it your own product lookup, and return whatever it returns. The lookup is
                  the only store-specific code in the integration.
                </P>
                <CodeBlock
                  lang="ts"
                  filename="app/api/agentpay/checkout/route.ts"
                  code={`import { createAgentPayCheckoutHandler } from "@agentpay/merchant-sdk";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkout = createAgentPayCheckoutHandler({
  merchantId: process.env.AGENTPAY_MERCHANT_ID!,
  registryUrl: process.env.AGENTPAY_REGISTRY_URL!,
  resolveProduct: async (productId) => {
    const product = await db.products.findById(productId);
    if (!product) return null;
    return {
      id: product.id,
      merchant_id: process.env.AGENTPAY_MERCHANT_ID!,
      name: product.name,
      category: product.category,
      price_cents: product.priceCents,
      currency: "USD",
    };
  },
});

export async function POST(request: Request) {
  return checkout(request);
}`}
                />
                <Callout tone="warn" title="Charge after the decision, never before">
                  <p>
                    Call your payment provider only when <C>decision === &quot;approved&quot;</C>. See{" "}
                    <A href="/docs/checkout">Protect checkout</A> for the full decision handling, including the
                    escalation path.
                  </p>
                </Callout>
              </Step>

              <Step n={6} title="Verify it works" last>
                <P>Start your store and check both routes.</P>
                <CodeBlock
                  lang="bash"
                  code={`curl -s http://localhost:3000/.well-known/agentpay.json

curl -s -o /dev/null -w "%{http_code}\\n" \\
  -X POST http://localhost:3000/api/agentpay/checkout \\
  -H "content-type: application/json" \\
  -d '{"mandate_id":"00000000-0000-4000-8000-000000000000","merchant_id":"mrc_demo_store","product_id":"p_1"}'`}
                />
                <P>
                  The manifest returns JSON with your merchant id and checkout endpoint. The unsigned checkout returns{" "}
                  <C>401</C> with reason code <C>AGENT_SIGNATURE_INVALID</C>. That refusal is the integration working:
                  nothing unsigned gets through.
                </P>
              </Step>
            </Steps>
          ),
        },
        {
          id: "expected-manifest",
          title: "What a correct manifest looks like",
          body: (
            <>
              <CodeBlock
                lang="json"
                code={`{
  "protocol": "agentpay/1.0",
  "merchant": { "id": "mrc_your_assigned_id", "name": "Demo Store" },
  "checkout_endpoint": "https://my-store.example/api/agentpay/checkout",
  "registry_url": "https://agentpay-yuno.vercel.app/",
  "capabilities": ["intent-mandates", "live-revocation", "mock-payment"]
}`}
              />
              <P>
                If <C>checkout_endpoint</C> points at localhost or a preview URL, an agent on the public internet cannot
                reach you. Set <C>origin</C> from the incoming request, as above, and it follows your deployment.
              </P>
            </>
          ),
        },
        {
          id: "first-real-purchase",
          title: "Your first real purchase",
          body: (
            <>
              <P>Once the two routes are live, a full end-to-end purchase needs a buyer and an agent:</P>
              <List ordered>
                <LI>
                  A buyer signs in to AgentPay, registers a passkey and saves a card at{" "}
                  <A href="https://agentpay-yuno.vercel.app/account">agentpay-yuno.vercel.app/account</A>.
                </LI>
                <LI>
                  They connect the AgentPay MCP server to their assistant from{" "}
                  <A href="https://agentpay-yuno.vercel.app/connect">/connect</A>.
                </LI>
                <LI>
                  The agent calls <C>create_mandate</C> scoped to your assigned merchant ID and one of your categories; the
                  buyer approves it with a passkey.
                </LI>
                <LI>The agent posts a signed request to your checkout route, and your handler decides.</LI>
              </List>
              <Callout tone="tip" title="No buyer handy?">
                <p>
                  You do not need one to test your route. <A href="/docs/testing">Test the integration</A> shows how to
                  sign a request with a generated key pair and a stubbed registry, so you can exercise approved, refused
                  and escalated paths offline.
                </p>
              </Callout>
            </>
          ),
        },
      ]}
    />
  );
}
