# Trial by Fire readiness report

**Scope:** the public AgentPay demo, the remote MCP connection, the deployed
PartsRoute merchant integration, and their Supabase-backed authorization path.

**Baseline reviewed:** `main` at `614c303` (2026-08-30).

This is a readiness report, not a claim that every scenario below has already
been executed against production. A judge should be able to change state in the
product and see the result without a team member editing the database, changing
an environment variable, or explaining away a timeout.

## Executive result

The core circuit is now substantially stronger than a UI-only demo: it has an
OAuth-protected MCP server, passkey-signed mandates, independent merchant
discovery and checkout, an atomic settlement/revocation boundary, a hosted
identity gate, merchant transaction records, a hash-chained audit trail, and a
dispute flow. The current `main` also has a deliberate pre-settlement pause for
the live revocation demonstration.

The largest remaining risk is **operational proof**, not the absence of a
design. The 15 attack fixtures describe the right results, but no runner turns
them into a repeatable deployed test. The team should therefore finish the
P0 items below before adding another integration or merchant.

## Non-negotiable demo rule

Every scenario must leave one visible record:

| Party | What must be visible after the action |
| --- | --- |
| Buyer | The mandate state, attempt decision, reason code, charged total, delivery and purchase trail. |
| Merchant | The same transaction decision, a stable buyer pseudonym, the delivery quote and any dispute. |
| Auditor / judge | The mandate, agent and merchant checks, policy outcome, timestamps, and hash-chained audit entries. |

Never call a declined, refused, timed-out or identity-pending payment a
purchase. It is an *attempt*, and it must say why it did not settle.

## P0 — required before a live judging session

1. **Make the attack suite executable.** `tests/attack-suite/` has the right
   declarative scenarios, but its README explicitly describes the runner as a
   future requirement. Add a deterministic runner that provisions isolated test
   identities, a merchant fixture, a clock, valid keys and a mock payment
   adapter; executes all 15 JSON files; and asserts both outcomes and
   invariants. It must include a real barrier for fixture 09, not two sequential
   calls labelled "concurrent". Run it in CI and publish one command, for
   example `npm run test:attack-suite`.

2. **Rehearse the deployed golden path, not only unit tests.** On the public
   domains, complete a fresh buyer flow: account -> OAuth consent -> Didit
   approval -> passkey -> mock payment method -> mandate -> PartsRoute catalog
   discovery -> approved purchase. Save the resulting purchase-trail URL and
   merchant transaction record for the presenters. The existing MCP smoke test
   stops before a real mandate and checkout, so it is insufficient by itself.

3. **Rehearse revocation in two browsers.** Start checkout with
   `source: "trial"` and a bounded `revocation_window_ms`, revoke from the
   buyer dashboard in the second browser/phone, then show
   `MANDATE_REVOKED`, no payment token, and unchanged mandate usage. Repeat it
   once after a successful purchase, because the judge is likely to do exactly
   that.

4. **Have a no-manual-intervention reset.** A named demo account cannot be
   reused indefinitely: its mandate may be revoked, its usage may be exhausted,
   a KYC session may be pending, and a card may be absent. Provide a protected
   presenter-only reset/provision flow, or a documented script that creates a
   new account and all legal demo prerequisites without direct SQL. Do not
   restore a production database or seed fake data into a judge's account.

5. **Verify deployment configuration as a release gate.** Before the demo,
   check all of the following from a clean browser and a remote machine:

   - AgentPay, PartsRoute, MCP protected-resource metadata, manifest and
     catalog return HTTPS `200`.
   - PartsRoute's manifest origin, merchant ID, catalog endpoint and checkout
     endpoint match the deployed application exactly.
   - The merchant is verified/active in AgentPay's developer platform and its
     API key can read its transaction endpoint.
   - Didit's webhook destination points to the deployed URL; the secret is set;
     an Approved event is accepted once and a duplicate is harmless.
   - `AGENTPAY_RP_ID` and `AGENTPAY_RP_ORIGIN` match the canonical hostname, so
     the passkey prompt appears outside embedded browsers.

6. **Close release checks.** Run `npm run check`, the attack-suite runner once
   it exists, and the deployed MCP/end-to-end rehearsal against the exact Git
   SHA Vercel serves. Record the commit, URLs, timestamp and presenter in a
   one-page run sheet. A green local build does not prove the production
   configuration.

## Judge scenario matrix

The first six are the live sequence to practise. The rest are the questions a
technical judge can reasonably ask for after the demo.

