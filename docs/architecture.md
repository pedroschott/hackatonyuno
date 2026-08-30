# AgentPay architecture

```mermaid
sequenceDiagram
    actor User
    participant Agent as Claude / ChatGPT / MCP client
    participant AgentPay as AgentPay on Vercel
    participant Auth as Supabase Auth + OAuth
    participant Registry as Supabase mandate registry
    participant Store as Store + merchant SDK
    participant Console as Merchant console

    Store->>Console: Sign in and create merchant
    Console->>Registry: Persist owner-bound merchant ID with RLS
    Console-->>Store: ID, test store, manifest, checkout URL and API key

    User->>Agent: Find and buy a product within my limits
    Agent->>Store: Search or use the store's product tools
    Store-->>Agent: Product URL and details
    Agent->>Store: GET /.well-known/agentpay.json
    Store-->>Agent: Store-owned checkout and registry URLs
    Agent->>AgentPay: Connect /mcp
    AgentPay-->>Agent: OAuth protected-resource metadata
    Agent->>Auth: OAuth authorization + PKCE
    Auth->>User: AgentPay sign-in and consent screen
    User->>AgentPay: Create account/passkey if needed
    Auth-->>Agent: Access token
    Agent->>AgentPay: get_account
    AgentPay-->>Agent: Order profile + saved-card metadata + default
    Agent->>AgentPay: create_mandate
    AgentPay->>Registry: Save draft mandate
    AgentPay-->>Agent: approval_url
    User->>AgentPay: Review or switch the draft's saved card
    User->>AgentPay: Approve mandate with passkey
    AgentPay->>Registry: Verify WebAuthn and co-sign active mandate
    Agent->>AgentPay: purchase
    AgentPay->>Store: Signed checkout request
    Store->>Registry: Fetch signed live status
    Store->>Store: Verify signatures, nonce and policy
    Store-->>AgentPay: Verification result
    AgentPay->>Registry: Final atomic status + policy check
    Registry-->>AgentPay: Mock single-use payment token
    AgentPay-->>Agent: Approved purchase
    User->>Agent: Stop buying
    Agent->>AgentPay: revoke_mandate
    AgentPay->>Registry: Revoke immediately
```

Checkout settlement and revocation use the same per-mandate transaction lock. A revocation that commits before the final check produces `MANDATE_REVOKED` and no token, including when the checkout began earlier.

## Trust boundaries

- The agent proposes scope and purchase details but cannot approve its own authority.
- Supabase Auth owns user sessions and OAuth grants. AgentPay stores WebAuthn public credentials, never private passkey material.
- The registry signs canonical mandates and exposes only the exact signed records required for merchant verification.
- The store owns products, discovery and checkout. The SDK checks live revocation on every purchase.
- The merchant console owns onboarding, not purchase authority. Supabase RLS binds each merchant, catalog, API-key hash and merchant-side attempt view to its developer owner. Hosted test stores are immediately usable but never publicly listed.
- Developer SQL privileges cannot write `agent_ready` or verification columns. Live verification is fetched server-side with SSRF protections, then a narrowly scoped owner-bound function requires AgentPay's server-only proof before recording the result; changing a live store URL automatically clears verification and public listing.
- The payment rail is the only mocked boundary. The mock token is issued only after the real authorization and enforcement path succeeds and is bound to the card ID inside the signed mandate.
- Compliance and delivery fields are user-owned RLS data. They are available only through the authenticated account/MCP connection and never enter public registry projections or payment tokens.
