# Agentic Mandates: Product and Delivery Plan

## 1. Product thesis

**Agentic Mandates** is a trust layer for purchases made by software agents on behalf of people or organizations. It does not give an agent a card number or a standing, unrestricted ability to spend. It gives the agent a **bounded, verifiable, revocable capability** to complete a specific purchasing intent.

The product is intentionally vertical-agnostic. The same primitives work for travel, procurement, subscriptions, retail replenishment, utilities, insurance, software licenses, or any merchant accepting agent-initiated payments.

> An agent may propose and execute a purchase; a deterministic policy engine decides whether the purchase is allowed.

## 2. Demo promise

The demo must prove all of the following without manual database edits or developer intervention:

1. A principal creates a mandate for a named agent without sharing raw payment credentials.
2. The agent discovers and selects an offer within that mandate.
3. The merchant verifies the agent, mandate, offer, and one-time purchase capability before accepting payment.
4. An out-of-policy attempt is rejected or requires the principal's approval; it is never silently accepted.
5. Revocation takes effect immediately: the next verification fails.
6. The principal, merchant, and auditor each see an appropriate view of the same evidence.

The payment settlement and product catalog may be simulated. The authorization decision, cryptographic bindings, revocation, policy evaluation, and audit trail must be real application behavior.

## 3. Roles and trust boundaries

