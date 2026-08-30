# Route and endpoint inventory

This inventory is the canonical map of the AgentPay web application and the isolated V2 services. It is intentionally more complete than `sitemap.xml`.

The documentation site at `/docs` is public canonical content and is listed in `sitemap.xml`; its pages come from `components/docs/nav.ts`, so adding a docs page updates this inventory's sitemap automatically. Add the route to the table below in the same change.

`sitemap.xml` is for public canonical HTML pages only. It must not enumerate API operations, OAuth/session flows, dynamic approval links, payment setup, MCP transport or registry endpoints. `robots.txt` therefore disallows those paths from generic crawlers; this is crawl guidance, not an authorization mechanism.

## Public web routes

| Route | Purpose | Sitemap | Crawl policy |
|---|---|---:|---|
| `/` | Public landing page: what AgentPay does for a buyer, plus the merchant entry point. | Yes | Allowed |
| `/connect` | Connect an agent: one-click instructions per assistant. | Yes | Allowed |
| `/store` | Public AutoParts merchant demonstration. | Yes | Allowed |
| `/docs` | Merchant documentation: introduction and integration overview. | Yes | Allowed |
| `/docs/quickstart` | Six-step integration from merchant registration through checkout verification. | Yes | Allowed |
| `/docs/installation` | SDK requirements, one-command installer and manual install. | Yes | Allowed |
| `/docs/stores` | Merchant console, hosted test-store URLs and supported live-store policy. | Yes | Allowed |
| `/docs/discovery` | Publishing `/.well-known/agentpay.json`. | Yes | Allowed |
| `/docs/checkout` | Protecting a checkout route and handling each decision. | Yes | Allowed |
| `/docs/frameworks` | Route code for Next.js, Hono, Express, Fastify and edge runtimes. | Yes | Allowed |
| `/docs/testing` | Offline signed-request tests and the live revocation rehearsal. | Yes | Allowed |
| `/docs/reference` | Exported functions and types of `@agentpay/merchant-sdk`. | Yes | Allowed |
| `/docs/reference/protocol` | Signed request format and the four registry endpoints. | Yes | Allowed |
| `/docs/reference/decisions` | Decisions and reason codes. | Yes | Allowed |
| `/docs/troubleshooting` | Common integration failures and fixes. | Yes | Allowed |
| `/dashboard` | Account summary: month-to-date charges, active mandates and recent activity. | No | Disallowed |
| `/activity` | Full purchase-attempt history with the mandate decision on each. | No | Disallowed |
| `/account` | Compliance and delivery profile plus complete saved-card management. | No | Disallowed |
| `/audit` | Security log: every account decision, hash-chained. | No | Disallowed |
| `/payment-methods/setup?token=...` | User-bound hosted payment setup callback. | No | Disallowed |
| `/m` | Mobile signing and revocation inbox. | No | Disallowed |
| `/m/mandates/:id` | Mobile mandate signing and revocation screen. | No | Disallowed |
| `/m/approvals/:id` | Mobile one-time exception decision screen. | No | Disallowed |
| `/oauth/consent` | OAuth consent flow. | No | Disallowed |
| `/developers` | Developer overview with merchant, catalog, attempt and test-volume metrics. | No | Disallowed |
| `/developers/merchants` | Owned merchant integrations. | No | Disallowed |
| `/developers/merchants/new` | Create a hosted test merchant or register a live store. | No | Disallowed |
| `/developers/merchants/:id` | Integration checklist, endpoints, products, keys, activity and settings for one owned merchant. | No | Disallowed |
| `/developers/stores` | Human view of verified live stores and their public URLs. | No | Disallowed |
| `/stores/:id` | Shareable hosted test storefront. Exact URL only; test stores are not publicly listed. | No | Disallowed |

## Discovery and agent connection

