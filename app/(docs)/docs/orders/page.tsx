import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, CodeBlock, DataTable, LI, Lead, List, P } from "@/components/docs/prose";

const HREF = "/docs/orders";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <Lead>
          A verified purchase is not the end of the transaction. The order has to reach an address, the charge has to be
          the amount the buyer authorized, and a charge that was inside the mandate and still wrong needs somewhere to
          go. These three surfaces cover all of it, and none of them requires a browser session.
        </Lead>
      }
      sections={[
        {
          id: "address",
          title: "Where the order goes",
          body: (
            <>
              <P>
                Your checkout receives <C>shipping_address</C> on every request. It is the buyer&rsquo;s registered
                address, which AgentPay already holds and the buyer confirmed once, or a one-off address they named for
                this order — <C>shipping_address_source</C> tells you which.
              </P>
              <Callout tone="note" title="The agent never collects an address">
                <p>
                  An agent that asks &ldquo;where should I send it?&rdquo; is asking whoever is in the conversation. In a
                  fleet that is a driver, not the person holding the card, and your store cannot tell the difference.
                  AgentPay resolves the address before it contacts you, so the request always carries one that belongs to
                  the account being charged.
                </p>
              </Callout>
              <CodeBlock
                lang="json"
                code={`{
  "recipient": "Dana Ruiz",
  "line1": "88 Wythe Ave",
  "line2": "Loading dock B",
  "city": "Brooklyn",
  "region": "NY",
  "postal_code": "11249",
  "country_code": "US",
  "phone": "+1 555 0140",
  "instructions": "Ask for the shift lead"
}`}
              />
              <P>
                <C>country_code</C> is uppercased for you, so <C>us</C> and <C>US</C> are the same address. Everything
                except <C>line2</C>, <C>region</C>, <C>phone</C> and <C>instructions</C> is guaranteed present.
              </P>
            </>
          ),
        },
        {
          id: "quote",
          title: "Quoting delivery",
          body: (
            <>
              <P>
                Pass <C>resolveFulfillment</C> to the checkout handler. It runs <em>before</em> the policy, because the
                amount the mandate has to cover is the amount you will charge — and you cannot know that until you know
                the destination.
              </P>
              <CodeBlock
                lang="ts"
                code={`import { createAgentPayCheckoutHandler, deliveryWindow } from "@agentpay/merchant-sdk";

const checkout = createAgentPayCheckoutHandler({
  merchantId: process.env.AGENTPAY_MERCHANT_ID!,
  registryUrl: "https://agentpay-yuno.vercel.app",
  resolveProduct: async (id) => database.products.find(id),

  resolveFulfillment: async ({ product, address, address_source, now }) => {
    // Return null for anywhere you do not serve. The handler refuses with
    // SHIPPING_ADDRESS_UNSUPPORTED before a mandate use is consumed.
    if (address.country_code !== "US") return null;

    const local = address.postal_code.startsWith("112");
    return {
      address_source,
      ships_to: address,
      method: local ? "Same-day courier" : "Ground",
      carrier: local ? "Metro Courier" : "NorthStar Ground",
      ship_from: "Midtown Auto Supply, Fordham NY",
      handling_time: "Ships the next business day",
      estimated_delivery: deliveryWindow({
        from: now,
        minBusinessDays: local ? 0 : 2,
        maxBusinessDays: local ? 0 : 4,
      }),
      shipping_cents: product.price_cents >= 15_000 ? 0 : local ? 1_995 : 1_295,
      currency: "USD",
      notes: address_source === "custom" ? ["Delivering to a one-off address for this order."] : undefined,
    };
  },
});`}
              />
              <P>
                <C>deliveryWindow</C> skips weekends. Two business days from a Friday is Tuesday, not Sunday, and an
                agent that repeats a Sunday date to a buyer has told them something false. Dates are plain{" "}
                <C>YYYY-MM-DD</C> in UTC: a delivery estimate is a day, not an instant, and a timestamp would imply a
                precision no store has.
              </P>
              <Callout tone="warn" title="Charge charge.total_cents">
                <p>
                  The response now carries <C>charge</C> — <C>subtotal_cents</C>, <C>shipping_cents</C>,{" "}
                  <C>total_cents</C>. The total is what the mandate was evaluated against and what an approved one-time
                  exception is bound to. A store that charges the subtotal under-collects; one that adds shipping after
                  the decision charges an amount the buyer never authorized.
                </p>
              </Callout>
              <P>
                Omit <C>resolveFulfillment</C> and nothing changes from 0.2.0: no quote, no <C>fulfillment</C> block, and{" "}
                <C>charge.total_cents</C> equal to the product price. If you do pass it, advertise it in your manifest
                with <C>customShipping: true</C> and <C>shipsTo</C>, so an agent knows it may send a one-off address and
                which countries you accept.
              </P>
            </>
          ),
        },
        {
          id: "transactions",
          title: "Your transaction history over the API",
          body: (
            <>
              <P>
                Every attempt against your merchant, approved or not, authenticated with a merchant API key from the
                console&rsquo;s <strong>Keys</strong> tab. Same data the console shows under <strong>Activity</strong>.
              </P>
              <CodeBlock
                lang="bash"
                code={`curl -H "authorization: Bearer $AGENTPAY_KEY" \\
  "https://agentpay-yuno.vercel.app/api/v1/merchants/$MERCHANT_ID/transactions?decision=approved&limit=50"`}
              />
              <DataTable
                head={["Query parameter", "Meaning"]}
                rows={[
                  [<C key="d">decision</C>, "approved, refused or escalated."],
                  [<C key="s">since</C>, "ISO 8601. Inclusive lower bound on created_at."],
                  [<C key="u">until</C>, "ISO 8601. Inclusive upper bound."],
                  [<C key="p">product_id</C>, "Exact product id."],
                  [<C key="x">disputed</C>, "true for charges with a dispute, false for those without."],
                  [<C key="l">limit</C>, "Default 50, maximum 200."],
                  [
                    <C key="b">before</C>,
                    "Cursor. Pass the created_at of the last row you saw, or next_before from the previous page.",
                  ],
                ]}
              />
              <CodeBlock
                lang="json"
                code={`{
  "merchant_id": "mrc_demo_store",
  "count": 1,
  "limit": 50,
  "next_before": "2026-08-30T09:14:02.118Z",
  "transactions": [
    {
      "id": "6f1b…",
      "created_at": "2026-08-30T09:14:02.118Z",
      "product_id": "bp-001",
      "amount_cents": 6294,
      "shipping_cents": 1295,
      "currency": "USD",
      "decision": "approved",
      "reason_code": null,
      "purchase_reason": "The delivery van's front rotors are scored and it runs tomorrow.",
      "shipping_address_source": "registered",
      "shipping_address": { "recipient": "Dana Ruiz", "city": "Brooklyn", "…": "…" },
      "fulfillment": { "method": "Ground", "estimated_delivery": { "text": "Wed, Sep 2 – Fri, Sep 4" } },
      "buyer_ref": "9c2f…",
      "dispute_id": null,
      "dispute_status": null
    }
  ]
}`}
              />
              <Callout tone="note" title="buyer_ref is a pseudonym, not a customer">
                <p>
                  It is <C>sha256(user_id + &quot;|&quot; + merchant_id)</C>: stable within your merchant, unlinkable
                  across merchants, never an account id. Enough to recognise a repeat customer, not enough to identify a
                  person. You receive the delivery address because you have to ship to it; you do not receive an
                  identity, because you do not need one.
                </p>
              </Callout>
              <P>
                <C>purchase_reason</C> is the field that makes this list reviewable rather than merely auditable. It is
                the buyer&rsquo;s own words for why their agent bought this, recorded at the moment of purchase and
                required on every attempt.
              </P>
            </>
          ),
        },
        {
          id: "disputes",
          title: "Answering a disputed charge",
          body: (
            <>
              <P>
                A buyer can dispute any approved charge from its purchase trail. You answer in the console under{" "}
                <strong>Disputes</strong>, or over the same API key.
              </P>
              <CodeBlock
                lang="bash"
                code={`# The open cases
curl -H "authorization: Bearer $AGENTPAY_KEY" \\
  "https://agentpay-yuno.vercel.app/api/v1/merchants/$MERCHANT_ID/disputes?status=open"

# Everything one case is judged on: the charge, the mandate that allowed it,
# and that buyer's full purchase history at your store.
curl -H "authorization: Bearer $AGENTPAY_KEY" \\
  "https://agentpay-yuno.vercel.app/api/v1/merchants/$MERCHANT_ID/disputes/$DISPUTE_ID"

# Your answer.
curl -X POST -H "authorization: Bearer $AGENTPAY_KEY" \\
  -H "content-type: application/json" \\
  -d '{"status":"resolved_refunded","response":"Carrier confirmed the parcel was never scanned. Refunded in full."}' \\
  "https://agentpay-yuno.vercel.app/api/v1/merchants/$MERCHANT_ID/disputes/$DISPUTE_ID"`}
              />
              <DataTable
                head={["Status", "Meaning"]}
                rows={[
                  [<C key="o">open</C>, "The buyer raised it. You have not answered."],
                  [<C key="u">under_review</C>, "You are looking into it."],
                  [<C key="e">evidence_requested</C>, "You need something from the buyer before you can decide."],
                  [<C key="rf">resolved_refunded</C>, "Closed in the buyer's favour."],
                  [<C key="ru">resolved_upheld</C>, "Closed in yours."],
                  [<C key="w">withdrawn</C>, "The buyer withdrew it. Only they can."],
                ]}
              />
              <P>
                Every state change is an event on a timeline both sides read. A dispute you have resolved cannot be
                reopened, and a buyer cannot mark their own case refunded — the two sides go through different
                functions with different powers over the same row.
              </P>
            </>
          ),
        },
        {
          id: "analyze",
          title: "Reading a dispute against the buyer's history",
          body: (
            <>
              <P>
                One call reads the disputed charge against everything else that buyer has bought from you — including the
                reason they gave their agent each time — and says what most likely happened.
              </P>
              <CodeBlock
                lang="bash"
                code={`curl -X POST -H "authorization: Bearer $AGENTPAY_KEY" \\
  "https://agentpay-yuno.vercel.app/api/v1/merchants/$MERCHANT_ID/disputes/$DISPUTE_ID/analyze"`}
              />
              <CodeBlock
                lang="json"
                code={`{
  "analysis": {
    "likely_cause": "not_received",
    "confidence": "medium",
    "summary": "Third order from this account in six weeks, all to the registered address. The quoted window closed four days ago and nothing suggests a delivery attempt.",
    "evidence": [
      "Purchase reason at the time: \\"Van is off the road until the rotors arrive.\\"",
      "Ground delivery quoted Wed, Sep 2 – Fri, Sep 4; today is Sep 8.",
      "2 prior approved purchases at this merchant, 0 prior disputes."
    ],
    "recommendation": "refund",
    "recommendation_rationale": "Your own quoted window has passed with no delivery reported.",
    "signals": { "purchases_at_merchant": 3, "prior_disputes": 0, "delivery_window_passed": true },
    "engine": "claude",
    "model": "claude-opus-5"
  }
}`}
              />
              <Callout tone="warn" title="Advisory, and structurally unable to decide">
                <p>
                  The analysis writes only to <C>analysis</C>. A dispute&rsquo;s <C>status</C> is set by a person through
                  a different function, so a model that mis-reads a case cannot close it. Treat{" "}
                  <C>recommendation</C> as a starting point, and check <C>evidence</C> against the history it cites — the
                  same history is in the response above it.
                </p>
              </Callout>
              <List>
                <LI>
                  <C>likely_cause</C> may differ from the reason the buyer selected. That difference is often the useful
                  part.
                </LI>
                <LI>
                  <C>engine</C> is <C>claude</C> when the model produced it and <C>rules</C> when a deterministic reading
                  ran instead — because no API key was configured, or the call failed. The answer always arrives and
                  always says which one it is.
                </LI>
                <LI>
                  A charge inside a live mandate, matching the buyer&rsquo;s own recorded reason, reads as regret rather
                  than an unauthorized charge, and the analysis says so plainly rather than hedging.
                </LI>
              </List>
              <P>
                The same button is in the merchant console beside each dispute. See{" "}
                <A href="/docs/reference/decisions">Decisions and reason codes</A> for what happens before a charge, and{" "}
                <A href="/docs/stores">Merchant console and stores</A> for where to create the API key.
              </P>
            </>
          ),
        },
      ]}
    />
  );
}
