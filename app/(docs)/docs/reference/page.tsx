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
            Everything <C>@agentpay/merchant-sdk</C> exports. Six functions carry the integration; the rest exist so you
            can build fixtures and type your own code.
          </Lead>
          <CodeBlock
            lang="ts"
            code={`import {
  // integration
  merchantManifest,
  createAgentPayCatalogHandler,
  createAgentPayCheckoutHandler,
  discoverAgentPayMerchant,
  discoverAgentPayCatalog,
  signAgentPayRequest,
  // catalog and policy helpers
  filterCatalogProducts,
  parseCatalogQuery,
  evaluatePolicy,
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
  type AgentPayCatalogProduct,
  type AgentPayMerchantCatalog,
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
                  {
                    name: "catalogPath",
                    type: "string",
                    description: "Advertised as catalog_endpoint. Adds the catalog-search capability.",
                  },
                  { name: "categories", type: "string[]", description: "Exact category slugs a mandate may name here. Lowercased and sorted." },
                  { name: "currency", type: "string", description: "Uppercased. Every product must be quoted in it." },
                  {
                    name: "productUrlTemplate",
                    type: "string",
                    description: "Contains {id}, resolved against the origin.",
                  },
                  {
                    name: "customShipping",
                    type: "boolean",
                    description: "0.3.0. You read shipping_address and quote delivery back. Adds the custom-shipping capability.",
                  },
                  {
                    name: "shipsTo",
                    type: "string[]",
                    description: "0.3.0. ISO 3166-1 alpha-2 codes you deliver to. Uppercased and sorted.",
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
                  {
                    name: "resolveFulfillment",
                    type: "(req: FulfillmentRequest) => Promise<Fulfillment | null> | Fulfillment | null",
                    description:
                      "0.3.0, optional. Quote delivery for the address on the request. Return null for an address you do not serve: the handler refuses with SHIPPING_ADDRESS_UNSUPPORTED before a mandate use is spent. Omit it and the store keeps 0.2.0 behaviour.",
                  },
                  { name: "fetcher", type: "typeof fetch", description: "Override the fetch used for registry calls." },
                  { name: "now", type: "() => Date", description: "Override the clock for deterministic tests." },
                ]}
              />
              <P>
                With <C>resolveFulfillment</C> set, the mandate is evaluated against <C>charge.total_cents</C> — the
                product plus the delivery you just quoted — so a buyer&rsquo;s per-purchase limit covers what is actually
                charged. Charge that number, not <C>product.price_cents</C>.
              </P>
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
          id: "catalog-handler",
          title: "createAgentPayCatalogHandler(config)",
          body: (
            <>
              <P>
                Returns <C>(request: Request) =&gt; Promise&lt;Response&gt;</C> for the route your manifest advertises
                as <C>catalog_endpoint</C>. Parses <C>q</C>, <C>category</C>, <C>product_id</C>,{" "}
                <C>max_price_cents</C> and <C>limit</C> from the URL, filters with <C>filterCatalogProducts</C>, and
                answers in the <C>AgentPayMerchantCatalog</C> shape with permissive CORS.
              </P>
              <PropTable
                rows={[
                  { name: "merchantId", type: "string", required: true, description: "Echoed in the response; agents refuse a catalog whose merchant differs from the manifest." },
                  { name: "merchantName", type: "string", required: true, description: "Store name shown to the buyer." },
                  { name: "currency", type: "string", required: true, description: "Applied to any product that omits its own currency, and reported at the top level." },
                  { name: "products", type: "() => AgentPayCatalogProduct[] | Promise<AgentPayCatalogProduct[]>", required: true, description: "Your catalog. Called per request; return the same category and price_cents that resolveProduct returns at checkout." },
                  { name: "categories", type: "string[]", description: "Category vocabulary to report. Defaults to the distinct categories of the products returned." },
                  { name: "maxAgeSeconds", type: "number", description: "Cache-control max-age. Defaults to 60." },
                ]}
              />
              <P>
                Semantics are documented in <A href="/docs/discovery#catalog">Publish the catalog</A>.{" "}
                <C>parseCatalogQuery(url)</C> and <C>filterCatalogProducts(products, query)</C> are exported separately
                so the route can be unit-tested without HTTP.
              </P>
            </>
          ),
        },
        {
          id: "discover-catalog",
          title: "discoverAgentPayCatalog(source, search?, fetcher?)",
          body: (
            <>
              <P>
                What <C>find_products</C> calls. Accepts a store URL or an already-fetched manifest, sends one request to{" "}
                <C>catalog_endpoint</C> with the search translated to query parameters, and returns a validated{" "}
                <C>AgentPayMerchantCatalog</C>. Throws when the manifest advertises no catalog or the catalog names a
                different merchant.
              </P>
              <CodeBlock
                lang="ts"
                code={`const catalog = await discoverAgentPayCatalog("https://my-store.example/product/bp-001", {
  q: "brake rotor",
  category: "brakes",
  maxPriceCents: 60000,
  limit: 5,
});
// -> { protocol: "agentpay-catalog/1.0", merchant, currency, categories, query, total, products: [{ product_id, category, price_cents, ... }] }`}
              />
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
  charge?: CheckoutCharge;      // added in 0.3.0
  fulfillment?: Fulfillment;    // present when resolveFulfillment quoted one
  checks: {
    agent_signature: boolean;
    mandate_signature: boolean;
    registry_status: boolean;
    policy: boolean;
  };
};

