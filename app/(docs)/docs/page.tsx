import { BookOpen, Boxes, Building2, PlugZap, Rocket, ShieldCheck, TerminalSquare } from "lucide-react";

import { CopyButton } from "@/components/docs/CopyButton";
import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, Cards, CodeBlock, LI, Lead, LinkCard, List, P, Steps, Step } from "@/components/docs/prose";

const HREF = "/docs";

const AGENT_SETUP_PROMPT = `Integrate AgentPay into this store so AI agents can make purchases only within a buyer-signed mandate.

Use the live AgentPay merchant documentation as the source of truth:
- Overview: https://agentpay-yuno.vercel.app/docs
- Quickstart: https://agentpay-yuno.vercel.app/docs/quickstart
- Installation: https://agentpay-yuno.vercel.app/docs/installation
- Discovery: https://agentpay-yuno.vercel.app/docs/discovery
- Checkout: https://agentpay-yuno.vercel.app/docs/checkout
- Framework recipes: https://agentpay-yuno.vercel.app/docs/frameworks
- Testing: https://agentpay-yuno.vercel.app/docs/testing
- SDK reference: https://agentpay-yuno.vercel.app/docs/reference

Work in the existing project and follow its conventions. First inspect the framework, package manager, product/catalog model, checkout flow, environment-variable conventions, tests, and contributor instructions. Then implement the thinnest complete integration:

1. Install @agentpay/merchant-sdk using the documented AgentPay repository installer. Vendor and commit the generated tarball so CI can reproduce the install. If this store is inside the AgentPay repository, use the documented source import instead.
2. Add AGENTPAY_MERCHANT_ID and AGENTPAY_REGISTRY_URL to the project's environment example with placeholder values. Use https://agentpay-yuno.vercel.app as the registry URL. Never invent a merchant ID, add a shared merchant secret, or commit credentials. If no assigned mrc_… value is available, leave a clear placeholder and tell me to create or copy it from https://agentpay-yuno.vercel.app/developers.
3. Publish GET /.well-known/agentpay.json with merchantManifest. Derive the public origin from the request, use the assigned merchant ID and real store name, point checkoutPath to /api/agentpay/checkout, allow cross-origin reads, and apply the documented short public cache policy.
4. Add POST /api/agentpay/checkout with createAgentPayCheckoutHandler. Keep the exact raw request body intact. Configure the Node runtime where the framework supports runtime selection, keep the route dynamic and uncached, and do not add any bypass header or alternate approval path.
5. Implement resolveProduct against this store's authoritative server-side catalog. The agent supplies only product_id. Return the store-owned id, merchant_id, name, stable buyer-readable category, integer price_cents, and ISO currency. Return null for missing, unpublished, unavailable, or out-of-stock products. Never trust an amount, currency, category, or merchant supplied by the agent.
6. Preserve the SDK response for refused and escalated decisions. Move money and fulfil only when decision is exactly approved. If this project already charges a payment provider, connect that existing server-side flow after approval and make it idempotent. If it has no real payment integration, keep the charge mocked and state that limitation instead of inventing one.
7. Add focused tests for: a valid manifest; an unsigned checkout being rejected with 401 and AGENT_SIGNATURE_INVALID; an unknown product returning 404; and approved, refused, and escalated signed requests using the documented signing helpers and a stubbed registry. Include a live-revocation case if the existing test setup can exercise it without external credentials.
8. Update the project's integration documentation with setup, environment variables, routes, verification commands, the approved/escalated/refused handling contract, and the mocked-payment limitation if applicable.

Run every command and sample you document. Run the project's relevant typecheck, tests, and build in proportion to the change. Fix failures caused by this work, but do not overwrite unrelated changes. At the end, summarize the files changed, verification results, the merchant ID or deployment values I still need to provide, and the exact steps for one end-to-end purchase through AgentPay.`;

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <>
          <Lead>
            AgentPay is the authorization layer between an AI agent and your checkout. The buyer signs a narrow mandate
            with a passkey — this merchant, this category, this amount, this many times — and your store gets a
            cryptographic answer to one question on every request: <em>is this agent allowed to spend this money right
            now?</em>
          </Lead>
          <P>
            Your side of that is small on purpose. Install one package, publish one JSON file, and wrap one route. The
            SDK does the signature checks, the live revocation check and the policy evaluation for you.
          </P>
          <Callout tone="tip" title="Start in the merchant console">
            <p>
              <A href="/developers">AgentPay Developers</A> assigns the immutable merchant ID used by mandates. It can
              also create a hosted test store, sample catalog, checkout endpoint and server-side catalog key so the
              complete flow works before you deploy your own store.
            </p>
          </Callout>
          <Cards>
            <LinkCard
              href="/docs/quickstart"
              icon={<Rocket className="size-4" />}
              title="Quickstart"
              description="A new store accepting agent purchases in five minutes, with two copy-paste routes."
            />
            <LinkCard
              href="/docs/installation"
              icon={<Boxes className="size-4" />}
              title="Install the SDK"
              description="One command to build and install @agentpay/merchant-sdk into your project."
            />
            <LinkCard
              href="/docs/stores"
              icon={<Building2 className="size-4" />}
              title="Merchant console"
              description="Get a merchant ID, hosted mock store, API key, and live-domain verification."
            />
          </Cards>
        </>
      }
      sections={[
        {
          id: "agent-setup-prompt",
          title: "Set up AgentPay with your coding agent",
          body: (
            <div className="my-5 rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
              <h3 className="text-[16px] font-semibold text-ink">Copy the AgentPay setup prompt</h3>
              <p className="mt-1 text-[13.5px] leading-[1.65] text-ink-2">
                Paste it into your coding agent from your store&apos;s project. It covers installation, checkout safety,
                tests, and documentation.
              </p>
              <div className="mt-4">
                <CopyButton
                  value={AGENT_SETUP_PROMPT}
                  label="Copy agent prompt"
                  className="bg-brand text-white hover:bg-brand-ink hover:text-white focus-visible:ring-brand/40"
                />
              </div>
              <p className="mt-3 text-[12.5px] leading-5 text-muted">
                You will still need an assigned merchant ID from <A href="/developers">AgentPay Developers</A>. The
                prompt deliberately asks the agent to leave a placeholder rather than fabricate one.
              </p>
            </div>
          ),
        },
        {
          id: "what-the-sdk-does",
          title: "What the SDK does for you",
          body: (
            <>
              <P>
                <C>@agentpay/merchant-sdk</C> ships two things: a manifest builder so agents can discover you, and a
                checkout handler that refuses everything it cannot prove. Before your code ever sees a purchase, the
                handler has verified:
              </P>
              <List>
                <LI>
                  the <strong>agent request signature</strong> — Ed25519 over the method, path, body hash, timestamp and
                  nonce, checked against the agent key published by the registry;
                </LI>
                <LI>
                  the <strong>timestamp</strong> is within 60 seconds, and the <strong>nonce</strong> has never been used
                  before, so a captured request cannot be replayed;
                </LI>
                <LI>
                  the <strong>mandate signature</strong> — the registry signed exactly this mandate, and the mandate names
                  exactly this agent;
                </LI>
                <LI>
                  the <strong>live mandate status</strong>, read uncached on every purchase, so a revocation one second
                  ago is effective now;
                </LI>
                <LI>
                  the <strong>policy</strong> — merchant, category, currency, per-purchase limit, cumulative limit,
                  remaining uses, validity window, and any approved one-time exception.
                </LI>
              </List>
              <Callout tone="tip" title="The price is yours, not the agent's">
                <p>
                  The agent sends a product id, never an amount. The handler asks <em>your</em> catalog what that product
                  costs through <C>resolveProduct</C> and evaluates the mandate against that number. An agent cannot talk
                  its way under a limit.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "how-a-purchase-works",
          title: "How a purchase reaches your store",
          body: (
            <>
              <Steps>
                <Step n={1} title="The buyer authorizes a mandate">
                  <P>
                    The agent asks AgentPay for a mandate that matches what the user said. The user signs that exact
                    mandate with a passkey. No signature, no mandate — your store is never part of this step.
                  </P>
                </Step>
                <Step n={2} title="The agent finds your store">
                  <P>
                    Through ordinary search or a product link. It reads <C>/.well-known/agentpay.json</C> on your domain
                    to learn your merchant id and checkout endpoint. AgentPay is not a store directory; discovery lives
                    on your domain.
                  </P>
                </Step>
                <Step n={3} title="The agent posts a signed checkout request">
                  <P>
                    A tiny body — mandate id, merchant id, product id — with four signature headers.
                  </P>
                </Step>
                <Step n={4} title="The SDK verifies and decides">
                  <P>
                    Signature, replay, registry, live status, policy. You receive <C>approved</C>, <C>escalated</C> or{" "}
                    <C>refused</C> with a reason code.
                  </P>
                </Step>
                <Step n={5} title="You charge, only on approved" last>
                  <P>
                    Your payment provider runs after the decision, never before it. This challenge build returns a mock
                    single-use payment token instead of moving money.
                  </P>
                </Step>
              </Steps>
            </>
          ),
        },
        {
          id: "what-you-build",
          title: "What you actually build",
          body: (
            <>
              <P>Two routes. That is the whole integration surface.</P>
              <CodeBlock
                lang="text"
                filename="Your store"
                code={`your-store.example/
├─ .well-known/agentpay.json   ← who you are, where checkout lives
└─ api/agentpay/checkout       ← the verified checkout route`}
              />
              <P>
                Everything else — mandate issuance, passkey ceremonies, revocation, the audit trail — happens inside
                AgentPay and the buyer&apos;s account. You never store a card, a passkey, or a mandate.
              </P>
            </>
          ),
        },
        {
          id: "requirements",
          title: "Requirements",
          body: (
            <>
              <List>
                <LI>
                  <strong>Node.js 22 or newer</strong>, or any runtime with Web <C>Request</C>/<C>Response</C> and
                  <C> crypto.randomUUID</C> — Next.js, Hono, Cloudflare Workers, Deno and Bun all qualify.
                </LI>
                <LI>
                  <strong>zod 4</strong> as a dependency (the SDK validates every registry response it reads).
                </LI>
                <LI>
                  <strong>A public HTTPS origin</strong> for your manifest and checkout route. For local development a
                  tunnel works; see <A href="/docs/testing">Test the integration</A>.
                </LI>
                <LI>
                  <strong>An AgentPay merchant ID</strong> — create one at <A href="/developers">/developers</A>.
                  Mandates are scoped to it, so the console makes it immutable after creation.
                </LI>
              </List>
              <Callout tone="warn" title="Node-only signature verification today">
                <p>
                  Verification uses <C>node:crypto</C>. It runs on Node and Bun and on Vercel&apos;s Node runtime. On an
                  edge runtime, keep the checkout route on Node (<C>export const runtime = &quot;nodejs&quot;</C>).
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "keep-reading",
          title: "Keep reading",
          body: (
            <Cards>
              <LinkCard
                href="/docs/discovery"
                icon={<PlugZap className="size-4" />}
                title="Publish discovery"
                description="Serve the manifest agents look for on your domain."
              />
              <LinkCard
                href="/docs/checkout"
                icon={<ShieldCheck className="size-4" />}
                title="Protect checkout"
                description="Wrap your route and handle each decision correctly."
              />
              <LinkCard
                href="/docs/testing"
                icon={<TerminalSquare className="size-4" />}
                title="Test the integration"
                description="Sign a request locally and rehearse a live revocation."
              />
              <LinkCard
                href="/docs/reference"
                icon={<BookOpen className="size-4" />}
                title="SDK reference"
                description="Every exported function, option and type."
              />
            </Cards>
          ),
        },
      ]}
    />
  );
}