| Method | Endpoint | Consumer | Purpose |
|---|---|---|---|
| `GET` | `/.well-known/agentpay.json` | Agent on a merchant domain | Merchant-owned AgentPay manifest for the AutoParts demo. A real merchant publishes its own manifest. |
| `GET`, `OPTIONS` | `/.well-known/oauth-protected-resource` | MCP client | OAuth protected-resource metadata for AgentPay MCP. |
| `GET`, `OPTIONS` | `/.well-known/oauth-protected-resource/mcp` | MCP client | Alias of the protected-resource metadata for the MCP endpoint. |
| `GET`, `POST` | `/mcp` | OAuth-authenticated MCP client | Streamable HTTP MCP server. Exposes `get_account`, `get_payment_setup_link`, `create_mandate`, `get_mandate`, `purchase` and `revoke_mandate`. |
| `GET` | `/api` | Developer or health-style discovery client | JSON description of the AgentPay MCP, OAuth metadata and merchant-discovery model. |
| `GET` | `/api/stores` | Agent, developer or public client | Opt-in verified live-store IDs, store URLs and discovery URLs. Returns an empty list until a real live merchant qualifies. It contains no product catalog. |
| `GET` | `/api/stores/:id` | Hosted test-store client | Exact-ID hosted store metadata and active products. |
| `GET` | `/api/stores/:id/agentpay.json` | Agent testing a hosted store | AgentPay manifest for an exact hosted test merchant. |
| `POST` | `/api/stores/:id/checkout` | Signed agent request | Dynamic merchant-SDK checkout for an exact active hosted merchant. |

## Application API

All application API routes are same-origin service endpoints. Routes that mutate user state require the applicable authenticated session and/or passkey ceremony; they are not public integration APIs.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET`, `PATCH` | `/api/account` | Read or update the user-owned compliance and fulfillment profile plus account state. |
| `POST` | `/api/cards` | Save non-sensitive payment-method display metadata and an opaque mock-vault reference. The first card becomes the default. |
| `PATCH`, `DELETE` | `/api/cards/:id` | Set an owned card as default or remove it when no draft/active mandate is bound to it. |
| `POST` | `/api/checkout` | Execute the deployed demo checkout path. A test-only request may use a bounded pre-settlement revocation window; the final database decision always rechecks live mandate state. |
| `GET`, `POST` | `/api/mandates` | List mandates or create a draft mandate. Mandates are only ever created by an agent through MCP; the web app has no manual creation form. |
| `GET` | `/api/mandates/:id` | Read a mandate. |
| `GET`, `POST` | `/api/mandates/:id/authorize` | Fetch a passkey challenge or authorize the mandate. |
| `POST` | `/api/mandates/:id/decline` | Decline a draft mandate. |
| `PATCH` | `/api/mandates/:id/limits` | Update a mandate's permitted limits. |
| `PATCH` | `/api/mandates/:id/payment` | Switch the saved card on a draft mandate before passkey authorization. |
| `POST` | `/api/mandates/:id/revoke` | Revoke a mandate immediately. |
| `GET` | `/api/mandates/:id/status` | Read live mandate status for the UI. |
| `POST` | `/api/approvals/:id/authorize` | Get or verify the passkey ceremony for a one-time exception. |
| `POST` | `/api/approvals/:id/decide` | Approve or deny a one-time exception. |
| `POST` | `/api/passkeys/register` | Register a WebAuthn credential. |
| `GET` | `/api/state` | Read the authenticated demo state. |
| `POST` | `/api/store/checkout` | AutoParts demo store checkout. |

## Merchant console API

Browser routes require a Supabase-authenticated owner session and remain protected by merchant ownership RLS. Server-side catalog creation accepts a one-time-revealed high-entropy key; only its SHA-256 hash is stored.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET`, `POST` | `/api/developers/merchants` | List owned merchants with metrics or create a hosted/external merchant identity. |
| `GET`, `PATCH` | `/api/developers/merchants/:id` | Read the complete owned integration or update mutable settings. |
| `POST` | `/api/developers/merchants/:id/verify` | Verify that a live public HTTPS manifest names the assigned merchant ID. Redirects and private network destinations are refused. |
| `GET`, `POST` | `/api/developers/merchants/:id/products` | List or create products in an owned catalog. |
| `PATCH`, `DELETE` | `/api/developers/merchants/:id/products/:productId` | Update or remove an owned product. |
| `GET`, `POST` | `/api/developers/merchants/:id/keys` | List key metadata or mint a key whose plaintext is returned once. |
| `DELETE` | `/api/developers/merchants/:id/keys/:keyId` | Revoke a merchant API key immediately. |
| `GET`, `POST` | `/api/v1/merchants/:id/products` | Read an active public catalog or create a product with a merchant bearer key. |