| Role | Responsibility | Must not receive |
| --- | --- | --- |
| Principal | Creates, changes, approves, disputes, and revokes mandates. | Raw merchant-side payment data or unnecessary agent internals. |
| Purchasing agent | Searches, compares, requests approval, and submits a candidate purchase. | Raw PAN/card details, reusable payment credentials, or authority outside its mandate. |
| Mandate service | Stores mandates, evaluates policies, issues capabilities, records audit events, and handles revocation. | Long-lived user secrets in logs. |
| Merchant | Builds an order and asks the mandate service whether it is authorized. | The principal's full mandate, purchase history, or payment credentials. |
| Payment provider / Yuno adapter | Tokenizes the payment method and captures an approved payment. | More personal data than required to process settlement. |
| Auditor / dispute reviewer | Reviews access-controlled evidence and decision history. | Data outside the relevant case or retention period. |

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
  paymentMethodTokenRef: string; // PSP/Yuno token reference only
  policy: PurchasePolicy;
  validFrom: string;
  validUntil: string;
  createdAt: string;
  revokedAt?: string;
};
```

### 4.2 Purchase intent

The structured request the agent wants to satisfy. Natural language is allowed as input to discovery, but the policy engine must receive normalized fields, canonical amounts, currency, merchant, line items, and a content hash.

```ts
type PurchaseIntent = {
  merchantId: string;
  category: string;
  amountMinor: number;
  currency: string;
  lineItems: Array<{ sku: string; name: string; quantity: number; unitAmountMinor: number }>;
  attributes: Record<string, string | number | boolean>;
  cartHash: string;
};
```

### 4.3 One-time purchase capability

A short-lived signed authorization issued only after the current policy passes. It is bound to one agent, one merchant, one canonical purchase intent, an amount ceiling, a nonce, and a short expiry. It cannot be reused for another cart or merchant.

```ts
type PurchaseCapability = {
  id: string;
  mandateId: string;
  mandateVersion: number;
  agentId: string;
  merchantId: string;
  cartHash: string;
  maxAmountMinor: number;
  currency: string;
  nonce: string;
  expiresAt: string;
  oneTimeUse: true;
  signature: string;
};
```

### 4.4 Verification result

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

The UI should start with understandable presets, then expose an advanced policy editor. Each field is optional unless marked otherwise; omitted fields mean “not constrained” only when the risk owner explicitly permits it.

| Policy area | Example fields |
| --- | --- |
| Identity and scope | permitted `agentId`, merchant allow/deny lists, merchant trust tier, category taxonomy, organization/cost center, country or region. |
| Item constraints | SKU/service allow list, forbidden add-ons, quantity ceiling, compatibility or quality attributes, warranty/refund requirements. |
| Financial limits | per-purchase maximum, total budget, daily/weekly/monthly budget, currency allow list, tax/shipping/fees inclusion, FX tolerance, split-payment prohibition. |
| Time and cadence | validity interval, allowed hours, maximum uses, interval between purchases, recurrence period and maximum count. |
| Intent-specific attributes | arbitrary validated attributes such as delivery date, service region, supplier rating, sustainability score, cancellation policy, or contract duration. |
| Autonomy thresholds | auto-approve below a value, require approval above a threshold, require approval for a new merchant/category, or always require approval for a first purchase. |
| Risk controls | known-device requirement, step-up authentication, velocity threshold, merchant verification level, geographic anomaly handling. |
| Privacy | data disclosure profile, receipt retention period, whether a merchant may see a pseudonymous principal reference. |
| Dispute terms | dispute window, evidence visibility, preferred remedy, and organization-specific escalation owner. |

### Example policy

```json
{
  "merchant": { "allow": ["merchant_demo"], "minTrustTier": "verified" },
  "categories": { "allow": ["business.supplies", "software.subscription"] },
  "money": {
    "perPurchaseMaxMinor": 15000,
    "monthlyMaxMinor": 45000,
    "currencies": ["USD"],
    "includeFees": true
  },
  "usage": { "maxPurchasesPerMonth": 3, "minIntervalHours": 24 },
  "items": { "forbidAttributes": { "autoRenew": true, "giftCard": true } },
  "autonomy": { "autoApproveMaxMinor": 12000, "aboveThat": "human_approval" },
  "risk": { "requireKnownAgentKey": true, "maxRiskScore": 40 }
}
```

## 6. Policy evaluation and guardrails

### Non-negotiable design rule

LLMs may interpret user input, search catalogs, compare offers, and write an explanation. They must not be the final authorizer. The final decision is a deterministic, testable function of normalized request data, the active mandate version, current usage counters, revocation state, and risk signals.

### Evaluation order

1. Authenticate the agent and validate its signed request, timestamp, and nonce.
2. Load the latest mandate state; reject inactive, expired, paused, or revoked mandates.
3. Confirm the agent, principal context, and merchant match the mandate.
4. Canonicalize the cart and compute its hash; validate category, items, quantities, attributes, and destination/service fields.
5. Evaluate total amount in minor units, including required taxes, shipping, fees, and converted currency.
6. Atomically check usage, recurrence, velocity, and remaining budget.
7. Evaluate risk signals and merchant eligibility.
8. Return `rejected`, `approval_required`, or issue a one-time capability.
9. At payment capture, verify again and atomically consume the capability. Recheck revocation and cart hash immediately before capture.

Every rejected or escalated decision must return stable reason codes, for example `AMOUNT_EXCEEDED`, `FORBIDDEN_CATEGORY`, `CART_CHANGED`, `CAPABILITY_REPLAYED`, `MANDATE_REVOKED`, or `HUMAN_APPROVAL_REQUIRED`.

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

1. The agent submits a complete, immutable purchase intent.
2. If the policy returns `approval_required`, create an approval request containing the canonical cart hash, item summary, final total, merchant, reasons, and expiry.
3. Notify the principal. The approval screen shows exactly what will be purchased and why it needs approval.
4. The principal approves with a simulated passkey/biometric confirmation or rejects it.
5. Approval issues a new short-lived one-time capability bound to the same cart hash. Any cart alteration invalidates it.
6. Revocation or expiration invalidates outstanding approval requests and capabilities.

Mandatory hard failures, such as revocation, invalid signature, replay, forbidden category, or expired mandate, must never be bypassed through a normal approval flow.

## 8. Payment tokenization and sensitive-data handling

### Tokenization model

- Capture payment details only through a hosted payment field, provider SDK, or Yuno-compatible tokenization adapter.
- Store only a provider token reference and display-safe metadata such as network and last four digits.
- Never send raw PAN, CVV, or reusable payment credentials to the purchasing agent, browser logs, audit log, merchant verification payload, or application database.
- The mandate service exchanges its server-side token reference with the provider only after merchant verification succeeds.
- A purchase capability is not a payment token. It authorizes a narrowly scoped action; it cannot independently charge a payment method.

### Data minimization

- The merchant sees a signed verification result, a pseudonymous principal reference when needed, and only the policy facts required to accept the order.
- The auditor sees relevant evidence only after role and case authorization.
- The principal has full visibility into their mandates and transactions.
- Encrypt sensitive references at rest, use TLS in transit, redact logs by default, and define retention/deletion windows for receipts and audit metadata.

## 9. Agent identity, anti-fraud, and adversarial controls

Use an agent identity separate from the principal's identity. Each agent has an `agentId` and a registered public key. Requests are signed (JWS or equivalent) and include a short timestamp, request ID, and nonce.

Controls to implement or simulate visibly:

- Signature verification and key rotation/revocation.
- Short-lived, one-time capability with atomic consumption.
- Binding of capability to merchant, agent, canonical cart hash, currency, amount, and expiration.
- Replay protection using nonce and consumed-capability state.
- Rate limits and velocity limits per mandate, agent, principal, and merchant.
- Merchant identity allow list and trust tier.
- Device/session fingerprint as a risk signal only, never the sole authorization factor.
- Step-up principal authentication for mandate creation, mutation, revocation, and sensitive approval.
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

Revocation is synchronous policy state, not a suggestion for agents to honor later.

- The principal revokes a mandate through an authenticated action.
- The service marks it revoked immediately and emits a realtime event to the UI.
- Every merchant verification and every payment-capture verification reads current revocation state.
- Cache entries must be invalidated or version-checked; do not rely on a long-lived JWT alone.
- Previously issued capabilities are invalid once their mandate is revoked, even if their own expiry has not passed.

The live demo must perform: **revoke → repeat identical purchase → verification returns `MANDATE_REVOKED`**.

## 11. Auditing, evidence, and disputes

Create append-only audit events with a correlation ID, actor, event type, timestamp, sanitized payload, previous-event hash, and current-event hash. A cryptographic hash chain is enough for a hackathon demonstration; it makes tampering visible without claiming a full legal ledger.

Required event types:

- `mandate.created`, `mandate.updated`, `mandate.revoked`
- `agent.request_received`, `policy.evaluated`, `approval.requested`, `approval.resolved`
- `capability.issued`, `capability.verified`, `capability.consumed`
- `payment.authorized`, `payment.captured`, `payment.failed`
- `dispute.opened`, `dispute.evidence_reviewed`, `dispute.resolved`

For a dispute, render a timeline showing the mandate version, policy decision, signed agent request, cart hash, principal approval (if any), payment result, and whether revocation occurred before capture. The system should make a reasoned determination: purchase was authorized under the recorded mandate, or the platform/merchant violated the mandate and should reverse it.

## 12. Minimum viable architecture

```text
Principal dashboard ─┐
Agent simulator ─────┼─> API / Mandate service ─> Policy engine
Merchant console ────┘           │                    │
                                 │                    ├─> Capability signer/verifier
                                 │                    ├─> Usage and revocation store
                                 │                    └─> Audit event store
                                 │
                                 ├─> Realtime notifications
                                 └─> Payment adapter (mocked Yuno/PSP token capture)
