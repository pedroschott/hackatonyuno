import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, CodeBlock, DataTable, LI, Lead, List, P, Step, Steps } from "@/components/docs/prose";

const HREF = "/docs/agents";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <>
          <Lead>
            An agent that connects to <C>/mcp</C> gets nine tools and one working order. This page is that order, the
            exact shape of what each tool returns, and what to do with every decision — so nothing has to be guessed
            from a product page and nothing is ever fixed by revoking.
          </Lead>
          <Callout tone="note" title="The two rules that prevent almost every failure">
            <p>
              Merchant ids, category slugs, product ids and prices come from <C>find_products</C>, never from a page,
              a name, a SKU or a URL. And a refusal is a message, not a retry signal: it names the rule, the remedy and
              the next tool.
            </p>
          </Callout>
        </>
      }
      sections={[
        {
          id: "order",
          title: "The working order",
          body: (
            <Steps>
              <Step n={1} title="get_account">
                <P>
                  Identity-verification state, saved cards, every mandate with its status and a one-line summary, and a
                  single <C>next_step</C>. If <C>identity_verification.verified</C> is false, send the user to{" "}
                  <C>verification_url</C> and wait. If <C>cards</C> is empty, call <C>get_payment_setup_link</C> and
                  wait; never ask for card details in chat.
                </P>
              </Step>
              <Step n={2} title="find_products">
                <P>
                  Pass any URL on the store — a product page, the storefront or its manifest. AgentPay reads{" "}
                  <C>/.well-known/agentpay.json</C> and the catalog endpoint it advertises, and returns exact values plus
                  a <C>mandate_hint</C> you can pass straight to the next call.
                </P>
                <CodeBlock
                  lang="json"
                  code={`{
  "merchant": { "id": "mrc_autoparts", "name": "AutoParts", "store_url": "https://agentpay-yuno.vercel.app/store" },
  "catalog_available": true,
  "currency": "USD",
  "categories": ["accessories", "tires"],
  "total": 2,
  "products": [
    { "product_id": "prd_tire_std", "name": "Standard tire set", "category": "tires", "price_cents": 154800, "currency": "USD",
      "url": "https://agentpay-yuno.vercel.app/store/products/prd_tire_std" }
  ],
  "mandate_hint": { "merchant_urls": ["https://agentpay-yuno.vercel.app/store"], "merchant_ids": ["mrc_autoparts"],
                    "categories": ["tires"], "currency": "USD", "per_purchase_cents": 154800 }
}`}
                />
              </Step>
              <Step n={3} title="create_mandate">
                <P>
                  Pass <C>merchant_urls</C> (preferred) or <C>merchant_ids</C>, the exact <C>categories</C>, and{" "}
                  <C>per_purchase_cents</C> at or above the price. Everything else has a sensible default: one use,
                  seven days, the account&apos;s default card, <C>cumulative_cents = per_purchase_cents × max_uses</C>.
                  A category the store does not sell fails here, with the valid list, before the user is asked to sign.
                </P>
                <CodeBlock
                  lang="json"
                  code={`{
  "merchant_urls": ["https://agentpay-yuno.vercel.app/store"],
  "categories": ["tires"],
  "per_purchase_cents": 160000,
  "max_uses": 1,
  "expires_in_days": 7,
  "natural_language_description": "Buy one standard tire set from AutoParts, up to $1,600"
}`}
                />
                <P>
                  The result is a draft with an <C>authorization_url</C>. Send it to the user and wait.
                </P>
              </Step>
              <Step n={4} title="get_mandate">
                <P>
                  Poll until <C>status</C> is <C>active</C>. A draft is a state, not an error — keep the link in front
                  of the user and never create a second mandate for the same request. The response also carries{" "}
                  <C>remaining.uses</C> and <C>remaining.cumulative_cents</C>.
                </P>
              </Step>
              <Step n={5} title="check_purchase">
                <P>
                  A dry run with the same policy engine as checkout, against the live mandate, without contacting the
                  merchant and without recording an attempt. Returns <C>would_be</C>, the reason, and the remedy. If it
                  says approved, call <C>purchase</C> with <C>purchase_args</C> verbatim.
                </P>
              </Step>
              <Step n={6} title="purchase" last>
                <P>
                  Signed merchant checkout plus the final atomic registry decision. Read the decision below. The payment
                  rail is mocked: an approval mints a single-use token and no real money moves.
                </P>
              </Step>
            </Steps>
          ),
        },
        {
          id: "decisions",
          title: "Acting on a decision",
          body: (
            <>
              <P>
                <C>check_purchase</C> and <C>purchase</C> both return <C>explanation</C>, <C>remedy</C>,{" "}
                <C>next_tool</C> and <C>retry_same_purchase</C> alongside the reason code.
              </P>
              <DataTable
                head={["Decision / reason", "What it means", "What the agent does"]}
                rows={[
                  [<C key="a">approved</C>, "Inside scope and limits; merchant verified the signature.", "Report the order. Done."],
                  [
                    <C key="e">escalated · AMOUNT_EXCEEDS_LIMIT</C>,
                    "Price is above per_purchase_cents. Nothing charged; held for a one-time approval.",
                    <>
                      Send the user <C>approval_url</C>. After they approve, call <C>purchase</C> with{" "}
                      <C>retry_with</C> (same args plus <C>exception_id</C>). Do not amend or revoke.
                    </>,
                  ],
                  [
                    <C key="m">refused · MERCHANT_NOT_IN_SCOPE</C>,
                    "The mandate names other merchants.",
                    <>
                      <C>amend_mandate</C> with <C>add_merchant_urls</C>. The user signs the replacement once; the old
                      mandate is retired at that moment.
                    </>,
                  ],
                  [
                    <C key="c">refused · CATEGORY_NOT_IN_SCOPE</C>,
                    "The product's category is not in the mandate.",
                    <>
                      <C>amend_mandate</C> with <C>add_categories</C>.
                    </>,
                  ],
                  [
                    <C key="cu">refused · CUMULATIVE_EXCEEDED / USES_EXCEEDED</C>,
                    "The monthly total or the number of purchases is used up.",
                    <>
                      A cheaper product via <C>find_products</C> with <C>max_price_cents</C>, or{" "}
                      <C>amend_mandate</C> with higher limits.
                    </>,
                  ],
                  [
                    <C key="d">refused · MANDATE_DRAFT</C>,
                    "The user has not signed yet.",
                    <>
                      Keep the <C>authorization_url</C> in front of the user; poll <C>get_mandate</C>.
                    </>,
                  ],
                  [<C key="r">refused · MANDATE_REVOKED</C>, "The user revoked it.", "Stop. No retry, no replacement unless the user asks."],
                  [
                    <C key="p">refused · PRODUCT_NOT_FOUND</C>,
                    "The merchant has no product with that exact id.",
                    <>
                      <C>find_products</C> again and use <C>products[].product_id</C> verbatim.
                    </>,
                  ],
                  [
                    <C key="i">refused · IDENTITY_VERIFICATION_REQUIRED</C>,
                    "The account has no current passing identity decision.",
                    <>
                      <C>get_account</C>; send the user to <C>verification_url</C> and wait.
                    </>,
                  ],
                ]}
              />
              <Callout tone="warn" title="Never fix scope by revoking">
                <p>
                  <C>revoke_mandate</C> is for the user saying stop. It is final, and it leaves the agent with nothing.{" "}
                  <C>amend_mandate</C> edits an unsigned draft in place, or proposes a replacement for a signed mandate
                  that the user approves once — and the old mandate stays exactly as it was until that signature.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "no-catalog",
          title: "Stores without a catalog endpoint",
          body: (
            <>
              <P>
                Every catalog field in the manifest is optional. When <C>find_products</C> reports{" "}
                <C>catalog_available: false</C>, the store still accepts AgentPay; it just cannot be searched. The
                product id then comes from the product page itself:
              </P>
              <List>
                <LI>
                  <C>{'<meta name="agentpay:product_id" content="prd_…">'}</C> in the page head, with{" "}
                  <C>agentpay:merchant_id</C>, <C>agentpay:category</C>, <C>agentpay:price_cents</C> and{" "}
                  <C>agentpay:currency</C> beside it.
                </LI>
                <LI>
                  JSON-LD <C>Product.productID</C>, with the same values under <C>additionalProperty</C>.
                </LI>
              </List>
              <P>
                <C>check_purchase</C> cannot simulate a purchase without a catalog price, so it says so and points at{" "}
                <C>purchase</C>; a refusal there records an attempt but charges nothing.
              </P>
            </>
          ),
        },
        {
          id: "results",
          title: "How results are delivered",
          body: (
            <>
              <P>
                Every tool returns its data twice: as <C>structuredContent</C> for clients that render it, and as a
                JSON text block in <C>content</C> for models that only read text. A client that hides structured
                content from the model was the reason agents lost the mandate id they had just been given.
              </P>
              <P>
                The server&apos;s <C>instructions</C> repeat the working order, and <A href="/llms.txt">/llms.txt</A>{" "}
                carries the same rules for agents that arrive by crawling.
              </P>
            </>
          ),
        },
      ]}
    />
  );
}