// What the buyer is charged, and what the mandate is checked against.
type CheckoutCharge = {
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  currency: string;
};

type ShippingAddress = {
  recipient: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postal_code: string;
  country_code: string;   // ISO 3166-1 alpha-2, uppercased by the handler
  phone?: string;
  instructions?: string;
};

type FulfillmentRequest = {
  product: MerchantProduct;
  address: ShippingAddress;
  address_source: "registered" | "custom";
  now: Date;
};

type Fulfillment = {
  address_source: "registered" | "custom";
  ships_to: ShippingAddress;
  method: string;              // your own service name, e.g. "Same-day courier"
  carrier?: string;
  ship_from?: string;
  handling_time: string;       // "Ships the next business day"
  estimated_delivery: {
    earliest: string;          // ISO date, YYYY-MM-DD
    latest: string;
    text: string;              // human sentence the agent repeats verbatim
  };
  shipping_cents: number;
  currency: string;
  notes?: string[];
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
  capabilities: string[]; // "intent-mandates" | "live-revocation" | "mock-payment"
                          //   | "catalog-search" | "custom-shipping"
  catalog_endpoint?: string;     // added in 0.2.0; every new field is optional
  categories?: string[];
  currency?: string;
  product_url_template?: string;
  documentation_url?: string;
  ships_to?: string[];           // added in 0.3.0
};

type AgentPayCatalogProduct = {
  product_id: string;
  name: string;
  category: string;
  price_cents: number;
  currency: string;
  description?: string;
  sku?: string;
  brand?: string;
  availability?: "in_stock" | "out_of_stock";
  url?: string;
};

type AgentPayMerchantCatalog = {
  protocol: "agentpay-catalog/1.0";
  merchant: { id: string; name: string };
  currency: string;
  categories: string[];
  query: { q: string | null; category: string | null; product_id: string | null; max_price_cents: number | null; limit: number };
  total: number;
  products: AgentPayCatalogProduct[];
};`}
              />
              <P>
                <C>RegistryMandate</C>, <C>MandateStatus</C>, <C>CheckoutCart</C> and <C>PolicyReason</C> are exported
                too — see <A href="/docs/reference/protocol">Protocol and registry</A> for the mandate shape.
              </P>
              <P>
                <C>deliveryWindow({"{ from, minBusinessDays, maxBusinessDays }"})</C> builds an{" "}
                <C>estimated_delivery</C> that skips weekends, because two days from a Friday is not Sunday and an agent
                that repeats a Sunday date has told the buyer something false. <C>shippingAddressSchema</C> is exported
                so you can validate an address you received from somewhere else with exactly the rules the handler
                applies.
              </P>
            </>
          ),
        },
      ]}
    />
  );
}