## Merchant verification registry

These narrowly scoped endpoints are a public protocol boundary for stores that have already received a signed request. They return exact-ID registry projections, not arbitrary user data.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/registry/agents/:id` | Read an exact agent verification key. |
| `GET` | `/api/registry/keys` | Read current AgentPay registry verification keys. |
| `GET` | `/api/registry/mandates/:id` | Read an exact signed mandate and its live status. |
| `POST` | `/api/registry/nonces` | Consume a signed request nonce to prevent replay. |

## Isolated V2 services

The following Hono applications are source-level services in this branch. They are intentionally not mounted into the production Next application until their durable Supabase adapters and deployment boundaries are configured. Their interfaces are listed for integration and manual test planning, not as already deployed public endpoints.

### Mock merchant APIs

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Service health check. |
| `POST` | `/v1/agents-pay/search` | Search the merchant's own mock catalog. |
| `POST` | `/v1/agents-pay/quotes` | Create a signed, time-bound merchant quote. |
| `GET` | `/v1/agents-pay/quotes/:quoteId` | Retrieve an issued quote. |
| `POST` | `/v1/agents-pay/orders/:merchantOrderRef/verification` | Verify and atomically claim an order for one settlement attempt. |

### Mandate service

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Service health check. |
| `POST` | `/v1/agent/intents` | Evaluate a signed agent purchase intent against a mandate and issue a scoped capability or escalation. |
| `POST` | `/v1/merchant/verifications` | Verify a merchant order and coordinate authorization/capture state. |
| `POST` | `/v1/mandates/:mandateId/revocations` | Revoke a mandate and trigger the defined authorization/capture outcome. |

### Hosted test-payment Vault

| Method | Endpoint | Consumer | Purpose |
|---|---|---|---|
| `GET` | `/health` | Operator | Service health check. |
| `GET`, `POST` | `/hosted/test-payment-methods/setup` | User browser | Hosted test-payment-method setup form. |
| `POST` | `/internal/v1/hosted-setup-sessions` | Mandate service | Create a short-lived hosted setup session. |
| `POST` | `/internal/v1/hosted-setup-sessions/:sessionId/exchange` | Mandate service | Exchange the browser callback code for safe payment-method metadata. |
| `POST` | `/internal/v1/payment-methods/test` | Controlled test setup | Create a deterministic test payment method. |
| `POST` | `/internal/v1/payment-authorizations` | Mandate service | Authorize a mock payment with an idempotency key. |
| `GET` | `/internal/v1/payment-authorizations/:authorizationId` | Mandate service | Reconcile an authorization after a timeout. |
| `POST` | `/internal/v1/payment-authorizations/:authorizationId/capture` | Mandate service | Capture a prior authorization. |
| `POST` | `/internal/v1/payment-authorizations/:authorizationId/void` | Mandate service | Void an uncaptured authorization. |

The Vault accepts service-authenticated internal calls only. It never accepts card details through the agent, MCP, merchant API or a browser callback to the mandate service.

## HTTP conventions

- Mutation endpoints use idempotency keys where the protocol requires them; retries must reuse the same key and request body.
- Internal V2 calls use signed request proofs, request IDs and audience-bound verification. The agent and merchant never receive Vault credentials or provider tokens.
- The route inventory describes reachability, not permission. Every caller must still satisfy the authentication, passkey, signature, policy, replay and live-revocation checks defined in [the architecture](architecture.md) and [decision log](decisions.md).
