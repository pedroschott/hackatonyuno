import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, CodeBlock, DataTable, LI, Lead, List, P } from "@/components/docs/prose";

const HREF = "/docs/reference/decisions";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <Lead>
          Every verified request gets one of three decisions and, when it is not an approval, a reason code. The codes
          are stable strings — safe to log, branch on, and show to a buyer in your own words.
        </Lead>
      }
      sections={[
        {
          id: "decisions",
          title: "The three decisions",
          body: (
            <DataTable
              head={["Decision", "Meaning", "Your store"]}
              rows={[
                [
                  <C key="a">approved</C>,
                  "Signed, live, in scope and within every limit.",
                  "Charge and fulfil. This is the only decision that may move money.",
                ],
                [
                  <C key="e">escalated</C>,
                  "Only the per-purchase limit blocks it, and no approved exception was attached.",
                  "Charge nothing. Return the decision so the agent can ask the buyer for a one-time approval.",
                ],
                [
                  <C key="r">refused</C>,
                  "A rule that a retry cannot fix without the buyer changing something.",
                  "Charge nothing. Surface the reason code.",
                ],
              ]}
            />
          ),
        },
        {
          id: "order",
          title: "Evaluation order",
          body: (
            <>
              <P>
                The first failing rule wins, so the reason code always names the <em>first</em> reason the purchase could
                not proceed. Fixing it may simply reveal the next one.
              </P>
              <CodeBlock
                lang="text"
                code={`mandate exists
  ▸ not revoked
    ▸ active and inside its validity window
      ▸ merchant in scope
        ▸ category in scope
          ▸ currency matches
            ▸ uses remaining
              ▸ cumulative total still under the cap
                ▸ price within the per-purchase limit (or an exception is attached)
                  ▸ approved`}
              />
            </>
          ),
        },
        {
          id: "codes",
          title: "Reason codes",
          body: (
            <DataTable
              head={["Code", "Decision", "What happened", "What resolves it"]}
              rows={[
                [
                  <C key="1">AGENT_SIGNATURE_INVALID</C>,
                  "refused (401)",
                  "Headers missing, timestamp outside 60 seconds, unknown agent, bad signature, or a replayed nonce.",
                  "The agent re-signs a fresh request. Persisting means a body parser or a path rewrite in the way.",
                ],
                [
                  <C key="2">MANDATE_SIGNATURE_INVALID</C>,
                  "refused",
                  "The registry signature does not verify, or the mandate names a different agent or key.",
                  "Nothing on your side. Never approve on it — this is what a forged mandate looks like.",
                ],
                [
                  <C key="3">MANDATE_NOT_FOUND</C>,
                  "refused",
                  "No mandate with that id at the registry.",
                  "The agent creates a mandate and the buyer signs it.",
                ],
                [
                  <C key="4">MANDATE_REVOKED</C>,
                  "refused",
                  "The buyer revoked it. Effective on the next request, with no cache to wait out.",
                  "Only a new mandate. Never retry.",
                ],
                [
                  <C key="5">MANDATE_EXPIRED</C>,
                  "refused",
                  "Outside not_before/expires_at, or the mandate is still a draft awaiting a passkey.",
                  "The buyer authorizes a new mandate.",
                ],
                [
                  <C key="6">MERCHANT_NOT_IN_SCOPE</C>,
                  "refused",
                  "Your merchant id is not in the mandate scope.",
                  "Check your manifest and handler agree on the id; otherwise the buyer must include you.",
                ],
                [
                  <C key="7">CATEGORY_NOT_IN_SCOPE</C>,
                  "refused",
                  "The product category your catalog returned is not in the mandate.",
                  "Usually a category-naming mismatch. Keep categories coarse and stable.",
                ],
                [
                  <C key="8">CURRENCY_MISMATCH</C>,
                  "refused",
                  "Product currency differs from the mandate currency. Nothing is converted.",
                  "Return prices in the buyer's currency, or the buyer authorizes a mandate in yours.",
                ],
                [
                  <C key="9">USES_EXCEEDED</C>,
                  "refused",
                  "approved_uses already reached max_uses.",
                  "A new mandate. The buyer chose how many purchases to allow.",
                ],
                [
                  <C key="10">CUMULATIVE_EXCEEDED</C>,
                  "refused",
                  "This purchase would push the running total past the cumulative cap.",
                  "A cheaper cart, or a new mandate.",
                ],
                [
                  <C key="11">AMOUNT_EXCEEDS_LIMIT</C>,
                  "escalated",
                  "Above per_purchase_cents with no exception attached.",
                  "The agent gets a one-time approval from the buyer and retries with exception_id.",
                ],
              ]}
            />
          ),
        },
        {
          id: "escalation",
          title: "The escalation path",
          body: (
            <>
              <P>
                Escalation is the difference between a wall and a doorway. The mandate stays exactly as narrow as the
                buyer made it, and one purchase above the limit becomes possible only if the buyer says so again.
              </P>
              <List ordered>
                <LI>
                  Your handler returns <C>escalated</C> with <C>AMOUNT_EXCEEDS_LIMIT</C>. You charge nothing.
                </LI>
                <LI>The agent asks AgentPay for a one-time exception on that mandate, for that amount.</LI>
                <LI>The buyer approves it with a passkey — on the dashboard or from the phone inbox.</LI>
                <LI>
                  The agent re-signs the same purchase with <C>exception_id</C> in the body. Your handler now returns{" "}
                  <C>approved</C>.
                </LI>
              </List>
              <Callout tone="warn" title="An exception is one purchase, not a raised limit">
                <p>
                  It does not change <C>per_purchase_cents</C>, and it does not survive to the next request. Everything
                  else — cumulative cap, remaining uses, expiry, revocation — still applies.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "transport",
          title: "Transport-level rejections",
          body: (
            <>
              <P>Three cases never reach the policy engine and return a body without a decision:</P>
              <DataTable
                head={["Status", "Body", "Cause"]}
                rows={[
                  [
                    "401",
                    <C key="a">{`{ decision: "refused", reason_code: "AGENT_SIGNATURE_INVALID", checks }`}</C>,
                    "Signature, freshness or replay failure.",
                  ],
                  [
                    "400",
                    <C key="b">{`{ error: "Invalid checkout payload" }`}</C>,
                    "Body does not parse, fails schema, or names another merchant.",
                  ],
                  [
                    "404",
                    <C key="c">{`{ error: "Product not found" }`}</C>,
                    "resolveProduct returned null, or the product belongs to another merchant.",
                  ],
                ]}
              />
              <P>
                Do not translate these into 500s: an agent reads the status to decide whether retrying makes any sense.
                Debugging help is in <A href="/docs/troubleshooting">Troubleshooting</A>.
              </P>
            </>
          ),
        },
      ]}
    />
  );
}