| Priority | Judge action | Expected result | Evidence to show | Status at this baseline |
| --- | --- | --- | --- | --- |
| Live | Buy an in-scope PartsRoute product below the mandate limit. | `approved`; exactly one mock payment token and one usage increment. | Buyer purchase trail and merchant transaction. | Implemented; needs deployed rehearsal. |
| Live | Attempt a price above `per_purchase_cents`. | `escalated`, `AMOUNT_EXCEEDS_LIMIT`; nothing is charged until the user approves the quote-bound exception. | Attempt and no token/usage change. | Policy/fixture coverage exists; rehearse live. |
| Live | Revoke the mandate, then repeat the purchase. | `refused`, `MANDATE_REVOKED`; no token, order or usage increment. | Dashboard and merchant response. | Implemented; rehearse live. |
| Live | Revoke while checkout waits before settlement. | Final atomic evaluation refuses; an in-flight purchase cannot win after revocation commits. | Trial result, audit timestamps and unchanged usage. | Route exists; needs deployed rehearsal. |
| Live | Open a dispute after an approved purchase. | Buyer sees the trail; merchant sees the case and can answer; only a human resolves it. | Buyer and merchant views side by side. | Implemented; rehearse once. |
| Live | Ask the connected assistant to stop. | It calls revocation; the certificate/mandate is immediately unusable. | MCP result plus dashboard state. | Implemented; needs client-specific rehearsal. |
| P0 | Submit the same request twice and then replay an old authorization with a new idempotency key. | Legitimate identical retry is idempotent; an old capability/nonce is refused. | One settled attempt only, nonce/audit evidence. | Fixtures exist; no executable runner. |
| P0 | Fire two purchases worth $400 and $300 against $500 remaining authority at the same time. | At most one settles; captured authority never exceeds $500. | Both responses and final usage. | Atomic design + fixture exist; must be executed under a barrier. |
| P0 | Use another agent's key, a different agent ID, or a mandate for a different agent. | Authentication or agent-binding refusal; no merchant order. | Reason code and merchant log. | Fixtures exist; needs runner. |
| P0 | Change the merchant, category, currency, product ID, quote price or shipping cost after mandate approval. | Refuse fixed scope/currency mismatches; re-evaluate the exact total including shipping; require a signed amendment/exception where policy allows. | Request, decision, final total and trail. | Most policy paths exist; add an explicit deployed quote/price-drift test. |
| P0 | Send malformed JSON, a stale timestamp, invalid signature, unknown manifest field or duplicate nonce. | Safe 4xx refusal; no stack trace, token, order or internal detail. | HTTP response and no new settled attempt. | Fixture/documentation coverage exists; needs runner and rate-limit check. |
| P1 | Remove the delivery address or use an unsupported address. | Refuse before authority is spent with `SHIPPING_ADDRESS_UNSUPPORTED` or missing-address response. | No usage/token; user-facing remedy. | Implemented; rehearse. |
| P1 | Merchant catalog/checkout returns 5xx, invalid JSON, mismatched merchant ID, stale quote or timeout. | Fail closed; no authority spend; clear retry-safe error and reconciliation record. | Attempt and merchant/server logs. | Needs explicit fault-injection test and timeout policy. |
| P1 | Identity is pending, declined, expired, flagged or webhook delivery is forged/replayed. | No mandate authorization/checkout; verified signed event changes state once only. | Account status and webhook handling result. | Unit coverage is partial; needs deployed test/replay drill. |
| P1 | OAuth token is absent, expired, revoked or belongs to another buyer. | MCP cannot list, create, read, revoke or buy across accounts. | 401/403 and RLS isolation evidence. | Design exists; add API-level regression tests. |
| P1 | The merchant API key leaks into a browser, wrong merchant calls a transaction endpoint, or a user guesses another user's ID. | No secret is bundled; key scopes to its merchant; RLS/ownership denies cross-account reads. | Build/env scan and negative API tests. | Must be audited per release. |
| P2 | Resolve a dispute while the optional LLM is unavailable or produces a bad recommendation. | Deterministic labelled fallback may advise; it must never change dispute status or refund state. | `engine: rules` and human resolution action. | Implemented; rehearse one outage. |

## Process and product gaps

### 1. Fixtures are specifications, not proof

The JSON suite is valuable because its expected result was written before the
implementation. But it is not a passing test until a runner supplies real
credentials/proofs and validates production-equivalent outcomes. Treat every
fixture without an automated result as an open risk, especially duplicate,
replay, mid-flow revocation and concurrent spending.

### 2. Failure handling needs a transaction state model

For each merchant checkout, persist a small reconciliation state machine such
as `created -> authorization_claimed -> merchant_pending -> settled | failed |
voided | unknown`. Use one idempotency key from AgentPay to merchant and payment
adapter. If the network times out after the merchant receives the request,
return `unknown`/pending and reconcile by that key; never blindly retry a
capture or announce a refusal that may already have settled. This is necessary
even with a mocked card rail because it is the behaviour a real integration
will need.

