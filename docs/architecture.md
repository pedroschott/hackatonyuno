# AgentPay architecture

```mermaid
sequenceDiagram
    actor User
    participant Agent as Claude / ChatGPT / MCP client
    participant AgentPay as AgentPay on Vercel
    participant Auth as Supabase Auth + OAuth
    participant Registry as Supabase mandate registry
    participant Store as Store + merchant SDK

    User->>Agent: Find and buy a product within my limits
    Agent->>Store: Search or use the store's product tools
    Store-->>Agent: Product URL and details
    Agent->>Store: GET /.well-known/agentpay.json
    Store-->>Agent: Store-owned catalog, checkout, MCP and registry URLs
    Agent->>Store: GET catalog_endpoint
    Store-->>Agent: Stable product IDs, categories, prices and availability
    Agent->>AgentPay: Connect /mcp
    AgentPay-->>Agent: OAuth protected-resource metadata
    Agent->>Auth: OAuth authorization + PKCE
    Auth->>User: AgentPay sign-in and consent screen
    User->>AgentPay: Create account/passkey if needed
    Auth-->>Agent: Access token
    Agent->>AgentPay: create_mandate
    AgentPay->>Registry: Save draft mandate
    AgentPay-->>Agent: approval_url
    User->>AgentPay: Approve mandate with passkey
    AgentPay->>Registry: Verify WebAuthn and co-sign active mandate
    Agent->>AgentPay: purchase
    AgentPay->>Store: Signed checkout request
    Store->>Registry: Fetch signed live status
    Store->>Store: Verify signatures, nonce and policy
    Store-->>AgentPay: Mock single-use payment token
    AgentPay-->>Agent: Approved purchase
    User->>Agent: Stop buying
    Agent->>AgentPay: revoke_mandate
    AgentPay->>Registry: Revoke immediately
```

## Trust boundaries

- The agent proposes scope and purchase details but cannot approve its own authority.
- Supabase Auth owns user sessions and OAuth grants. AgentPay stores WebAuthn public credentials, never private passkey material.
- The registry signs canonical mandates and exposes only the exact signed records required for merchant verification.
- The store owns products, discovery and checkout. The SDK checks live revocation on every purchase.
- The merchant manifest is the machine contract. Agents copy product IDs from its live catalog endpoint rather than deriving them from display names, SKUs or URLs.
- The payment rail is the only mocked boundary. The mock token is issued only after the real authorization and enforcement path succeeds.
