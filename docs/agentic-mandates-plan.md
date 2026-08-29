# Agentic Mandates: Product and Delivery Plan

## 1. Product thesis

**Agentic Mandates** is a trust layer for purchases made by software agents on behalf of people or organizations. It does not give an agent a card number or a standing, unrestricted ability to spend. It gives the agent a **bounded, verifiable, revocable capability** to complete a specific purchasing intent.

The product is intentionally vertical-agnostic. The same primitives work for travel, procurement, subscriptions, retail replenishment, utilities, insurance, software licenses, or any merchant accepting agent-initiated payments.

> An agent may propose and execute a purchase; a deterministic policy engine decides whether the purchase is allowed.

The project is an authorization and custody layer, not a competing commerce or payment protocol. Merchant APIs and ACP-style integrations resolve catalog discovery, quoting, and order execution; Agentic Mandates resolves **who may authorize payment, under which constraints, with revocation and human custody**. This complements payment-rail infrastructure such as [Yuno Agentic Commerce](https://www.y.uno/en/product/agentic-commerce). The project-local `agents-pay` endpoints are mock merchant APIs, not a claim of a new public protocol.

## 2. Demo promise

The demo must prove all of the following without manual database edits or developer intervention:

1. A principal creates a mandate for a named agent without sharing raw payment credentials.
2. The agent discovers offers through merchant-specific `agents-pay` APIs, normalizes them, and selects an eligible quote.
3. The merchant verifies the agent, mandate, immutable quote, and one-time purchase capability before accepting payment.
4. An out-of-policy attempt is rejected or requires the principal's approval; it is never silently accepted.
5. Revocation takes effect immediately: the next verification fails.
6. The principal and merchant each see an appropriate view of the same evidence; the principal can inspect a complete evidence timeline for their own activity.
7. A contract activation and every escalated exception require a passkey-confirmed, contract-bound approval.
8. A recurring mandate can create and run a due purchase from its own schedule without an operator changing database state.

The payment settlement and product catalog may be simulated. The authorization decision, cryptographic bindings, revocation, policy evaluation, and audit trail must be real application behavior.

## 3. Roles and trust boundaries

| Role | Responsibility | Must not receive |
| --- | --- | --- |
| Principal | Creates, changes, approves, disputes, and revokes mandates. | Raw merchant-side payment data or unnecessary agent internals. |
| Purchasing agent | Searches, compares, requests approval, and submits a candidate purchase. | Raw PAN/card details, reusable payment credentials, or authority outside its mandate. |
| Mandate service | Stores mandates, evaluates policies, issues capabilities, records audit events, and handles revocation. | Long-lived user secrets in logs. |
| Merchant | Builds an order and asks the mandate service whether it is authorized. | The principal's full mandate, purchase history, or payment credentials. |
| Payment Vault mock | Isolated, Yuno-like API that tokenizes a payment method and authorizes/captures approved payments. | The agent's authority beyond a valid, server-side purchase request. |
| Mock Yuno payment router | Routes test card operations to deterministic mock card gateways. | Raw card data, mandate policy, or a reusable capability. |
| Merchant registry | Mandate-service-controlled source of merchant keys, endpoint allow-list, status, and trust tier. | Authority to self-assign trust or alter a principal's policy. |

## 4. Core objects

### 4.1 Mandate

An explicit, versioned authorization from a principal to one purchasing agent. A mandate is active only when its current version is active and has not been revoked.

```ts
type Mandate = {
  id: string;
  version: number;
  principalId: string;
  agentId: string;
  status: 'active' | 'paused' | 'revoked' | 'expired';
  paymentMethodId: string; // Reference to a display-safe, tokenized Vault payment method
  policy: PurchasePolicy;
  recurringIntentTemplate?: RecurringIntentTemplate;
  validFrom: string;
  validUntil: string;
  createdAt: string;
  revokedAt?: string;
};
```

`paymentMethodId` is never a PAN, CVV, card hash, encryption key, or provider token returned to the agent. The Mandate service resolves it server-side through the isolated Payment Vault mock.

```ts
type RecurringIntentTemplate = {
  naturalLanguageIntent: string;
  quantity: number;
  preferredMerchantIds: string[];
  allowedSubstitutionCategoryIds: string[];
  requiredAttributes: Record<string, string | number | boolean>;
};
```

`RecurringIntentTemplate` stores the user-approved product intent and search preferences, such as “rice,” a preferred merchant order, quantity, and allowed substitutions. It lets a scheduled run dispatch the same purchasing agent without granting the scheduler authority to invent a new intent, issue a capability, or make a payment.

### 4.2 Purchase intent

The structured request the agent wants to satisfy. Natural language is allowed as input to discovery, but the policy engine must receive normalized fields, canonical amounts, currency, merchant, line items, and a content hash.

```ts
type PurchaseIntent = {
  merchantId: string;
  quoteId: string;
  canonicalCategoryId: string;
  amountMinor: number;
  currency: string;
  lineItems: Array<{ sku: string; name: string; quantity: number; unitAmountMinor: number }>;
  attributes: Record<string, string | number | boolean>;
  canonicalCartHash: string;
};
```

### 4.3 Merchant quote

Each mock e-commerce owns its catalog and exposes an authenticated `agents-pay` API. A quote is the merchant's immutable, expiring source of truth for a potential order; the agent is never trusted to set its own price, fees, or cart.

```ts
type MerchantQuote = {
  id: string;
  merchantId: string;
  merchantOrderRef: string;
  issuedAt: string;
  merchantCatalogVersion: string;
  lineItems: Array<{
    merchantSku: string;
    merchantCategoryId: string;
    name: string;
    quantity: number;
    unitAmountMinor: number;
    attributes: Record<string, string | number | boolean>;
  }>;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  expiresAt: string;
  merchantCartHash: string;
  keyId: string;
  signature: string; // JWS over the canonical quote payload
};

type NormalizedQuote = {
  quoteId: string;
  merchantId: string;
  taxonomyVersion: string;
  canonicalLineItems: Array<{ merchantSku: string; canonicalCategoryId: string }>;
  canonicalCartHash: string;
};
```

The Mandate service validates the JWS with the merchant key in its own registry, then maps signed merchant SKU/category data to its own versioned canonical taxonomy, for example `food.prepared.hamburger` or `food.meat.chicken`. `NormalizedQuote` is service-derived; a merchant never supplies a canonical category or self-reports its trust tier. A Bloom filter may optimize a preliminary catalog-search membership lookup, but an exact canonical lookup is always the authorization decision because Bloom filters can return false positives.

### 4.4 One-time purchase capability

A short-lived signed authorization issued only after the current policy passes. It is bound to one agent, one merchant, one canonical purchase intent, an amount ceiling, a nonce, and a short expiry. It cannot be reused for another cart or merchant.

```ts
type PurchaseCapability = {
  id: string;
  mandateId: string;
  mandateVersion: number;
  agentId: string;
  merchantId: string;
  quoteId: string;
  canonicalCartHash: string;
  maxAmountMinor: number;
  currency: string;
  nonce: string;
  expiresAt: string;
  oneTimeUse: true;
  approvalRequestId?: string;
  signature: string;
};
```

A capability has an internal lifecycle of `issued → authorized → consumed | voided | expired`. Payment authorization atomically claims it (`issued → authorized`) in local Mandate state so it cannot be replayed. Capture accepts only the claimed capability, rechecks current mandate and quote state, then atomically consumes it (`authorized → consumed`) after the Vault result is reconciled. The cross-service failure and void path is the idempotent saga in section 11; it is not a distributed ACID transaction.

### 4.5 Payment method, payment operation, and state

```ts
type PaymentMethodSummary = {
  id: string;
  brand: string;
  last4: string;
  status: 'active' | 'disabled';
};

type PaymentOperation = {
  id: string;
  mandateId: string;
  capabilityId: string;
  quoteId: string;
  paymentMethodId: string;
  authorizationId?: string;
  state:
    | 'created'
    | 'authorization_pending'
    | 'authorized'
    | 'capture_pending'
    | 'captured'
    | 'void_pending'
    | 'voided'
    | 'failed'
    | 'reconciliation_required';
};
```

The Mandate application stores only `paymentMethodId`, `brand`, `last4`, and `status`. The Vault alone stores its internal `providerTokenRef` and gateway data. The principal may select an existing test method or add one through a one-time, Vault-hosted test-payment setup screen. The Mandate application never stores raw card data, CVV, a salted card hash, a reversible card-data key, or the Vault's internal token.

`authorized` means a gateway has approved/held the amount but the final debit has not happened; it can normally be voided. `captured` means the mock settlement is final and the default budget debit is recorded. These states are simulated by the mock gateways but retain the real authorization semantics needed for revocation and reconciliation.

### 4.6 Passkey approval evidence

```ts
type ApprovalChallenge = {
  id: string;
  principalId: string;
  purpose: 'mandate_activation' | 'exception_approval';
  approvalPayloadHash: string;
  challenge: string;
  expiresAt: string;
  consumedAt?: string;
};

type PasskeyApprovalEvidence = {
  challengeId: string;
  credentialId: string;
  authenticatorDataHash: string;
  clientDataJsonHash: string;
  signatureHash: string;
  signCount: number;
  verifiedAt: string;
};
```

The approval payload is canonicalized before hashing. The server generates a random nonce and derives the WebAuthn challenge from both the nonce and approval payload hash. For mandate activation it binds the mandate ID and version, policy hash, payment-method ID, expiry, and nonce. For an exception it additionally binds the quote ID, canonical cart hash, final amount, currency, expiry, and reason codes. The server verifies the WebAuthn assertion with user verification, atomically consumes the challenge, checks the authenticator counter when available, and stores audit-safe evidence metadata rather than biometric data.

### 4.7 Verification result

The merchant receives a minimal proof and a decision, not the full mandate.

```ts
type VerificationResult = {
  decision: 'approved' | 'rejected' | 'approval_required';
  reasonCode: string;
  verificationId: string;
  mandateStatus: 'active' | 'revoked' | 'expired';
  expiresAt?: string;
};
```

## 5. Configurable mandate contract

The UI starts from a conversational request such as “buy rice,” then the agent asks only for the information needed to form a safe contract: maximum price, recurrence, preferred merchants, payment method, and relevant delivery or quality requirements. The principal reviews and approves the generated contract. Presets and the advanced editor operate on the same typed policy schema.

| Policy area | Example fields |
| --- | --- |
| Identity and scope | permitted `agentId`, merchant allow/deny lists, merchant trust tier, versioned canonical category taxonomy, organization/cost center, country or region. |
| Item constraints | SKU/service allow list, forbidden add-ons, quantity ceiling, compatibility or quality attributes, warranty/refund requirements. |
| Financial limits | per-purchase maximum, total budget, daily/weekly/monthly budget, currency allow list, tax/shipping/fees inclusion, FX tolerance, split-payment prohibition. |
| Time and cadence | validity interval, allowed hours, maximum uses, interval between purchases, `daily`/`weekly`/`monthly` recurrence, IANA timezone, local execution window, and maximum count. |
| Intent-specific attributes | arbitrary validated attributes such as delivery date, service region, supplier rating, sustainability score, cancellation policy, or contract duration. |
| Autonomy thresholds | auto-approve below a value, declare exactly which deviations are eligible for an immutable one-off approval, require approval for a new merchant/category or low-trust merchant, or always require approval for a first purchase. |
| Risk controls | known-agent-key requirement, velocity threshold, merchant verification level, geographic anomaly handling. |
| Privacy | data disclosure profile, receipt retention period, whether a merchant may see a pseudonymous principal reference. |
| Dispute terms | dispute window, evidence visibility, preferred remedy, and organization-specific escalation owner. |

### Example policy

```json
{
  "merchant": { "allow": ["merchant_demo"], "minTrustTier": "verified" },
  "categories": { "allow": ["food.grains.rice", "food.meat.chicken"] },
  "money": {
    "perPurchaseMaxMinor": 15000,
    "monthlyMaxMinor": 45000,
    "currencies": ["USD"],
    "includeFees": true
  },
  "usage": { "maxPurchasesPerMonth": 3, "minIntervalHours": 24 },
  "recurrence": {
    "frequency": "weekly",
    "daysOfWeek": ["monday"],
    "localTime": "09:00",
    "timezone": "America/Sao_Paulo",
    "executionWindowMinutes": 30,
    "maxOccurrences": 4
  },
  "items": { "forbidAttributes": { "autoRenew": true, "giftCard": true } },
  "autonomy": {
    "autoApproveMaxMinor": 12000,
    "aboveThat": "human_approval",
    "lowTrustMerchant": "human_approval",
    "escalatableReasons": [
      "AMOUNT_EXCEEDED",
      "LOW_TRUST_MERCHANT",
      "NEW_CATEGORY"
    ]
  },
  "risk": { "requireKnownAgentKey": true, "maxRiskScore": 40 }
}
```

## 6. Policy evaluation and guardrails

### Non-negotiable design rule

LLMs may interpret user input, search catalogs, compare offers, and write an explanation. They must not be the final authorizer. The final decision is a deterministic, testable function of normalized request data, the active mandate version, current usage counters, revocation state, and risk signals.

### Evaluation order

1. Authenticate the agent and validate its signed request, `kid`, `jti`, timestamp, nonce, HTTP method, URL, and body hash.
2. Load the latest mandate state; reject inactive, expired, paused, or revoked mandates.
3. Confirm the agent, principal context, and merchant match the mandate.
4. Look up the merchant's endpoint, signing key, status, and trust tier in the Mandate-service-controlled Merchant Registry. Fetch and validate the unexpired signed `MerchantQuote`; map its local SKU/category data to the active taxonomy version and derive `NormalizedQuote.canonicalCartHash`.
5. Evaluate the quote total in minor units, including required taxes, shipping, fees, and converted currency.
6. Atomically check usage, recurrence, velocity, and remaining budget according to the merchant's configured budget-concurrency mode.
7. Evaluate risk signals and merchant eligibility.
8. Return `rejected`, `approval_required`, or issue a one-time capability.
9. At payment authorization, verify again and atomically claim the capability. At capture, recheck revocation, quote expiry, and canonical cart hash, then atomically consume the claimed capability; void it if capture cannot proceed.

Every rejected or escalated decision must return stable reason codes, for example `AMOUNT_EXCEEDED`, `FORBIDDEN_CATEGORY`, `CART_CHANGED`, `CAPABILITY_REPLAYED`, `MANDATE_REVOKED`, or `HUMAN_APPROVAL_REQUIRED`.

### Exception matrix

The policy schema contains an explicit `autonomy.escalatableReasons` allow-list. An agent cannot classify a failure, alter that allow-list, or increase a limit. A human approval is always one quote-bound capability; it never changes the mandate for later purchases.

| Condition | Default result | May become a one-off approval only when explicitly configured? |
| --- | --- | --- |
| Amount above the automatic threshold or configured budget ceiling | `APPROVAL_REQUIRED` | Yes, `AMOUNT_EXCEEDED` |
| Merchant below the policy trust tier | `APPROVAL_REQUIRED` | Yes, `LOW_TRUST_MERCHANT` |
| New mapped category outside the normal allow-list | `APPROVAL_REQUIRED` | Yes, `NEW_CATEGORY` |
| Category with no canonical mapping | `UNMAPPED_CATEGORY` | No in the hackathon MVP; map it first or revise the contract. |
| Invalid signature, replay, unknown/inactive merchant, quote expiry, cart mismatch, mandate/key revocation, or expired mandate | Stable hard-fail reason | No |

The initial defaults are deliberately fail-closed. Future products may permit an explicit principal-approved exception for an unmapped category, but it is not part of this MVP because it would weaken the normalization proof.

### Policy Diff

The product should make decisions legible. For every non-approved result, show a field-level comparison:

```text
Policy:   category=business.supplies; total <= $150; max uses this month=3
Attempt:  category=gift_card;         total=$300;  use number=4

Result: FORBIDDEN_CATEGORY, AMOUNT_EXCEEDED, MONTHLY_USAGE_EXCEEDED
```

This is valuable for the principal, merchant support, and audit review.

## 7. Human-in-the-loop flow

Human approval is a designed control, not a fallback for errors.

1. The agent submits a complete intent derived from an immutable merchant quote.
2. If the policy returns `approval_required`, create an approval request containing the quote ID, derived canonical cart hash, item summary, final total, merchant, reasons, and expiry.
3. Notify the principal. The approval screen shows exactly what will be purchased and why it needs approval.
4. The principal reviews the exact payload and confirms it with a passkey in their authenticated session. The one-time WebAuthn challenge is bound to the activation or exception payload hash and expires quickly.
5. The server verifies user presence/verification, RP ID, origin, credential, signature, and the authenticator counter when the authenticator provides one, then atomically consumes the challenge. A suspicious nonzero counter regression fails closed.
6. Approval issues a new short-lived one-time capability bound to the same quote ID and derived canonical cart hash. It changes neither the contract nor its future limits; any cart alteration invalidates it.
7. Revocation or expiration invalidates outstanding approval requests and capabilities.

The policy explicitly separates escalatable exceptions from hard failures. A budget increase, low-trust merchant, or new category may be escalatable when configured so; revocation, invalid signature, replay, unknown merchant identity, quote expiry, or expired mandate must never be bypassed through normal approval.

## 8. Payment tokenization and sensitive-data handling

### Hosted test-payment model

- The isolated Payment Vault mock exposes a hosted setup screen for a principal to choose or enter a **test-only** payment method. It issues a one-time callback to the web application with an opaque `paymentMethodId` and display-safe metadata.
- The Mandate application stores only `paymentMethodId`, brand, last four digits, and status. The Vault retains its own `providerTokenRef`; it never returns that value to the application, agent, or merchant.
- Never send raw PAN, CVV, salted card hashes, reversible card-data keys, or reusable payment credentials to the purchasing agent, browser logs, audit log, merchant verification payload, or Mandate application database. The demo must reject real-looking, non-fixture card details.
- The Mandate service references `paymentMethodId` to the Vault only after merchant verification succeeds; neither the agent nor merchant receives the reference or internal token.
- A purchase capability is not a payment token. It authorizes a narrowly scoped action; it cannot independently charge a payment method.

The hosted screen models provider tokenization; it does not claim end-to-end card encryption, PCI isolation, or live card processing. Hashing a card number would not make it a safe payment credential design, so the mock deliberately uses test fixtures and opaque IDs instead.

### Data minimization

- The merchant sees a signed verification result, a pseudonymous principal reference when needed, and only the policy facts required to accept the order.
- The principal has full visibility into their mandates, payments, approvals, and evidence timeline.
- Encrypt sensitive references at rest, use TLS in transit, redact logs by default, and define retention/deletion windows for receipts and audit metadata.

## 9. Agent identity, anti-fraud, and adversarial controls

Use an agent identity separate from the principal's identity. Each agent has an `agentId`, a registered public key, and a key ID (`kid`). Every agent request is signed (JWS or equivalent) over the HTTP method, URL, body hash, `jti`, timestamp, and nonce. The Mandate service checks the current key, agent, mandate, and capability state online for every critical operation.

The principal uses an authenticated browser session with `HttpOnly`, `Secure`, and appropriate `SameSite` cookies. Cookies are not agent credentials. A short-lived bearer JWT may be an auxiliary agent session credential, but it is never the only proof of agent identity: a direct API caller must still produce a valid signed request from an active agent key.

Controls to implement or simulate visibly:

- Signature verification, key rotation/revocation, and online status checks. Every request proof has a target-specific audience (`mandate-api`, `merchant-api:<merchantId>`, `payment-vault`, or `mcp-server`) so a valid proof cannot be replayed at another service.
- Short-lived, one-time capability with atomic consumption.
- Binding of capability to merchant, agent, canonical cart hash, currency, amount, and expiration.
- Replay protection using nonce and consumed-capability state.
- Rate limits and velocity limits per mandate, agent, principal, and merchant.
- Merchant identity allow list and trust tier.
- Rate-limit and temporary-block controls by IP, agent, mandate, merchant, and failed authentication attempts.
- Principal-session authentication for mandate creation, mutation, revocation, payment-method selection, and sensitive approval.
- Strict server-side price and cart recomputation; never trust agent-provided totals.
- Explicit add-on detection: hidden fees, subscriptions, warranties, insurance, donations, or renewal terms must be present in the canonical cart.

### Adversarial demonstration cases

The demo should have one-click attack scenarios:

1. Increase the amount after approval.
2. Replace the cart after capability issuance.
3. Reuse a consumed capability.
4. Present a capability at another merchant.
5. Submit after the principal revokes the mandate.
6. Attempt a forbidden category or hidden add-on.
7. Sign the request as an unknown agent key.

All must fail with clear reason codes and audit entries.

## 10. Revocation semantics

Revocation is synchronous policy state, not a suggestion for agents to honor later. It applies independently to the mandate, agent key, approval request, capability, and payment method.

- The principal revokes a mandate through an authenticated action.
- The service marks it revoked immediately and emits a realtime event to the UI.
- Every merchant verification and every payment-capture verification reads current revocation state.
- Cache entries must be invalidated or version-checked; do not rely on a long-lived JWT alone.
- Previously issued capabilities are invalid once their mandate is revoked, even if their own expiry has not passed.
- If revocation commits while the operation is `authorized` and capture has not started, the payment operation moves to `void_pending`; the Vault must void it and every later capture attempt fails with `MANDATE_REVOKED`.
- If `capture_pending` committed first, a capture call may already be in flight. Revocation records the race and reconciliation determines the result. A confirmed capture is treated as post-capture: the system preserves evidence and opens a dispute/refund workflow rather than pretending the charge was voided.
- If revocation happens after capture, it does not pretend to reverse a completed settlement. The system preserves the capture evidence and opens a dispute/refund workflow for the principal.

The live demo must perform: **revoke → repeat identical purchase → verification returns `MANDATE_REVOKED`**.

## 11. Payment saga and deterministic mock rails

Postgres and the isolated Vault are separate systems. The product must not claim a distributed ACID transaction between them. Payment therefore uses an idempotent saga:

1. The Mandate service creates `PaymentOperation`, claims the one-time capability, records an audit event, and commits one local transaction.
2. It calls the Vault authorization endpoint with a persistent idempotency key derived from the operation ID.
3. The Vault asks the Mock Yuno router to deterministically select Card Gateway A or Card Gateway B. The gateway returns `approved`, `declined`, `timeout`, or a configured capture failure.
4. The Mandate service persists the result. If a network response is unknown, it marks the operation `reconciliation_required`, queries the Vault by the same operation ID, and retries only with the same idempotency key.
5. On capture, the service rechecks quote, capability, and revocation state; it sends a distinct persistent capture idempotency key. A failed pre-capture or revoked authorized operation is voided and releases the outstanding capability slot only after the Vault confirms that no authorization remains.

The default budget mode debits only on `captured`. A merchant integration may advertise `reserve_on_authorization` for concurrent orders, but the selected mode is fixed in the mandate/merchant configuration and is never chosen by the agent.

The Mock Yuno router and both gateways are intentionally card-only. PIX is outside the MVP because it would require a person to authenticate and act in a bank environment, which is not an agentic card-payment rail in this demo.

## 12. Recurrence execution

Recurrence is a data-driven purchase workflow, not merely a policy field. A mandate defines a typed cadence, IANA timezone, local execution window, occurrence limit, and a `RecurringIntentTemplate` approved by the principal.

1. One Supabase Cron tick asks the Mandate service to identify due schedules. It only creates and locks a `recurrenceRun` keyed by `(mandateId, scheduleSlot)`; it cannot issue a capability or pay.
2. The Mandate service dispatches that run to the separately authenticated Agent Simulator. The simulator uses its registered agent key to search, obtain a signed quote, and submit an ordinary purchase intent.
3. The standard policy, merchant verification, capability, and payment saga run unchanged. A recurring purchase is never implicitly pre-approved beyond its mandate.
4. A policy escalation puts the run in `approval_pending` and sends the principal to the same passkey approval screen. Expiry, no eligible offer, or rejected approval ends that run with a reason code; retrying it never creates a second purchase.

The demonstration seed uses `America/Sao_Paulo`; the schema accepts any validated IANA timezone. The scheduler advances `nextRunAtUtc` only through a locked transition and remains idempotent across duplicate cron calls.

## 13. Auditing, evidence, and disputes

Create append-only audit events with a correlation ID, actor, event type, timestamp, sanitized payload, previous-event hash, and current-event hash. Events are chained per aggregate stream (for example, one mandate) rather than through one global head. Appending locks that stream's cursor and assigns an increasing sequence number, so concurrent events cannot fork the chain; correlation IDs connect events across streams. A cryptographic hash chain is enough for a hackathon demonstration; it makes tampering visible without claiming a full legal ledger.

The database role used by application services receives `INSERT` access only for audit events. A database trigger rejects `UPDATE` and `DELETE`; a test must prove that tampering is rejected and that a changed payload breaks verification of the hash chain. Audit evidence is retained immutably in the MVP. Receipts or PII with shorter retention live in a separate record and are redacted by an append-only event, never by rewriting an audit event. This is tamper-evident application evidence, not an independently witnessed legal ledger.

Required event types:

- `mandate.created`, `mandate.updated`, `mandate.revoked`
- `agent.request_received`, `policy.evaluated`, `approval.requested`, `approval.resolved`
- `capability.issued`, `capability.verified`, `capability.consumed`
- `payment.authorized`, `payment.captured`, `payment.failed`
- `payment.reconciliation_required`, `payment.voided`, `payment.refund_requested`
- `passkey.approval_challenged`, `passkey.approval_verified`
- `recurrence.due`, `recurrence.executed`, `recurrence.skipped`
- `dispute.opened`, `dispute.evidence_reviewed`, `dispute.resolved`

For a dispute, render the principal's timeline showing the mandate version, policy decision, signed agent request, quote ID and cart hash, principal approval (if any), payment result, and whether revocation occurred before capture. The system should make a reasoned determination: purchase was authorized under the recorded mandate, or the platform/merchant violated the mandate and should reverse it.

## 14. Minimum viable architecture

```text
Principal dashboard ─┐
Agent simulator ─────┼─> API / Mandate service ─> Policy engine
MCP stdio server ────┤           │                    │
Merchant consoles ───┘           │                    │
        │                        │                    ├─> Capability signer/verifier
        └─> Merchant-specific    │                    ├─> Usage, reservation, and revocation store
            `agents-pay` APIs    │                    └─> Audit event store
                                 │
                                 ├─> Realtime notifications
                                 ├─> Supabase Cron recurrence tick
                                 └─> Isolated Payment Vault mock ─> Mock Yuno router ─> Card Gateway A | B
```

Suggested application modules:

| Module | Responsibility |
| --- | --- |
| Mandates | CRUD, versions, activation, revocation, policy schema validation. |
| Agent gateway | Agent authentication, signed request verification, rate limiting. |
| Merchant adapters | Per-platform `agents-pay` API client, authenticated quote retrieval, canonical taxonomy mapping, and quote hashing. |
| Policy engine | Pure deterministic evaluator with unit tests and reason codes. |
| Capabilities | Signing, verification, expiration, atomic one-time use. |
| Merchant verification | Minimal verification API and merchant-facing decision UI. |
| Payment Vault mock | Isolated tokenization, payment-method reference, authorization, capture, void, and failure lifecycle. |
| Mock Yuno payment router | Deterministic card-gateway selection, idempotency forwarding, and scenario-controlled outcomes. |
| Approvals | Human approval requests and step-up confirmation. |
| Passkey approvals | Contract-bound WebAuthn challenges and verifiable approval evidence. |
| Recurrence scheduler | Creates idempotent due runs from contract data and invokes the purchasing circuit. |
| Internal SDK | Typed agent and merchant clients used by the simulator and mocks; never published to npm in the MVP. |
| MCP boundary | A constrained tool facade for the agent; it is not an authority or payment API. |
| Audit and disputes | Append-only principal evidence timeline and resolution state. |

For Supabase-backed storage, payment references, capabilities, and audit events are written only by server-side services/RPCs. Exposed tables require RLS policies scoped to the owning principal or authenticated merchant; no service-role key or Vault token is exposed to the browser.

## 15. Suggested screens

1. **Principal dashboard:** active mandates, remaining budget/uses, recent purchases, evidence timeline, and revoke action.
2. **Create mandate:** agent-led plain-language intake, Vault-hosted test-method setup/selection, advanced rules, generated contract review, and passkey activation.
3. **Agent console:** discovered offers, decision rationale, submit purchase, attack-mode toggles.
4. **Approval inbox:** immutable purchase summary, reason codes, passkey approve/reject, and expiration timer.
5. **Merchant console:** verification badge, minimal proof, decision reason, and settlement status. It has no payment-method access or capture action.
6. **Evidence timeline:** the principal's correlated events, policy diff, evidence, and dispute outcome.

## 16. Delivery plan

### Phase 1 — Domain foundation

- Define mandate, policy, merchant quote, purchase intent, capability, payment state, verification, and audit schemas.
- Build a pure policy evaluator with fixture-based tests.
- Implement normalized money handling in integer minor units, canonical cart hashing, and versioned taxonomy mapping.
- Build two merchant-specific mock `agents-pay` APIs, a Mandate-service-controlled Merchant Registry, several products/services, one principal, and one agent.
- Add the internal workspace SDK used by the agent simulator and merchant mocks.

**Done when:** a test can prove approval, rejection, escalation, expiration, and usage limits without a UI.

### Phase 2 — Safe authorization circuit

- Implement mandate creation, versioning, activation, and revocation.
- Implement signed agent requests, agent-key revocation, and capability issuance/consumption.
- Build authenticated merchant quote/verification flows, signed quote envelopes, the hosted test-payment setup, and the isolated Payment Vault mock.
- Build the Mock Yuno router and two deterministic card-gateway mocks; cover approval, decline, timeout, and capture failure.
- Implement `created → authorized → captured | voided | failed` payment transitions. By default, budget is debited only on capture and a mandate permits one outstanding capability; merchants may opt into atomic budget reservation for concurrent purchases.
- Implement the idempotent payment saga and reconciliation path; guarantee atomic check-and-consume behavior only for local Postgres state, usage counters, capabilities, and configured budget reservations.

**Done when:** a valid request purchases once, and replay or cart substitution fails.

### Phase 3 — Human controls and visibility

- Add passkey registration plus contract activation and approval-request flows with immutable payload binding.
- Add principal, agent, merchant, and principal-evidence views.
- Add Policy Diff explanations and realtime revocation feedback.
- Add data-driven recurrence with IANA timezone, execution window, a unique run key, and a Supabase Cron tick.

**Done when:** a user can approve an escalated purchase and revoke a mandate live.

### Phase 4 — Trial by fire and polish

- Add the adversarial attack scenarios.
- Add a minimal dispute timeline and outcome record; an elaborate dispute-resolution experience is stretch work.
- Add deterministic gateway controls, `demo:reset`, seeded keys/catalogs/test methods, and button-driven attack scenarios.
- Rehearse the deployed demo from a fresh dataset; ensure no developer action is needed.
- Document architecture, decisions, security model, deployment, setup, and known limitations.

**Done when:** every challenge scenario produces an immediate, explainable, auditable result.

## 17. Demo script

1. The principal creates a mandate for a specific agent, category, merchant set, budget, cadence/timezone, and approval threshold; they activate it with a passkey.
2. The agent finds an eligible offer and requests authorization.
3. The policy engine approves; the merchant sees a minimal verification result. The Mandate service asks the isolated Vault mock to authorize, routes through Mock Yuno to a card gateway, then captures using its server-side payment-method reference.
4. Each party opens its record: principal receipt/evidence timeline and merchant verification.
5. The agent tries a prohibited or over-budget purchase. Show the Policy Diff and rejection.
6. Try a purchase that is permitted only with human approval. Approve it, then demonstrate that changing the cart invalidates the approval.
7. Revoke the mandate live and retry an otherwise valid purchase. It fails immediately.
8. Run a replay or merchant-substitution attack; show the capability binding prevents it.
9. Open a dispute and use the evidence timeline to resolve it.
10. Trigger a due recurring run, show that its generated run key is idempotent, and show a deterministic gateway timeout reconciling safely.

## 18. Decision log

| Decision | Chosen approach | Alternatives considered | Why |
| --- | --- | --- | --- |
| Final authorization | Deterministic policy engine | LLM-only approval | Policies must be testable, repeatable, and safe against prompt injection. |
| Payment access | Isolated Vault mock, Vault-only provider token reference, and one-time capability | Give agent a virtual card, raw card data, or raw payment token | Separates settlement credential from authority and limits blast radius. |
| Merchant proof | Minimal signed verification | Send the full mandate | Supports verifiability while minimizing personal data exposure. |
| Revocation | Online state check at verification/capture | Long-lived self-contained token only | A token alone cannot guarantee immediate revocation. |
| Identity | Secure principal browser session plus agent-key-signed requests with online status checks | One shared user session or cookie-only agent JWT | Enables attribution, least privilege, immediate agent-key revocation, and direct-API-call protection. |
| Fingerprinting | Secondary risk signal | Primary proof of authority | Fingerprints are probabilistic and can change or be spoofed. |
| Audit integrity | Append-only hash-chained events | Mutable transaction log | Gives a clear, demoable tamper-evidence property. |
| HITL | Conversational contract creation plus contextual, quote-bound exception approval | Blanket approvals or broad overrides | Keeps contract creation low-friction while ensuring exceptions do not mutate future authority. |
| Contract approval | App-owned WebAuthn assertion bound to the approval payload | Session-only approval or Supabase sign-in passkey alone | Produces contract-specific, auditable approval evidence while retaining Supabase for principal identity. |
| Payment settlement | Mandate-owned idempotent saga across Postgres and the Vault | Merchant capture route or pretend cross-service ACID transaction | Keeps Vault authority isolated from merchants while making timeout and retry behavior correct and demoable. |
| Mock rails | Vault → Mock Yuno router → two card gateways | One monolithic success-only capture mock or PIX | Demonstrates routing and adverse outcomes without handling real funds or bank login. |
| Recurrence | Data-driven schedules plus one Supabase Cron tick | One cron job per contract or Vercel-plan-dependent scheduler | Supports dynamic contract schedules and deterministic run idempotency. |
| MCP | Stdio as the committed transport; authenticated HTTP as a stretch | Anonymous remote endpoint or custom OAuth server | Proves MCP interoperability without replacing core safety work with identity infrastructure. |

## 19. Non-goals and honest limitations

- This MVP does not claim PCI certification, legal enforceability, or real card-network chargeback integration.
- The isolated Payment Vault mock proves the authorization circuit with test methods only; it is not a card vault and must not accept real payment data. A production integration requires Yuno/PSP API credentials, provider-specific webhooks, PCI scope review, and merchant onboarding.
- A hash chain provides tamper evidence within the system; production-grade independent auditability may require external timestamping, key management, and retention controls.
- Risk scores and device fingerprints are support signals and require calibration, privacy review, and false-positive monitoring before production use.
- The committed MCP delivery is a local `stdio` server for the controlled agent simulator. A remote Streamable HTTP endpoint is time-boxed stretch work, is never anonymous, and does not include a general-purpose OAuth authorization server or third-party client provisioning.
- The SDK is an internal workspace package. Package publication, semantic-version support for external consumers, and a public developer portal are outside the MVP.
- The recurrence MVP supports typed daily, weekly, and monthly schedules with a local-time execution window. It does not promise arbitrary natural-language schedules or real-world delivery guarantees.

## 20. Success criteria

The project succeeds if judges can independently create, activate, alter, revoke, and challenge mandates, complete a deterministic payment or recurring run, and inspect the evidence. Each action must produce the expected decision without a team member changing code, data, or configuration.

## 21. Hackathon scope and technical implementation decisions

The committed scope assumes four people working during a 20-hour hackathon (roughly 80 person-hours of capacity). It is a vertical slice with two merchants, one principal, one registered agent, a test-only card method, and a small canonical taxonomy. The MCP `stdio` integration, dynamic recurrence, routing/failure scenarios, passkey approval, and resettable demo are committed. A remote MCP HTTP endpoint, elaborate dispute UX, additional merchants/gateways, and any generic OAuth interoperability are stretch work and must not delay the safety circuit.

Suggested parallel workstreams are:

1. **Policy and data:** contracts, registry, taxonomy, migrations, policy tests, audit protections, and recurrence state.
2. **Commerce and SDK:** both merchant mocks, quote signatures, normalizer, internal SDK, and agent simulator.
3. **Payment safety:** hosted test Vault, Mock Yuno router, card gateways, saga, idempotency, reconciliation, and revocation.
4. **Principal experience:** Next.js UI, Supabase session, passkey approvals, MCP `stdio`, deployment, reset controls, and end-to-end rehearsal.

The accepted implementation stack, API boundaries, identity design, Supabase data rules, library choices, and build order are documented in [Technical Architecture and Stack Decisions](technical-architecture.md). This document remains the product and delivery source of truth; the technical decision record constrains implementation choices without changing the product guarantees above.
