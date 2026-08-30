# AgentPay architecture

```mermaid
sequenceDiagram
    actor User
    participant Agent as Claude / ChatGPT / MCP client
    participant AgentPay as AgentPay on Vercel
    participant Auth as Supabase Auth + OAuth
    participant Didit as Didit identity + fraud verification
    participant Registry as Supabase mandate registry
    participant Store as Store + merchant SDK
    participant Console as Merchant console

    Store->>Console: Sign in and create merchant
    Console->>Registry: Persist owner-bound merchant ID with RLS
    Console-->>Store: ID, test store, manifest, checkout URL and API key

    User->>Agent: Find and buy a product within my limits
    Agent->>Store: Search or open a product page
    Store-->>Agent: Product URL
    Agent->>AgentPay: Connect /mcp
    AgentPay-->>Agent: OAuth protected-resource metadata
    Agent->>Auth: OAuth authorization + PKCE
    Auth->>User: AgentPay sign-in and consent screen
    User->>AgentPay: Create account/passkey if needed
    User->>AgentPay: Consent to identity and fraud verification
    AgentPay->>Didit: Create hosted v3 session (server API key)
    Didit-->>User: Document, liveness and configured risk checks
    Didit->>AgentPay: HMAC-signed status webhook
    AgentPay->>Registry: Store minimal decision state
    Auth-->>Agent: Access token
    Agent->>AgentPay: get_account
    AgentPay-->>Agent: Order profile + saved-card metadata + next step
    Agent->>AgentPay: find_products(store URL)
    AgentPay->>Store: GET /.well-known/agentpay.json
    Store-->>AgentPay: Checkout, catalog, categories, currency
    AgentPay->>Store: GET catalog_endpoint?q=…
    Store-->>AgentPay: Exact product ids, categories, prices
    AgentPay-->>Agent: Products + mandate_hint
    Agent->>AgentPay: create_mandate(merchant_urls, categories, limits)
    AgentPay->>Store: Resolve ids, check categories against catalog
    AgentPay->>Registry: Save draft mandate
    AgentPay-->>Agent: authorization_url
    User->>AgentPay: Review or switch the draft's saved card
    User->>AgentPay: Approve mandate with passkey
    AgentPay->>Registry: Require latest Didit decision to pass
    AgentPay->>Registry: Verify WebAuthn and co-sign active mandate
    Agent->>AgentPay: check_purchase (dry run, nothing recorded)
    AgentPay-->>Agent: would_be approved / escalated / refused + remedy
    Agent->>AgentPay: purchase
    AgentPay->>Registry: Recheck latest Didit decision
    AgentPay->>Store: Signed checkout request
    Store->>Registry: Fetch signed live status
    Store->>Store: Verify signatures, nonce and policy
    Store-->>AgentPay: Verification result
    AgentPay->>Registry: Final atomic status + policy check
    Registry-->>AgentPay: Mock single-use payment token
    AgentPay-->>Agent: Decision + explanation, remedy, next_tool
    Agent->>AgentPay: amend_mandate (only if scope or limits fell short)
    AgentPay->>Registry: Save replacement draft that supersedes the old id
    User->>AgentPay: Sign replacement with passkey → old mandate revoked
    User->>Agent: Stop buying
    Agent->>AgentPay: revoke_mandate
    AgentPay->>Registry: Revoke immediately
```

Checkout settlement and revocation use the same per-mandate transaction lock. A revocation that commits before the final check produces `MANDATE_REVOKED` and no token, including when the checkout began earlier.

## Trust boundaries

- The agent proposes scope and purchase details but cannot approve its own authority.
- Supabase Auth owns user sessions and OAuth grants. AgentPay stores WebAuthn public credentials, never private passkey material.
- Didit owns the hosted identity and fraud-verification capture. AgentPay sends a stable opaque user ID, authenticates API calls server-side, validates webhook freshness and HMAC signatures, and persists only session, workflow, environment, decision, and entity-risk state. Full decisions, identity documents, images, and biometric data are not copied into AgentPay.
- A signed webhook is the normal decision path; the authenticated return route re-fetches the decision from Didit as a missed-webhook fallback. Both paths verify that the Didit session is bound to the same Supabase user and configured workflow.
- The MCP and demo checkout paths fail before contacting a merchant when verification is not current. A database trigger independently refuses every approved attempt, so a direct call cannot mint a mock payment token for an unverified, flagged, or blocked account; this also covers mandates that were active before the integration shipped.
- The database gate uses a one-way rollout latch that is enabled only after the deployed server successfully creates its first Didit session. Applying the migration before application deployment therefore leaves the current demo untouched, while a configured deployment cannot silently fall back to unchecked checkout.
- The registry signs canonical mandates and exposes only the exact signed records required for merchant verification.
- The store owns products, discovery, the catalog endpoint and checkout. AgentPay relays the store's catalog answer to the agent and never copies, indexes or ranks it. The SDK checks live revocation on every purchase.
- A dry run (`check_purchase`) uses the same policy engine as settlement but touches neither the merchant nor the attempt table, so exploring what a mandate allows costs nothing and leaves no trace of a purchase that never happened.
- A signed mandate is immutable. An amendment is a replacement draft; signing it is the same request that revokes the mandate it supersedes.
- The merchant console owns onboarding, not purchase authority. Supabase RLS binds each merchant, catalog, API-key hash and merchant-side attempt view to its developer owner. Hosted test stores are immediately usable but never publicly listed.
- Developer SQL privileges cannot write `agent_ready` or verification columns. Live verification is fetched server-side with SSRF protections, then a narrowly scoped owner-bound function requires AgentPay's server-only proof before recording the result; changing a live store URL automatically clears verification and public listing.
- The payment rail is the only mocked boundary. The mock token is issued only after the real authorization and enforcement path succeeds and is bound to the card ID inside the signed mandate.
- Compliance and delivery fields are user-owned RLS data. They are available only through the authenticated account/MCP connection and never enter public registry projections or payment tokens.
