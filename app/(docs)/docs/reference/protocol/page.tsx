import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, CodeBlock, DataTable, LI, Lead, List, P } from "@/components/docs/prose";

const HREF = "/docs/reference/protocol";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <Lead>
          The SDK implements all of this for you. Read it if you are debugging a signature, integrating from a language
          the SDK does not cover, or explaining to someone why an agent cannot forge a purchase.
        </Lead>
      }
      sections={[
        {
          id: "headers",
          title: "The signed request",
          body: (
            <>
              <P>An agent posts a small JSON body with four headers:</P>
              <CodeBlock
                lang="http"
                code={`POST /api/agentpay/checkout HTTP/1.1
host: my-store.example
content-type: application/json
x-agent-id: agt_9f2c1d
x-timestamp: 2026-08-29T12:00:00.000Z
x-nonce: 0f2a4c6e-8b1d-4f3a-9c5e-7a1b3d5f7091
x-signature: 5r0Yb2...base64url

{"mandate_id":"3eb0f49d-2c10-4d3a-8f34-08a47e2fca6e","merchant_id":"mrc_demo_store","product_id":"prd_tires"}`}
              />
              <DataTable
                head={["Header", "Meaning"]}
                rows={[
                  [<C key="a">x-agent-id</C>, "Registry id of the agent. Its public key is fetched from the registry."],
                  [<C key="t">x-timestamp</C>, "ISO 8601. Must be within 60 seconds of the merchant clock."],
                  [<C key="n">x-nonce</C>, "Single-use value, consumed at the registry. A repeat is a replay."],
                  [<C key="s">x-signature</C>, "Ed25519 signature over the signing message, base64url."],
                ]}
              />
            </>
          ),
        },
        {
          id: "signing-message",
          title: "The signing message",
          body: (
            <>
              <CodeBlock
                lang="text"
                code={`METHOD|path|base64url(sha256(body))|timestamp|nonce

POST|/api/agentpay/checkout|Ux1n...|2026-08-29T12:00:00.000Z|0f2a4c6e-8b1d-4f3a-9c5e-7a1b3d5f7091`}
              />
              <List>
                <LI>
                  <strong>METHOD</strong> is uppercased.
                </LI>
                <LI>
                  <strong>path</strong> is <C>new URL(request.url).pathname</C> — no query string, no origin. A rewrite
                  between the agent and your handler invalidates the signature.
                </LI>
                <LI>
                  <strong>body hash</strong> is SHA-256 of the exact request bytes, base64url. Re-serialization changes
                  it.
                </LI>
                <LI>
                  Fields are joined with <C>|</C>. Signature and hash are base64url without padding.
                </LI>
              </List>
              <Callout tone="note" title="Why a body hash and not the body">
                <p>
                  The message stays a fixed size, and the merchant can verify without buffering an arbitrary payload
                  twice.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "registry",
          title: "Registry endpoints",
          body: (
            <>
              <P>
                Four public, narrowly scoped endpoints. They return exact-id projections — they are not searchable and
                expose no buyer data.
              </P>
              <DataTable
                head={["Endpoint", "Called for", "Caching"]}
                rows={[
                  [
                    <C key="a">GET /api/registry/agents/:id</C>,
                    "The agent verification key behind x-agent-id.",
                    "Registry sets max-age=60.",
                  ],
                  [
                    <C key="n">POST /api/registry/nonces</C>,
                    "Consuming the nonce. 409 means it was already used.",
                    "Never cached.",
                  ],
                  [
                    <C key="m">GET /api/registry/mandates/:id</C>,
                    "The signed mandate and its live status.",
                    <>
                      Read with <C>no-store</C> so revocation is immediate.
                    </>,
                  ],
                  [
                    <C key="k">GET /api/registry/keys</C>,
                    "The registry Ed25519 public key.",
                    <>
                      Read with <C>force-cache</C>; rotation is rare and announced.
                    </>,
                  ],
                ]}
              />
              <P>
                If any of the first three fails, the handler answers <C>401</C>. If the key endpoint fails, the mandate
                signature cannot be verified and the purchase is refused with <C>MANDATE_SIGNATURE_INVALID</C> — the
                SDK never falls open.
              </P>
            </>
          ),
        },
        {
          id: "mandate",
          title: "The mandate",
          body: (
            <>
              <P>
                A mandate is the buyer&apos;s signed instruction. The registry signs the canonical JSON of every field
                below except <C>server_sig</C>, <C>status</C> and <C>usage</C>; your handler recomputes that canonical
                form and verifies the signature before trusting any of it.
              </P>
              <CodeBlock
                lang="json"
                code={`{
  "mandate_id": "3eb0f49d-2c10-4d3a-8f34-08a47e2fca6e",
  "type": "intent",
  "issuer": { "user_id": "usr_1" },
  "agent": { "agent_id": "agt_9f2c1d", "public_key": "-----BEGIN PUBLIC KEY-----…" },
  "scope": { "merchants": ["mrc_demo_store"], "categories": ["tires"] },
  "limits": {
    "per_purchase_cents": 160000,
    "cumulative_cents": 400000,
    "max_uses": 3,
    "period": "month",
    "currency": "USD"
  },
  "validity": { "not_before": "2026-08-01T00:00:00.000Z", "expires_at": "2026-09-01T00:00:00.000Z" },
  "payment": { "vault_card_id": "vc_1" },
  "authorization": { "credential_id": "cred_1", "mandate_hash": "…", "signed_at": "2026-08-29T11:00:00.000Z" },
  "server_sig": "…",
  "status": "active",
  "usage": { "approved_uses": 0, "cumulative_cents": 154800 }
}`}
              />
              <List>
                <LI>
                  <C>authorization</C> is the passkey ceremony that made the mandate real. A draft mandate has{" "}
                  <C>null</C> here and status <C>draft</C>, and can never approve a purchase.
                </LI>
                <LI>
                  <C>agent.public_key</C> must equal the key the registry returns for <C>x-agent-id</C>. That binding is
                  what stops one agent from spending another agent&apos;s mandate.
                </LI>
                <LI>
                  <C>usage</C> is live state maintained by AgentPay, not by your store.
                </LI>
                <LI>
                  <C>payment.vault_card_id</C> is an opaque reference. No card data ever reaches a merchant.
                </LI>
              </List>
            </>
          ),
        },
        {
          id: "order",
          title: "Verification order",
          body: (
            <>
              <P>Cheap and local first, network and policy last, so an unsigned flood costs almost nothing:</P>
              <CodeBlock
                lang="text"
                code={`headers present ─▶ timestamp fresh ─▶ agent key ─▶ agent signature ─▶ nonce consumed
        │               │               │              │                │
       401             401             401            401              401
                                                                        │
                          body valid ─▶ product resolved ─▶ mandate signature ─▶ policy
                              │               │                    │              │
                             400             404              refused        approved /
                                                                             escalated /
                                                                              refused`}
              />
              <P>
                The one deliberate exception: the mandate is fetched fresh on every request, even though it is the most
                expensive lookup. Immediate revocation is worth more than a saved round trip.
              </P>
            </>
          ),
        },
        {
          id: "non-js",
          title: "Implementing without the SDK",
          body: (
            <>
              <P>If you cannot run JavaScript at your checkout, reimplement these steps in order:</P>
              <List ordered>
                <LI>Reject the request unless all four headers are present and the timestamp is within 60 seconds.</LI>
                <LI>
                  <C>GET /api/registry/agents/:id</C> and verify the Ed25519 signature over the signing message with the
                  returned SPKI PEM key.
                </LI>
                <LI>
                  <C>POST /api/registry/nonces</C> with agent id, nonce and timestamp. Anything but 201 is a rejection.
                </LI>
                <LI>Validate the body and confirm the merchant id is yours.</LI>
                <LI>Look up the product in your own catalog; take price, currency and category from there.</LI>
                <LI>
                  <C>GET /api/registry/mandates/:id</C> uncached, rebuild the canonical artifact and verify{" "}
                  <C>server_sig</C> with the registry key.
                </LI>
                <LI>
                  Apply the policy rules in the order listed in <A href="/docs/reference/decisions">Decisions and reason
                  codes</A>; the first failing rule is the reason code.
                </LI>
              </List>
              <Callout tone="warn" title="Canonical JSON is exact">
                <p>
                  AgentPay canonicalizes by sorting object keys recursively with <C>localeCompare</C>, then serializing
                  compactly with <C>JSON.stringify</C>; array order is preserved. A serializer that differs by one space
                  makes every mandate signature look invalid.
                </p>
              </Callout>
            </>
          ),
        },
      ]}
    />
  );
}