```

Suggested application modules:

| Module | Responsibility |
| --- | --- |
| Mandates | CRUD, versions, activation, revocation, policy schema validation. |
| Agent gateway | Agent authentication, signed request verification, rate limiting. |
| Policy engine | Pure deterministic evaluator with unit tests and reason codes. |
| Capabilities | Signing, verification, expiration, atomic one-time use. |
| Merchant verification | Minimal verification API and merchant-facing decision UI. |
| Payment adapter | Provider token reference and mock capture lifecycle. |
| Approvals | Human approval requests and step-up confirmation. |
| Audit and disputes | Append-only timeline, evidence views, resolution state. |

## 13. Suggested screens

1. **Principal dashboard:** active mandates, remaining budget/uses, recent purchases, revoke action.
2. **Create mandate:** plain-language form with an “advanced rules” section and a generated summary.
3. **Agent console:** discovered offers, decision rationale, submit purchase, attack-mode toggles.
4. **Approval inbox:** immutable purchase summary, approve/reject, expiration timer.
5. **Merchant console:** verification badge, minimal proof, decision reason, capture action.
6. **Auditor timeline:** correlated events, policy diff, evidence, dispute outcome.

## 14. Delivery plan

### Phase 1 — Domain foundation

- Define the mandate, policy, purchase intent, capability, verification, and audit schemas.
- Build a pure policy evaluator with fixture-based tests.
- Implement normalized money handling in integer minor units and canonical cart hashing.
- Seed two merchants, several products/services, one principal, and one agent.

**Done when:** a test can prove approval, rejection, escalation, expiration, and usage limits without a UI.

### Phase 2 — Safe authorization circuit

- Implement mandate creation, versioning, activation, and revocation.
- Implement signed agent requests and capability issuance/consumption.
- Build merchant verification and mocked payment capture.
- Guarantee atomic check-and-consume behavior for usage counters and capabilities.

**Done when:** a valid request purchases once, and replay or cart substitution fails.

### Phase 3 — Human controls and visibility

- Add approval-request flow and immutable cart binding.
- Add principal, agent, merchant, and auditor views.
- Add Policy Diff explanations and realtime revocation feedback.

**Done when:** a user can approve an escalated purchase and revoke a mandate live.

### Phase 4 — Trial by fire and polish

- Add the adversarial attack scenarios.
- Add dispute timeline and outcome logic.
- Rehearse the demo from a fresh dataset; ensure no developer action is needed.
- Document architecture, decisions, security model, setup, and known limitations.

**Done when:** every challenge scenario produces an immediate, explainable, auditable result.

## 15. Demo script

1. The principal creates a mandate for a specific agent, category, merchant set, budget, cadence, and approval threshold.
2. The agent finds an eligible offer and requests authorization.
3. The policy engine approves; the merchant sees a minimal verification result and captures using a mock payment token.
4. Each party opens its record: principal receipt, merchant verification, auditor event timeline.
5. The agent tries a prohibited or over-budget purchase. Show the Policy Diff and rejection.
6. Try a purchase that is permitted only with human approval. Approve it, then demonstrate that changing the cart invalidates the approval.
7. Revoke the mandate live and retry an otherwise valid purchase. It fails immediately.
8. Run a replay or merchant-substitution attack; show the capability binding prevents it.
9. Open a dispute and use the evidence timeline to resolve it.

## 16. Decision log

| Decision | Chosen approach | Alternatives considered | Why |
| --- | --- | --- | --- |
| Final authorization | Deterministic policy engine | LLM-only approval | Policies must be testable, repeatable, and safe against prompt injection. |
| Payment access | Provider token reference plus one-time capability | Give agent a virtual card or raw payment token | Separates settlement credential from authority and limits blast radius. |
| Merchant proof | Minimal signed verification | Send the full mandate | Supports verifiability while minimizing personal data exposure. |
| Revocation | Online state check at verification/capture | Long-lived self-contained token only | A token alone cannot guarantee immediate revocation. |
| Identity | Separate principal and agent identities with signed requests | One shared user session | Enables attribution, least privilege, and agent-key revocation. |
| Fingerprinting | Secondary risk signal | Primary proof of authority | Fingerprints are probabilistic and can change or be spoofed. |
| Audit integrity | Append-only hash-chained events | Mutable transaction log | Gives a clear, demoable tamper-evidence property. |
| HITL | Contextual, cart-bound approval | Blanket approvals or broad overrides | Keeps autonomy useful without turning approval into an unrestricted bypass. |

## 17. Non-goals and honest limitations

- This MVP does not claim PCI certification, legal enforceability, or real card-network chargeback integration.
- A mock payment adapter proves the authorization circuit; a production integration requires Yuno/PSP API credentials, provider-specific webhooks, PCI scope review, and merchant onboarding.
- A hash chain provides tamper evidence within the system; production-grade independent auditability may require external timestamping, key management, and retention controls.
- Risk scores and device fingerprints are support signals and require calibration, privacy review, and false-positive monitoring before production use.

## 18. Success criteria

The project succeeds if judges can independently create, alter, revoke, and challenge mandates, and each action produces the expected decision without a team member changing code, data, or configuration.
