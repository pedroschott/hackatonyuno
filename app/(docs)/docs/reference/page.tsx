import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, CodeBlock, DataTable, Lead, P, PropTable } from "@/components/docs/prose";

const HREF = "/docs/reference";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <>
          <Lead>
            Everything <C>@agentpay/merchant-sdk</C> exports. Four functions carry the integration; the rest exist so you
            can build fixtures and type your own code.
          </Lead>
          <CodeBlock
            lang="ts"
            code={`import {
  // integration
  merchantManifest,
  createAgentPayCheckoutHandler,
  discoverAgentPayMerchant,
  signAgentPayRequest,
  // fixtures and tests
  generateEd25519KeyPair,
  signText,
  signCanonical,
  verifyText,
  canonicalJson,
  agentSigningMessage,
  // types
  type MerchantProduct,
  type MerchantCheckoutResult,
  type RegistryMandate,
  type PolicyDecision,
  type PolicyReason,
  type AgentPayMerchantManifest,
} from "@agentpay/merchant-sdk";`}
          />
        </>
      }
      sections={[
        {
          id: "merchant-manifest",
          title: "merchantManifest(input)",
          body: (
            <>
              <P>
                Builds the discovery document for <C>/.well-known/agentpay.json</C>. Pure and synchronous. Returns{" "}
                <C>AgentPayMerchantManifest</C>.
              </P>
              <PropTable
                rows={[
                  { name: "origin", type: "string", required: true, description: "Any URL on your store; only the origin is kept." },
                  { name: "merchantId", type: "string", required: true, description: "Your stable merchant slug." },
                  { name: "merchantName", type: "string", required: true, description: "Store name shown to the buyer in the mandate." },
                  {
                    name: "checkoutPath",
                    type: "string",
                    description: (
                      <>
                        Defaults to <C>/api/store/checkout</C>.
                      </>
                    ),
                  },
                  {
                    name: "registryUrl",
                    type: "string",
                    description: "Defaults to your own origin. Merchants should always pass the AgentPay deployment URL.",
                  },
                ]}
              />
              <P>
                Throws <C>TypeError</C> if <C>origin</C> or <C>registryUrl</C> is not a valid absolute URL — which is the
                behaviour you want at boot rather than at request time. Full guide:{" "}
                <A href="/docs/discovery">Publish discovery</A>.
              </P>
            </>
          ),
        },
        {
          id: "create-handler",
          title: "createAgentPayCheckoutHandler(config)",
          body: (
            <>
              <P>
                Returns <C>(request: Request) =&gt; Promise&lt;Response&gt;</C>. Create it once at module scope; it keeps
                no state between requests.
              </P>
              <PropTable
                rows={[
                  { name: "merchantId", type: "string", required: true, description: "Enforced against the request body and the resolved product." },
                  { name: "registryUrl", type: "string", required: true, description: "Base URL for the four registry lookups." },
                  {
                    name: "resolveProduct",
                    type: "(productId: string) => Promise<MerchantProduct | null>",
                    required: true,
                    description: "Your catalog lookup. null means 404 and no mandate is consulted.",
                  },
                  { name: "fetcher", type: "typeof fetch", description: "Override the fetch used for registry calls." },
                  { name: "now", type: "() => Date", description: "Override the clock for deterministic tests." },
                ]}
              />
              <P>
                Behaviour, response shape and status codes are documented in <A href="/docs/checkout">Protect checkout</A>
                .
              </P>
            </>
          ),
        },
        {
          id: "discover",
          title: "discoverAgentPayMerchant(merchantUrl, fetcher?)",
          body: (
            <>
              <P>
                Fetches and validates a store manifest. Accepts any URL on the store — it resolves{" "}
                <C>/.well-known/agentpay.json</C> from the origin unless the URL already points at the manifest.
                Returns a validated <C>AgentPayMerchantManifest</C>.
              </P>
              <CodeBlock
                lang="ts"
                code={`const manifest = await discoverAgentPayMerchant("https://my-store.example/products/tires");
// -> { protocol: "agentpay/1.0", merchant: { id, name }, checkout_endpoint, registry_url, capabilities }`}
              />
              <P>
                Throws if the document is missing (<C>Merchant does not publish AgentPay discovery metadata</C>) or fails
                schema validation. Agents use it; merchants use it as a self-check.
              </P>
            </>
          ),
        },
        {
          id: "sign",
          title: "signAgentPayRequest(input)",
          body: (
            <>
              <P>
                Produces the four signature headers plus <C>content-type</C> for a checkout request. Agents use it in
                production; merchants use it in tests.
              </P>
              <PropTable
                rows={[
                  { name: "agentId", type: "string", required: true, description: "Registered agent id, sent as x-agent-id." },
                  { name: "privateKey", type: "string", required: true, description: "PEM PKCS#8 Ed25519 private key." },
                  { name: "method", type: "string", required: true, description: "HTTP method, uppercased into the signed message." },
                  { name: "url", type: "string", required: true, description: "Full request URL; only the pathname is signed." },
                  { name: "body", type: "string", required: true, description: "The exact serialized body that will be sent." },
                  { name: "now", type: "Date", description: "Defaults to the current time." },
                  { name: "nonce", type: "string", description: "Defaults to crypto.randomUUID(). Single-use." },
                ]}
              />
              <Callout tone="warn" title="Sign the bytes you send">
                <p>
                  Serialize the body once into a string, sign that string, and send that same string. Re-serializing
                  between signing and sending changes the hash.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "helpers",
          title: "Fixture and crypto helpers",
          body: (
            <>
              <DataTable
                head={["Export", "Signature", "Use"]}
                rows={[
                  [
                    <C key="g">generateEd25519KeyPair()</C>,
                    <C key="gs">{`{ privateKey: string; publicKey: string }`}</C>,
                    "PEM key pair for test agents and test registries.",
                  ],
                  [<C key="s">signText(privateKeyPem, value)</C>, <C key="ss">string</C>, "Ed25519 signature, base64url."],
                  [
                    <C key="sc">signCanonical(privateKeyPem, value)</C>,
                    <C key="scs">string</C>,
                    "Signs canonicalJson(value) — how mandate signatures are produced.",
                  ],
                  [
                    <C key="v">verifyText(publicKeyPem, value, signature)</C>,
                    <C key="vs">boolean</C>,
                    "Never throws; returns false on malformed input.",
                  ],
                  [
                    <C key="c">canonicalJson(value)</C>,
                    <C key="cs">string</C>,
                    "Deterministic JSON with recursively sorted keys.",
                  ],
                  [
                    <C key="a">agentSigningMessage(parts)</C>,
                    <C key="as">string</C>,
                    "METHOD|path|sha256(body)|timestamp|nonce — the exact string that gets signed.",
                  ],
                ]}
              />
              <P>
                A complete offline test built from these is in <A href="/docs/testing">Test the integration</A>.
              </P>
            </>
          ),
        },
        {
          id: "types",
          title: "Types",
          body: (
            <>
              <CodeBlock
                lang="ts"
                code={`type MerchantProduct = {
  id: string;
  merchant_id: string;
  name: string;
  category: string;
  price_cents: number;
  currency: "USD";
};

type MerchantCheckoutResult = PolicyDecision & {
  product?: MerchantProduct;
  checks: {
    agent_signature: boolean;
    mandate_signature: boolean;
    registry_status: boolean;
    policy: boolean;
  };
};

type PolicyDecision =
  | { decision: "approved"; reason_code: null }
  | { decision: "refused"; reason_code: PolicyReason }
  | { decision: "escalated"; reason_code: "AMOUNT_EXCEEDS_LIMIT" };

type AgentPayMerchantManifest = {
  protocol: "agentpay/1.0";
  merchant: { id: string; name: string };
  checkout_endpoint: string;
  registry_url: string;
  capabilities: ["intent-mandates", "live-revocation", "mock-payment"];
};`}
              />
              <P>
                <C>RegistryMandate</C>, <C>MandateStatus</C>, <C>CheckoutCart</C> and <C>PolicyReason</C> are exported
                too — see <A href="/docs/reference/protocol">Protocol and registry</A> for the mandate shape.
              </P>
            </>
          ),
        },
      ]}
    />
  );
}
