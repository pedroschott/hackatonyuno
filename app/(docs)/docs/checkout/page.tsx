import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, CodeBlock, DataTable, LI, Lead, List, P, PropTable } from "@/components/docs/prose";

const HREF = "/docs/checkout";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <Lead>
          <C>createAgentPayCheckoutHandler</C> turns a <C>Request</C> into a decision. It refuses anything it cannot
          prove, and it never touches money — charging stays entirely on your side, after an approval.
        </Lead>
      }
      sections={[
        {
          id: "create",
          title: "Create the handler",
          body: (
            <>
              <P>Create it once at module scope and reuse it. It holds no per-request state.</P>
              <CodeBlock
                lang="ts"
                filename="app/api/agentpay/checkout/route.ts"
                code={`import { createAgentPayCheckoutHandler } from "@agentpay/merchant-sdk";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MERCHANT_ID = process.env.AGENTPAY_MERCHANT_ID!;

const checkout = createAgentPayCheckoutHandler({
  merchantId: MERCHANT_ID,
  registryUrl: process.env.AGENTPAY_REGISTRY_URL!,
  resolveProduct: async (productId) => {
    const row = await db.products.findById(productId);
    if (!row) return null;
    return {
      id: row.id,
      merchant_id: MERCHANT_ID,
      name: row.name,
      category: row.category,
      price_cents: row.priceCents,
      currency: row.currency,
    };
  },
});

export async function POST(request: Request) {
  return checkout(request);
}`}
              />
              <Callout tone="warn" title="Do not read the body first">
                <p>
                  The handler reads the raw body itself to verify the signature over its exact bytes. If your framework
                  or middleware parses or re-serializes the body before the handler sees it, every request fails with{" "}
                  <C>AGENT_SIGNATURE_INVALID</C>. See <A href="/docs/frameworks">Framework recipes</A>.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "options",
          title: "Handler options",
          body: (
            <PropTable
              rows={[
                {
                  name: "merchantId",
                  type: "string",
                  required: true,
                  description: (
                    <>
                      Your slug. A request whose body names a different merchant is rejected with <C>400</C>, and a
                      product belonging to another merchant with <C>404</C>.
                    </>
                  ),
                },
                {
                  name: "registryUrl",
                  type: "string",
                  required: true,
                  description: "Base URL of the AgentPay deployment. All four registry lookups are resolved against it.",
                },
                {
                  name: "resolveProduct",
                  type: "(productId: string) => Promise<MerchantProduct | null>",
                  required: true,
                  description: (
                    <>
                      Your catalog lookup. Return <C>null</C> for anything unknown, unpublished or out of stock — the
                      handler answers <C>404</C> without consulting the mandate.
                    </>
                  ),
                },
                {
                  name: "fetcher",
                  type: "typeof fetch",
                  description: "Replace the fetch used for registry calls. Useful in tests, or to add tracing and retries.",
                },
                {
                  name: "now",
                  type: "() => Date",
                  description: "Override the clock. Tests use it to pin timestamp and expiry behaviour deterministically.",
                },
              ]}
            />
          ),
        },
        {
          id: "product",
          title: "The product contract",
          body: (
            <>
              <P>
                <C>resolveProduct</C> is where your store defines the truth of the transaction. The agent supplies only a
                product id; price, currency and category come from you.
              </P>
              <PropTable
                rows={[
                  { name: "id", type: "string", required: true, description: "Echoed back in the response so the agent can confirm what it bought." },
                  {
                    name: "merchant_id",
                    type: "string",
                    required: true,
                    description: "Must equal your configured merchantId, or the handler answers 404.",
                  },
                  { name: "name", type: "string", required: true, description: "Human label, returned to the agent and useful in your logs." },
                  {
                    name: "category",
                    type: "string",
                    required: true,
                    description: (
                      <>
                        Matched against the mandate&apos;s allowed categories. Use stable, coarse slugs like <C>tires</C>{" "}
                        — a buyer has to understand them when they sign.
                      </>
                    ),
                  },
                  {
                    name: "price_cents",
                    type: "number",
                    required: true,
                    description: "Integer minor units. Checked against the per-purchase and cumulative limits.",
                  },
                  {
                    name: "currency",
                    type: "string",
                    required: true,
                    description: (
                      <>
                        ISO code, for example <C>BRL</C>. A mismatch with the mandate is refused with{" "}
                        <C>CURRENCY_MISMATCH</C> rather than converted.
                      </>
                    ),
                  },
                ]}
              />
              <Callout tone="tip" title="Keep categories few and meaningful">
                <p>
                  Categories are the vocabulary a buyer uses to constrain an agent. Fifty micro-categories make mandates
                  unreadable and push buyers to approve something broader than they meant.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "verification",
          title: "What the handler verifies, in order",
          body: (
            <>
              <List ordered>
                <LI>
                  All four signature headers are present, and the timestamp is within 60 seconds of now — otherwise{" "}
                  <C>401</C>.
                </LI>
                <LI>
                  The agent id resolves to a public key at the registry, and the Ed25519 signature over{" "}
                  <C>METHOD|path|sha256(body)|timestamp|nonce</C> verifies — otherwise <C>401</C>.
                </LI>
                <LI>
                  The nonce is consumed at the registry. A nonce seen before is rejected, so a captured request cannot be
                  replayed — otherwise <C>401</C>.
                </LI>
                <LI>
                  The body parses and its <C>merchant_id</C> equals yours — otherwise <C>400</C>.
                </LI>
                <LI>
                  <C>resolveProduct</C> returns a product belonging to you — otherwise <C>404</C>.
                </LI>
                <LI>
                  The mandate is fetched uncached, the registry&apos;s signature over the canonical mandate verifies, and
                  the mandate names this exact agent and key.
                </LI>
                <LI>
                  The policy engine evaluates status, validity window, merchant, category, currency, remaining uses,
                  cumulative total and the per-purchase limit.
                </LI>
              </List>
              <Callout tone="note" title="Live status, every time">
                <p>
                  The mandate read uses <C>cache: &quot;no-store&quot;</C> on purpose. Revocation must take effect on the
                  next request, not after a TTL. Do not add your own cache in front of it.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "response",
          title: "The response",
          body: (
            <>
              <P>
                Every verified request returns <C>200</C> with a decision — including refusals, which are answers rather
                than errors. Only unverifiable requests get a non-200 status.
              </P>
              <CodeBlock
                lang="json"
                code={`{
  "decision": "approved",
  "reason_code": null,
  "product": {
    "id": "prd_standard_tires",
    "merchant_id": "mrc_demo_store",
    "name": "Standard tire set",
    "category": "tires",
    "price_cents": 154800,
    "currency": "BRL"
  },
  "checks": {
    "agent_signature": true,
    "mandate_signature": true,
    "registry_status": true,
    "policy": true
  }
}`}
              />
              <DataTable
                head={["Status", "Meaning"]}
                rows={[
                  ["200", "Verified request. Read decision: approved, escalated or refused."],
                  ["400", "Malformed body, or a merchant_id that is not yours."],
                  ["401", "Missing, stale, replayed or invalid agent signature. The checks object shows which."],
                  ["404", "resolveProduct returned null, or the product belongs to another merchant."],
                ]}
              />
              <P>
                The <C>checks</C> object is a diagnostic, not a decision. Never approve based on it; use{" "}
                <C>decision</C>.
              </P>
            </>
          ),
        },
        {
          id: "act",
          title: "Act on the decision",
          body: (
            <>
              <P>
                To charge, wrap the handler: let it decide, then run your payment flow only for <C>approved</C>. Clone
                the response so you can inspect it without consuming it.
              </P>
              <CodeBlock
                lang="ts"
                filename="app/api/agentpay/checkout/route.ts"
                code={`export async function POST(request: Request) {
  const response = await checkout(request);
  if (!response.ok) return response;

  const result = await response.clone().json();
  if (result.decision !== "approved") return response;

  // Only now does money move. Key the charge to the mandate and product so a
  // retried request cannot charge twice.
  const order = await payments.charge({
    amountCents: result.product.price_cents,
    currency: result.product.currency,
    idempotencyKey: request.headers.get("x-nonce")!,
  });

  return Response.json({ ...result, order_id: order.id });
}`}
              />
              <DataTable
                head={["Decision", "What it means", "What your store does"]}
                rows={[
                  [
                    <C key="a">approved</C>,
                    "Inside the signed mandate, live and within every limit.",
                    "Charge, fulfil, and return the order reference.",
                  ],
                  [
                    <C key="e">escalated</C>,
                    "Over the per-purchase limit, with no approved exception attached.",
                    "Return the response unchanged. The agent asks the buyer for a one-time approval and retries with exception_id.",
                  ],
                  [
                    <C key="r">refused</C>,
                    "Revoked, expired, out of scope, out of budget or unverifiable.",
                    "Charge nothing. Return the reason code so the agent can explain itself to the buyer.",
                  ],
                ]}
              />
              <P>
                Reason codes are enumerated in <A href="/docs/reference/decisions">Decisions and reason codes</A>.
              </P>
            </>
          ),
        },
        {
          id: "body",
          title: "The request body",
          body: (
            <>
              <P>Small on purpose — everything else is derived from signed state.</P>
              <CodeBlock
                lang="json"
                code={`{
  "mandate_id": "3eb0f49d-2c10-4d3a-8f34-08a47e2fca6e",
  "merchant_id": "mrc_demo_store",
  "product_id": "prd_standard_tires",
  "exception_id": "0d3f2b0f-2a7c-4c1e-9d0a-3f2b0f2a7c4c"
}`}
              />
              <PropTable
                rows={[
                  { name: "mandate_id", type: "uuid", required: true, description: "The mandate the buyer signed." },
                  { name: "merchant_id", type: "string", required: true, description: "Must equal your configured merchant id." },
                  { name: "product_id", type: "string", required: true, description: "Passed straight to your resolveProduct." },
                  {
                    name: "exception_id",
                    type: "uuid",
                    description: "A one-time approval the buyer signed after an escalation. Only relevant above the per-purchase limit.",
                  },
                ]}
              />
              <Callout tone="tip" title="No amount field, by design">
                <p>
                  There is nowhere for an agent to state a price. If your catalog says 154800, that is the number the
                  mandate is evaluated against.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "operating",
          title: "Operating notes",
          body: (
            <List>
              <LI>
                <strong>Retries need a fresh signature.</strong> Nonces are single-use, so an agent replaying the exact
                same request gets <C>401</C>. That is correct: it must re-sign, and your idempotency key should be the
                nonce.
              </LI>
              <LI>
                <strong>Approval is not settlement.</strong> If your payment provider fails after an approval, tell the
                agent the purchase failed; do not retry silently against the same mandate use.
              </LI>
              <LI>
                <strong>Keep the route on Node.</strong> Signature verification uses <C>node:crypto</C>.
              </LI>
              <LI>
                <strong>Log the decision, not the mandate.</strong> Reason code, mandate id and nonce are enough to
                explain any outcome later without storing the buyer&apos;s authorization artifacts.
              </LI>
              <LI>
                <strong>Never add a bypass.</strong> No header, IP allowlist or internal flag should skip the handler. It
                is the only thing standing between an agent and your checkout.
              </LI>
            </List>
          ),
        },
      ]}
    />
  );
}
