import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, CodeBlock, DataTable, LI, Lead, List, P } from "@/components/docs/prose";

const HREF = "/docs/testing";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <Lead>
          You do not need a buyer, a passkey or a real mandate to prove your integration works. The SDK exports the same
          signing helpers AgentPay uses, so you can drive approved, refused and escalated paths offline — then rehearse
          the one case that matters live: revocation.
        </Lead>
      }
      sections={[
        {
          id: "smoke",
          title: "1. The 10-second smoke test",
          body: (
            <>
              <P>An unsigned request must be refused. If this returns anything but 401, stop and fix it first.</P>
              <CodeBlock
                lang="bash"
                code={`curl -i -X POST http://localhost:3000/api/agentpay/checkout \\
  -H "content-type: application/json" \\
  -d '{"mandate_id":"00000000-0000-4000-8000-000000000000","merchant_id":"mrc_demo_store","product_id":"p_1"}'`}
              />
              <CodeBlock
                lang="json"
                filename="401 Unauthorized"
                code={`{
  "decision": "refused",
  "reason_code": "AGENT_SIGNATURE_INVALID",
  "checks": { "agent_signature": false, "mandate_signature": false, "registry_status": false, "policy": false }
}`}
              />
            </>
          ),
        },
        {
          id: "offline",
          title: "2. Offline test with a stubbed registry",
          body: (
            <>
              <P>
                Generate two key pairs — one for a fake agent, one for a fake registry — sign a mandate the same way
                AgentPay does, and answer the four registry calls from a stub <C>fetcher</C>. No network, deterministic
                clock.
              </P>
              <CodeBlock
                lang="ts"
                filename="tests/agentpay-checkout.test.ts"
                code={`import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  createAgentPayCheckoutHandler,
  generateEd25519KeyPair,
  signAgentPayRequest,
  signText,
  type RegistryMandate,
} from "@agentpay/merchant-sdk";

const NOW = new Date("2026-08-29T12:00:00.000Z");
const MERCHANT_ID = "mrc_demo_store";
const URL_ = "https://my-store.example/api/agentpay/checkout";

const agent = generateEd25519KeyPair();
const registry = generateEd25519KeyPair();

const artifact = {
  mandate_id: "3eb0f49d-2c10-4d3a-8f34-08a47e2fca6e",
  type: "intent",
  issuer: { user_id: "user-1" },
  agent: { agent_id: "agt_test", public_key: agent.publicKey },
  scope: { merchants: [MERCHANT_ID], categories: ["tires"] },
  limits: { per_purchase_cents: 200000, cumulative_cents: 400000, max_uses: 3, period: "month", currency: "BRL" },
  validity: { not_before: "2026-08-01T00:00:00.000Z", expires_at: "2026-09-01T00:00:00.000Z" },
  payment: { vault_card_id: "card-1" },
  authorization: { credential_id: "cred-1", mandate_hash: "hash", signed_at: "2026-08-29T11:00:00.000Z" },
} as const;

function mandate(status: RegistryMandate["status"] = "active"): RegistryMandate {
  return {
    ...artifact,
    status,
    usage: { approved_uses: 0, cumulative_cents: 0 },
    server_sig: signText(registry.privateKey, canonicalJson(artifact)),
  } as RegistryMandate;
}

function stubRegistry(current: RegistryMandate): typeof fetch {
  return async (input) => {
    const path = new URL(input.toString()).pathname;
    if (path.startsWith("/api/registry/agents/")) {
      return Response.json({ id: "agt_test", public_key: agent.publicKey });
    }
    if (path === "/api/registry/nonces") return Response.json({ consumed: true }, { status: 201 });
    if (path.startsWith("/api/registry/mandates/")) return Response.json(current);
    if (path === "/api/registry/keys") {
      return Response.json({ algorithm: "Ed25519", public_key: registry.publicKey });
    }
    return new Response(null, { status: 404 });
  };
}

function handlerFor(current: RegistryMandate) {
  return createAgentPayCheckoutHandler({
    merchantId: MERCHANT_ID,
    registryUrl: "https://agentpay.example",
    fetcher: stubRegistry(current),
    now: () => NOW,
    resolveProduct: async () => ({
      id: "prd_tires",
      merchant_id: MERCHANT_ID,
      name: "Standard tire set",
      category: "tires",
      price_cents: 154800,
      currency: "BRL",
    }),
  });
}

function signedRequest(nonce: string) {
  const body = JSON.stringify({
    mandate_id: artifact.mandate_id,
    merchant_id: MERCHANT_ID,
    product_id: "prd_tires",
  });
  const headers = signAgentPayRequest({
    agentId: "agt_test",
    privateKey: agent.privateKey,
    method: "POST",
    url: URL_,
    body,
    now: NOW,
    nonce,
  });
  return new Request(URL_, { method: "POST", headers, body });
}

describe("agentpay checkout", () => {
  it("approves a purchase inside the mandate", async () => {
    const response = await handlerFor(mandate())(signedRequest("nonce-1"));
    await expect(response.json()).resolves.toMatchObject({ decision: "approved", reason_code: null });
  });

  it("refuses a revoked mandate", async () => {
    const response = await handlerFor(mandate("revoked"))(signedRequest("nonce-2"));
    await expect(response.json()).resolves.toMatchObject({
      decision: "refused",
      reason_code: "MANDATE_REVOKED",
    });
  });

  it("refuses an unsigned request", async () => {
    const response = await handlerFor(mandate())(
      new Request(URL_, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
    );
    expect(response.status).toBe(401);
  });
});`}
              />
              <Callout tone="tip" title="This is your regression net">
                <p>
                  Keep these three tests in CI. They catch the two mistakes that silently disable AgentPay: a body parser
                  that breaks signatures, and a refactor that charges before reading the decision.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "matrix",
          title: "3. Exercise every refusal",
          body: (
            <>
              <P>Each refusal is one field away from the approved fixture. Change it, assert the reason code.</P>
              <DataTable
                head={["Change to the fixture", "Expected reason code"]}
                rows={[
                  [<>status: <C key="s">&quot;revoked&quot;</C></>, <C key="r">MANDATE_REVOKED</C>],
                  [<>validity.expires_at in the past</>, <C key="e">MANDATE_EXPIRED</C>],
                  [<>scope.merchants without your id</>, <C key="m">MERCHANT_NOT_IN_SCOPE</C>],
                  [<>product category not in scope.categories</>, <C key="c">CATEGORY_NOT_IN_SCOPE</C>],
                  [<>product currency differs from limits.currency</>, <C key="cur">CURRENCY_MISMATCH</C>],
                  [<>usage.approved_uses equal to limits.max_uses</>, <C key="u">USES_EXCEEDED</C>],
                  [<>usage.cumulative_cents near limits.cumulative_cents</>, <C key="cum">CUMULATIVE_EXCEEDED</C>],
                  [
                    <>price above limits.per_purchase_cents, no exception_id</>,
                    <>
                      <C>AMOUNT_EXCEEDS_LIMIT</C> with decision <C>escalated</C>
                    </>,
                  ],
                  [<>a mandate signed with a different registry key</>, <C key="sig">MANDATE_SIGNATURE_INVALID</C>],
                  [<>a timestamp more than 60 seconds off</>, <>401, <C>AGENT_SIGNATURE_INVALID</C></>],
                ]}
              />
              <P>
                Full definitions are in <A href="/docs/reference/decisions">Decisions and reason codes</A>.
              </P>
            </>
          ),
        },
        {
          id: "live",
          title: "4. Live end-to-end",
          body: (
            <>
              <P>When the offline tests pass, run it for real against a deployed AgentPay:</P>
              <List ordered>
                <LI>
                  Expose your store on public HTTPS. A tunnel is enough — the AgentPay repository ships{" "}
                  <C>npm run tunnel</C> for the same purpose.
                </LI>
                <LI>
                  Confirm <C>/.well-known/agentpay.json</C> is reachable from outside your network and advertises the
                  public origin.
                </LI>
                <LI>
                  As a buyer: sign in to AgentPay, register a passkey, save a card, then connect the MCP server to your
                  assistant from <A href="https://agentpay-yuno.vercel.app/connect">/connect</A>.
                </LI>
                <LI>
                  Ask the agent for something specific: <em>buy one set of tires from Demo Store, up to R$ 1,600, once</em>.
                  It creates a mandate; approve it with your passkey.
                </LI>
                <LI>
                  Let it purchase. Your route logs the decision; the buyer sees the attempt on{" "}
                  <A href="https://agentpay-yuno.vercel.app/activity">/activity</A>.
                </LI>
              </List>
            </>
          ),
        },
        {
          id: "revocation",
          title: "5. Rehearse a revocation",
          body: (
            <>
              <P>
                This is the demo moment worth practising, because it is the claim that matters: a buyer revokes, and the
                very next purchase fails at your store.
              </P>
              <List ordered>
                <LI>Complete one approved purchase so everyone sees the happy path.</LI>
                <LI>
                  The buyer taps revoke — on <C>/dashboard</C>, or from the phone inbox at <C>/m</C>.
                </LI>
                <LI>
                  Ask the agent to buy again. Your handler now returns <C>refused</C> with <C>MANDATE_REVOKED</C>, on the
                  first attempt, with no cache to wait out.
                </LI>
              </List>
              <Callout tone="note" title="Why it is immediate">
                <p>
                  The mandate read is uncached and the settlement decision is taken inside a database transaction that
                  serializes against revocation. A purchase in flight when revocation commits is voided, not settled.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "scenarios",
          title: "Scenario library",
          body: (
            <>
              <P>
                The repository carries declarative fixtures for the whole purchase circuit under{" "}
                <A href="https://github.com/pedroschott/hackatonyuno/tree/main/tests/attack-suite">tests/attack-suite</A>
                : valid purchase, over-limit, wrong merchant, expired, revoked, revoked mid-flow, agent impersonation,
                duplicate purchase, concurrent purchases, limit changed mid-flow, payment failure after authorization,
                malformed request, missing mandate and replayed authorization.
              </P>
              <P>
                They target the AgentPay services rather than your store, but the list doubles as a checklist: if you can
                explain what your route does in each of those fifteen situations, your integration is done.
              </P>
            </>
          ),
        },
        {
          id: "checklist",
          title: "Before you go live",
          body: (
            <List>
              <LI>Unsigned request → 401.</LI>
              <LI>Replayed request (same nonce) → 401.</LI>
              <LI>Revoked mandate → refused, first attempt.</LI>
              <LI>Over-limit purchase → escalated, and your route charges nothing.</LI>
              <LI>Approved purchase → charged exactly once, keyed on the nonce.</LI>
              <LI>Manifest reachable from the public internet with the right origin and merchant id.</LI>
              <LI>Decisions logged with reason code, mandate id and nonce.</LI>
            </List>
          ),
        },
      ]}
    />
  );
}
