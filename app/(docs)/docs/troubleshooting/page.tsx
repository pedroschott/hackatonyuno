import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, CodeBlock, DataTable, LI, Lead, List, P } from "@/components/docs/prose";

const HREF = "/docs/troubleshooting";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <Lead>
          Almost every integration failure is one of six things. Start with the <C>checks</C> object in the response — it
          tells you which stage failed before you read another line of code.
        </Lead>
      }
      sections={[
        {
          id: "read-checks",
          title: "Read the checks object first",
          body: (
            <>
              <CodeBlock
                lang="ts"
                code={`const response = await checkout(request);
const result = await response.clone().json();
console.log(response.status, result.decision, result.reason_code, result.checks);`}
              />
              <DataTable
                head={["First false check", "Where to look"]}
                rows={[
                  [<C key="a">agent_signature</C>, "Body bytes, request path, clock, or a reused nonce."],
                  [<C key="m">mandate_signature</C>, "Wrong registry URL, or the mandate belongs to another agent."],
                  [<C key="r">registry_status</C>, "The mandate is not active — revoked, expired or still a draft."],
                  [<C key="p">policy</C>, "A real policy refusal. The reason code names which rule."],
                ]}
              />
            </>
          ),
        },
        {
          id: "always-401",
          title: "Every request returns 401",
          body: (
            <>
              <P>
                The signature is computed over bytes and a path. Something in your stack is changing one of them. In
                order of likelihood:
              </P>
              <List ordered>
                <LI>
                  <strong>A body parser ran first.</strong> <C>express.json()</C>, a Fastify JSON parser or a middleware
                  that re-serializes the body changes <C>sha256(body)</C>. Give this route the raw body — see{" "}
                  <A href="/docs/frameworks">Framework recipes</A>.
                </LI>
                <LI>
                  <strong>A rewrite changed the path.</strong> The agent signed{" "}
                  <C>/api/agentpay/checkout</C>; your handler sees <C>/internal/checkout</C>. Log{" "}
                  <C>new URL(request.url).pathname</C> and compare.
                </LI>
                <LI>
                  <strong>Clock skew.</strong> More than 60 seconds between the agent and your server. Check NTP on the
                  host, or the container clock.
                </LI>
                <LI>
                  <strong>Headers dropped.</strong> A gateway or CDN stripped <C>x-signature</C> and friends. Echo the
                  four headers at the edge of your stack.
                </LI>
                <LI>
                  <strong>The registry URL is wrong.</strong> The agent key lookup 404s, so the signature can never
                  verify. Curl{" "}
                  <C>{`$AGENTPAY_REGISTRY_URL/api/registry/agents/<agent-id>`}</C>.
                </LI>
              </List>
              <Callout tone="tip" title="Confirm it is not the SDK">
                <p>
                  Run the offline test from <A href="/docs/testing">Test the integration</A>. If it passes and your live
                  route fails, the problem is in the transport, not the verification.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "retry-401",
          title: "The first request works, the retry returns 401",
          body: (
            <>
              <P>
                Working as designed. Nonces are single-use: the registry answers <C>409</C> the second time it sees one,
                and the handler turns that into <C>401</C>. A retry must be re-signed with a fresh nonce and timestamp.
              </P>
              <P>
                Use the nonce as your payment idempotency key rather than as a retry token — it identifies exactly one
                purchase attempt.
              </P>
            </>
          ),
        },
        {
          id: "mandate-signature",
          title: "MANDATE_SIGNATURE_INVALID on a real mandate",
          body: (
            <List>
              <LI>
                <strong>Wrong registry.</strong> Your <C>registryUrl</C> points at a different AgentPay deployment than
                the one that issued the mandate. Preview and production are different registries.
              </LI>
              <LI>
                <strong>Another agent&apos;s mandate.</strong> The mandate&apos;s <C>agent.agent_id</C> or public key
                does not match <C>x-agent-id</C>. This is the check that stops a stolen mandate id from being useful.
              </LI>
              <LI>
                <strong>The key endpoint failed.</strong> If <C>/api/registry/keys</C> is unreachable the SDK refuses
                rather than trusting the mandate. Curl it.
              </LI>
              <LI>
                <strong>You are reimplementing verification.</strong> Canonical JSON differences are the usual cause —
                see <A href="/docs/reference/protocol">Protocol and registry</A>.
              </LI>
            </List>
          ),
        },
        {
          id: "scope",
          title: "MERCHANT_NOT_IN_SCOPE or CATEGORY_NOT_IN_SCOPE",
          body: (
            <>
              <P>Almost always a naming mismatch rather than a policy decision.</P>
              <List>
                <LI>
                  Your manifest advertises one merchant id and your handler enforces another. Read both from{" "}
                  <C>AGENTPAY_MERCHANT_ID</C>.
                </LI>
                <LI>
                  The buyer authorized a mandate before you changed your id. Merchant ids are permanent for exactly this
                  reason.
                </LI>
                <LI>
                  <C>resolveProduct</C> returns an internal category (<C>tires/winter/17in</C>) while the buyer approved{" "}
                  <C>tires</C>. Map internal taxonomy to the coarse category the buyer sees.
                </LI>
              </List>
            </>
          ),
        },
        {
          id: "product",
          title: "404 Product not found",
          body: (
            <P>
              <C>resolveProduct</C> returned <C>null</C>, or the product&apos;s <C>merchant_id</C> is not yours. Confirm
              the id the agent sent is the one you publish on your product page, and that the record you return sets{" "}
              <C>merchant_id</C> to your configured id — not to a foreign key from your database.
            </P>
          ),
        },
        {
          id: "install",
          title: "Install and runtime errors",
          body: (
            <DataTable
              head={["Error", "Cause and fix"]}
              rows={[
                [
                  <C key="a">ERR_MODULE_NOT_FOUND</C>,
                  <>
                    The vendored tarball path in <C>package.json</C> is wrong or the file was not committed. Re-run{" "}
                    <C>npm run sdk:install -- .</C> from the AgentPay repo.
                  </>,
                ],
                [
                  <C key="b">Cannot find module &quot;node:crypto&quot;</C>,
                  <>
                    The route is running on an edge runtime. Add <C>export const runtime = &quot;nodejs&quot;</C>, or
                    host the checkout route on Node.
                  </>,
                ],
                [
                  <C key="c">zod version conflict</C>,
                  "The SDK needs zod 4. Two majors in one tree produce confusing schema errors; dedupe to one.",
                ],
                [
                  <C key="d">TypeError: Invalid URL</C>,
                  <>
                    <C>AGENTPAY_REGISTRY_URL</C> is unset or not absolute. It must include the scheme.
                  </>,
                ],
                [
                  <C key="e">Stale responses in production</C>,
                  <>
                    A cache in front of the checkout route. Set <C>dynamic = &quot;force-dynamic&quot;</C> and exclude
                    the path at your CDN.
                  </>,
                ],
              ]}
            />
          ),
        },
        {
          id: "discovery",
          title: "The agent does not see AgentPay support",
          body: (
            <List>
              <LI>
                Curl <C>https://your-store/.well-known/agentpay.json</C> from outside your network — a dot-folder is easy
                to lose to a static-file rule.
              </LI>
              <LI>
                Check <C>checkout_endpoint</C> is the public origin, not localhost or a preview URL.
              </LI>
              <LI>
                Allow the path in <C>robots.txt</C> if your rules are broad.
              </LI>
              <LI>
                Validate the shape by calling <C>discoverAgentPayMerchant</C> against your own store; it throws on
                anything an agent would reject.
              </LI>
            </List>
          ),
        },
        {
          id: "still-stuck",
          title: "Still stuck",
          body: (
            <>
              <P>Log one line per attempt with everything you need to reconstruct it later:</P>
              <CodeBlock
                lang="ts"
                code={`console.info("agentpay.checkout", {
  status: response.status,
  decision: result.decision,
  reason: result.reason_code,
  checks: result.checks,
  mandate_id: body.mandate_id,
  nonce: request.headers.get("x-nonce"),
  path: new URL(request.url).pathname,
});`}
              />
              <P>
                That plus the <A href="/docs/reference/decisions">reason code table</A> explains every outcome. The
                buyer&apos;s side of the same attempt is visible to them on{" "}
                <A href="https://agentpay-yuno.vercel.app/activity">/activity</A>, and the hash-chained record is on{" "}
                <A href="https://agentpay-yuno.vercel.app/audit">/audit</A>.
              </P>
            </>
          ),
        },
      ]}
    />
  );
}