### 3. Define exact quote integrity and expiry

The store should bind a quote/order reference, issued timestamp, expiry, product
IDs, quantities, currency, subtotal, shipping, total and delivery destination
to the checkout request. A changed price, tax or delivery fee must make the old
quote invalid, not silently broaden the mandate. The policy must always receive
the final charge total. Add a clock-skew and quote-expiry test.

### 4. Make retry semantics legible

Document the distinction between:

- same idempotency key after a transport failure: return the original result;
- same signed request/nonce after success: no second charge;
- a fresh request after a refusal: re-evaluate current mandate state;
- any request after revocation: fail closed.

The UI and MCP response should say whether the user should retry, amend,
approve an exception, wait for reconciliation or contact support. "Try again"
is unsafe around money.

### 5. Add a controlled fault-injection surface

For the demo merchant only, a presenter-visible, authenticated control should
be able to make the *next* checkout return one of: price changed, out of stock,
shipping unsupported, 500, timeout, malformed response, and payment decline.
It must be disabled for normal shoppers and leave an audit entry. This gives
judges a credible way to test failures without developer tools or database
access.

### 6. Establish operational ownership

Before judging, name one person for each boundary: buyer/passkey, MCP client,
AgentPay deployment/Supabase, PartsRoute merchant, Didit/webhook, and demo
narration. Define an abort rule: if a provider is slow, use the prepared
recorded evidence or offline fixture runner, state the boundary honestly, and
do not improvise a manual database repair in front of the judges.

### 7. Protect the data boundaries

Release-review checks must confirm that raw PAN/CVC, bank credentials, Didit
documents/biometrics, Supabase secret keys, merchant API keys and registry
private keys never enter browser code, MCP tool arguments, logs, audit payloads
or the public merchant projection. Supabase tables exposed through the Data API
need RLS with ownership predicates; privileged database functions need narrow
`EXECUTE` grants, fixed `search_path`, input validation and an explicit caller
check. Do not use editable user metadata as authorization data.

### 8. Define availability and observability

Add request IDs spanning MCP -> AgentPay -> merchant, structured redacted logs,
and dashboards/alerts for webhook failures, verification pending time, merchant
timeouts, declined payment adapters, policy refusals and reconciliation backlog.
The auditor should be able to correlate a user-visible attempt with a merchant
request without seeing personal data or card references.

## The recommended 90-second trial

1. In the assistant, ask for a specific PartsRoute product with a clear USD
   limit and explain that the store URL came from the user.
2. Show the assistant discovering the merchant's own manifest/catalog, then
   requesting—not granting—a mandate.
3. On the phone/browser, show the passkey signature. Return to the assistant
   and complete the approved purchase.
4. Open the buyer purchase trail and the merchant transaction view side by
   side. Point out the final total, mandate, agent check, and audit evidence.
5. Start the second purchase in the revocation window; revoke from the buyer
   screen; show `MANDATE_REVOKED` and no new payment token.
6. If time allows, open a dispute and show that AI analysis can advise but a
   person—not the agent or merchant alone—resolves it.

Use one product and one account that have already completed KYC/passkey/card
setup. Do not make the live presentation depend on an email arriving, a new
passkey enrolling in an embedded browser, or a fresh KYC decision.

## Exit checklist

- [ ] All 15 attack fixtures run automatically with an isolated state reset.
- [ ] The concurrent-spend and mid-flight-revocation tests have passed against
      the deployment used for the demo.
- [ ] A new approved end-to-end PartsRoute purchase was completed on that
      deployment and is visible to buyer, merchant and auditor.
- [ ] A revoked purchase was refused live with no settlement side effect.
- [ ] An over-limit purchase escalated/refused with no settlement side effect.
- [ ] Didit approved, pending/declined, invalid-signature and duplicate-webhook
      paths have been tested or are explicitly disabled from the demo.
- [ ] Merchant checkout failure, timeout and duplicate-delivery behaviour is
      deterministic and reconciled by idempotency key.
- [ ] The presenter run sheet, fallback video/evidence and ownership contacts
      are ready.
- [ ] No secret, raw card field, identity document or biometric payload appears
      in public output, logs or repository history.

## What not to add before judging

Do not add a second real payment gateway, a marketplace crawler, a new agent
identity format or another mock store until the P0 matrix is executable. Those
can make the story broader, but they do not prove the central claim: a human's
revocable, constrained authority remains enforced when an autonomous agent and
an independent merchant act concurrently.
