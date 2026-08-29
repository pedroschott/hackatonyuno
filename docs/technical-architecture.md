# Technical Architecture and Stack Decisions

**Status:** Accepted for the hackathon implementation
**Last updated:** 2026-08-29

This document turns the product plan into implementation decisions. The objective is speed without weakening the core proof: an agent can purchase only through a bounded, verifiable, revocable mandate, and never receives a reusable payment credential.

## 1. Decision summary

| Area | Decision | Why |
| --- | --- | --- |
| Language and runtime | TypeScript in strict mode on the current Node.js LTS (Node 22 or newer) | One language across UI, APIs, tests, policy, and mocks. |
| Repository | pnpm workspaces and Turborepo | Multiple independently runnable services with shared contracts. |
| Principal application | Next.js App Router | Fast dashboard, chat, approval screens, Server Components, and browser-facing BFF. |
| Explicit APIs | Hono; `hono/vercel` in deployment and `@hono/node-server` only for local development | Low boilerplate and separately runnable APIs. |
| API contracts | Zod and @hono/zod-openapi; REST JSON under /v1 | One schema validates APIs, LLM tools, and produces OpenAPI docs. |
| UI | Tailwind CSS v4, shadcn/ui, Lucide, React Hook Form, Zod | Fast accessible UI with locally owned component source. |
| Data and user auth | Existing Supabase project: Postgres, Auth, Realtime Broadcast, CLI migrations | Avoid operating database/auth infrastructure. |
| Runtime database access | `postgres` driver with distinct least-privilege Mandate and Vault database roles | Enforces Vault-only token storage without adding an ORM. |
| Conversation | Vercel AI SDK with an OpenAI provider adapter | Streamed conversational intake with Zod-validated tools. |
| Authorization | Pure TypeScript policy package and Postgres transactions | An LLM may propose data but cannot authorize money. |
| Agent request proof | ES256 JWS per request using jose | Proof of possession, replay protection, and no agent cookie. |
| Contract approvals | App-owned WebAuthn with @simplewebauthn/server and @simplewebauthn/browser | Contract-specific passkey evidence; Supabase remains the principal session/identity layer. |
| Canonical hashes | RFC 8785 JSON Canonicalization Scheme via json-canonicalize, then SHA-256 | Stable cart and evidence hashes across services. |
| Rate limiting | Upstash Redis with @upstash/ratelimit | Managed sliding-window limits appropriate for HTTP/serverless services. |
| Payment rails | Test Vault → Mock Yuno router → two deterministic card gateways | Demonstrates routing, decline, timeout, capture failure, and reconciliation without real funds or PIX. |
| Internal integrations | Workspace-only SDK plus `@modelcontextprotocol/server` v2 MCP `stdio` server | Typed reusable clients and a real MCP proof without package publication or a public auth platform. |
| Recurrence | Supabase Cron tick plus idempotent run records | Dynamic schedules from contracts, independent of Vercel Cron plan restrictions. |
| Tests | Vitest, React Testing Library, Playwright | Fast domain/API feedback and end-to-end demo proof. |

Use latest compatible package versions at scaffolding time, pin them, and commit pnpm-lock.yaml. This document intentionally does not freeze package versions because library APIs change faster than architectural decisions.

## 2. Technology rationale

### Next.js for the principal experience

The principal-facing application needs a dashboard, conversational contract intake, approval screens, and evidence views. Next.js App Router provides these screens, authenticated server rendering, and a browser-facing BFF in one app. It is not the authority for agent or merchant requests.

References: [Next.js App Router](https://nextjs.org/docs/app), [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers).

### Hono for the explicit service APIs

Mandate, merchant, and Vault APIs need inspectable HTTP contracts. Hono is selected over NestJS or Fastify because it is lighter and provides Zod validation, OpenAPI generation, and typed RPC support. In local development, `@hono/node-server` may run a listener. On Vercel, every service exports a Fetch handler through `hono/vercel`; no Vercel Function calls `listen()`.

References: [Hono on Node.js](https://hono.dev/docs/getting-started/nodejs), [Zod OpenAPI](https://hono.dev/examples/zod-openapi), [Hono RPC](https://hono.dev/docs/guides/rpc).

### Supabase for Postgres and principal authentication

Use Supabase Postgres, Auth, Realtime Broadcast, and CLI migrations. The web app uses @supabase/ssr for cookie sessions and @supabase/supabase-js server clients. @supabase/ssr is currently beta; pin its version and cover authentication paths with Playwright. Validate sensitive principal actions with getClaims(), or getUser() when fresh state is needed; do not authorize based on the object returned from getSession().

References: [choosing a server package](https://supabase.com/docs/guides/auth/choosing-a-server-package), [SSR setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs), [secure data access](https://supabase.com/docs/guides/database/secure-data).

### WebAuthn for contract-bound approval

Supabase Auth identifies the principal and maintains the browser session. It does not substitute for an application-owned approval receipt bound to a specific contract. Use `@simplewebauthn/browser` and `@simplewebauthn/server` for passkey registration and assertions.

For each mandate activation or exception approval, the Next.js BFF canonicalizes the payload, hashes it, generates a random nonce, and derives the short-lived single-use WebAuthn challenge from both values. The assertion is accepted only when it verifies the configured RP ID and stable Vercel origin, requires user verification, matches the challenge and intended payload hash, and passes the credential-counter check. The consuming transaction activates the mandate or issues the exception capability and records audit-safe evidence together.

Preview URLs are not trusted WebAuthn origins for this flow. The configured production custom domain (and, if needed, one stable staging hostname) supplies `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN`. Store credential public keys, credential IDs, transports, and counters; never store biometric data. Do not call this a legal signature.

References: [SimpleWebAuthn server custom challenges](https://simplewebauthn.dev/docs/advanced/server/custom-challenges), [Supabase passkeys](https://supabase.com/docs/guides/auth/passkeys).

### Deliberate omissions

- No ORM in the first build. Supabase clients, SQL migrations, and transactional RPCs are faster for this small but transaction-sensitive schema.
- No Redux or Zustand initially. Server Components, forms, Server Actions, and Realtime are sufficient; add TanStack Query only if data synchronization becomes difficult.
- No tRPC or GraphQL for merchant-facing APIs. OpenAPI REST is easier to demonstrate and emulate across independent e-commerce mocks.
- No general-purpose OAuth authorization server, dynamic client registration, or formal DPoP implementation in the MVP. This does **not** mean unauthenticated MCP: the controlled agent signs every direct or remote MCP request with the existing JWS proof.
- No Bloom filter in v1. It may produce false positives, so it cannot make an authorization decision.
- No real PAN, CVV, card vault, or payment-provider integration.
- No PIX. The demo models agentic card payment rails only; it does not model a person authenticating into a bank to make a transfer.

## 3. Repository and service layout

    apps/
      web/                 Next.js: principal dashboard, chat, approvals, BFF
      mandate-api/         Hono: agent and merchant authorization API
      payment-vault/       Hono: hosted test setup, isolated tokenization, Mock Yuno, card gateways
      merchant-mocks/      Hono: separate routers and catalogs for each e-commerce
      agent-simulator/     controlled purchasing agent and demo attack scenarios
      mcp-server/          shared MCP tool core; stdio mandatory, HTTP entry point stretch only
    packages/
      contracts/           Zod schemas, OpenAPI components, API errors/reason codes
      domain/              pure policy, JCS hashing, taxonomy, state types
      sdk/                 workspace-only typed agent and merchant API clients
      ui/                  shared shadcn/ui components when reuse is justified
    supabase/
      migrations/          generated through Supabase CLI
      seed.sql             demo users, keys, merchants, catalogs, test methods
    tests/
      e2e/                 Playwright flows

apps/merchant-mocks has independently authenticated routers for each simulated platform. Each platform therefore owns its own agents-pay endpoint without forcing a separate deployment for every catalog.

`apps/payment-vault` is a separate process, port, API key set, and deployment unit. Its hosted setup route is the only browser-facing Vault surface; its authorize, capture, void, routing, and reconciliation routes reject browsers, merchants, and agents. It owns the internal provider token reference. This is a meaningful mock API boundary, not a claim of PCI isolation or an independent payment processor.

`packages/sdk` is private to the workspace. It exports typed `createAgentClient`, `createMerchantClient`, a request-proof signer interface, stable error types, and Zod response validation. It adds `Idempotency-Key` and JWS proof headers but never contains a Vault credential, a real payment credential, or principal approval functionality. It is consumed by the simulator and mocks; it is not published to npm.

`apps/mcp-server` builds one constrained MCP tool set with `@modelcontextprotocol/server` v2. `src/stdio.ts` is a committed Node process for the controlled simulator. `src/http.ts` is a time-boxed, stateless Streamable HTTP adapter that can be deployed only after the core flow passes. Both use the same tool handlers and contracts.

## 4. Trust boundaries and request flow

    Principal browser
      -> secure Supabase cookie -> apps/web (Next.js BFF)
      -> one-time redirect -> Vault-hosted test setup -> opaque callback -> apps/web

    Supabase Cron -> scheduler bearer secret -> apps/mandate-api recurrence tick
                                                   |
                                                   +-> service JWS -> agent-simulator
                                                                         |
    MCP stdio ---------------------------------------+-> agent JWS -> apps/mandate-api -> Supabase/Postgres
    Agent simulator ---------------------------------+                         |
    Mock merchant APIs <- signed merchant quote --------------------------------+
                                                                              +-> service JWS -> payment-vault
                                                                                                   |
                                                              Mock Yuno router -> Card Gateway A | B

1. The browser contacts apps/web for every principal action. It may use a one-time redirect to the Vault-hosted **test setup page**, but never calls Vault authorization/capture APIs or writes mandate/capability state directly.
2. The agent simulator and MCP `stdio` process sign requests to the Mandate API and never receive a payment token.
3. The Mandate API reads the merchant endpoint/key/trust tier from its own registry, then fetches and validates immutable quotes from authenticated merchant APIs.
4. Only the Mandate API calls the Vault after policy approval and merchant verification. The Vault alone holds the provider token reference.
5. The Vault calls Mock Yuno, which routes an idempotent test-card request to exactly one mock gateway. The Vault returns operation state and display-safe identifiers only.
6. A single Supabase Cron tick asks the Mandate API to create due runs; the Mandate API dispatches them to the Agent Simulator. The tick never makes a cron job per mandate, issues a capability, or pays.

## 5. API standards

All APIs use versioned JSON endpoints under /v1, ISO-8601 UTC timestamps, integer minor money units, stable reason codes, and a server-generated X-Request-Id correlation ID.

Every mutating request includes an Idempotency-Key. The server saves its request fingerprint and result. Reuse with a different payload fails.

### Merchant agents-pay API

Each merchant router exposes at least:

    POST /v1/agents-pay/search
    POST /v1/agents-pay/quotes
    GET  /v1/agents-pay/quotes/:quoteId
    POST /v1/agents-pay/orders/:merchantOrderRef/verification

A quote includes exact merchant SKUs and local category IDs, shipping, taxes, total, `issuedAt`, expiry, `merchantCartHash`, merchant catalog version, `keyId`, and an ES256 JWS over the canonical merchant payload. The Mandate API obtains the signing key and expected endpoint from its Merchant Registry, validates the quote, and then derives the versioned canonical category mapping and `canonicalCartHash` itself. It never trusts agent totals, merchant-provided canonical categories, or merchant-provided trust data.

### Mandate API

    POST /v1/agent/intents
    POST /v1/agent/approval-requests
    POST /v1/merchant/verifications
    POST /v1/mandates/:mandateId/revocations
    POST /internal/v1/recurrence/tick

The browser uses the Next.js BFF for principal actions. Direct agent and merchant endpoints require signed proofs. The recurrence endpoint accepts only the Supabase Cron shared bearer secret and is not public. `POST /v1/merchant/verifications` is the sole merchant-to-Mandate settlement handoff: once it verifies the quote-bound capability, the Mandate service owns the authorization/capture saga. A merchant never receives a Vault reference and has no capture route.

### Payment Vault API

The Vault rejects browser, agent, and merchant identities for payment operations.

    GET  /hosted/test-payment-methods/setup
    POST /internal/v1/hosted-setup-sessions/:id/exchange
    POST /internal/v1/payment-methods/test
    POST /internal/v1/payment-authorizations
    GET  /internal/v1/payment-authorizations/:id
    POST /internal/v1/payment-authorizations/:id/capture
    POST /internal/v1/payment-authorizations/:id/void

The hosted setup flow accepts fixture test methods only and redirects to the BFF with a single-use setup code; the BFF exchanges it through the internal endpoint. A method is an opaque cryptographically random reference plus display-safe brand and last4. The Mandate database stores only the opaque ID and display-safe fields; the Vault alone holds its generated provider token reference. The application never accepts, stores, hashes, salts, encrypts, or logs a real PAN or CVV.

### Mock Yuno router and gateways

The Vault calls internal Mock Yuno routes, which select one deterministic gateway from the payment operation ID and seeded routing rules. The gateway contract provides only test-card authorization, capture, void, and status lookup. Seeded test scenarios produce one of `approved`, `declined`, `authorization_timeout`, or `capture_failed`; the scenario is recorded in the audit trail and can be selected through a demo-only control.

    POST /internal/v1/mock-yuno/authorizations
    GET  /internal/v1/mock-yuno/authorizations/:id
    POST /internal/v1/mock-yuno/authorizations/:id/capture
    POST /internal/v1/mock-yuno/authorizations/:id/void

There is no PIX route. Gateway choices and error outcomes are never agent-provided input.

### MCP boundary

The committed MCP server exposes only these tools:

    get_mandate_summary       # redacted, principal-scoped summary
    search_offers
    get_quote
    submit_purchase_intent
    get_purchase_status
    request_exception

It must never expose a payment method, Vault operation, capability issuance, mandate mutation/revocation, passkey approval, or exception approval. `submit_purchase_intent` returns `approval_required` plus a browser approval URL when custody is needed; no MCP tool can satisfy that approval.

The `stdio` transport is the committed integration. If the HTTP stretch adapter is deployed, it uses stateless Streamable HTTP, validates `X-Agent-Request-Proof` on every request with audience `mcp-server`, rate-limits it, and accepts only registered demo agents. It is not an anonymous endpoint. A third-party, user-facing MCP integration would require standard OAuth client authorization and is deferred rather than improvised.

### API hardening

Hono services apply a body-size limit before body hashing, request-ID middleware, secure headers, and a strict CORS allow-list. Authenticated endpoints never use wildcard CORS.

References: [body limit](https://hono.dev/docs/middleware/builtin/body-limit), [request ID](https://hono.dev/docs/middleware/builtin/request-id), [secure headers](https://hono.dev/docs/middleware/builtin/secure-headers), [CORS](https://hono.dev/docs/middleware/builtin/cors).

## 6. Identity, signatures, and anti-replay

### Principal identity

- Start with Supabase Auth email/password and seed a demo user, avoiding email-delivery dependence during the demo.
- Keep the principal session in HttpOnly, Secure, appropriately scoped SameSite cookies through @supabase/ssr.
- Authenticate contract creation, mutation, payment-method selection, approval, and revocation server-side.
- Require an application-owned passkey assertion for mandate activation and exception approval. A session alone may create a draft or reject an approval, but cannot activate a mandate or authorize an exception.

### Passkey approval protocol

1. The BFF canonicalizes the exact approval payload, computes `approvalPayloadHash`, generates a random nonce, derives `challenge = SHA-256(nonce || approvalPayloadHash)`, and stores all bindings with principal, purpose, TTL, and unconsumed state.
2. The browser invokes WebAuthn with `userVerification: 'required'`; no biometric template enters the application.
3. The BFF verifies the assertion against the configured RP ID, origin, challenge, credential public key, and authenticator counter.
4. In one transaction, it consumes the challenge, records the checked counter, activates the mandate or issues the quote-bound capability, and appends passkey evidence to the audit chain. A suspicious nonzero counter regression fails closed.

For activation the payload includes `mandateId`, `mandateVersion`, `policyHash`, `paymentMethodId`, expiry, and nonce. For an exception it additionally includes `quoteId`, `canonicalCartHash`, final amount, currency, expiry, and policy reason codes. Assertion material is processed transiently; persistent evidence contains hashes, credential ID, counter, timestamp, and verification result.

### Agent identity

The agent does not use a browser cookie. Its ES256 private key lives only in the agent-simulator service environment. The database stores its public JWK, kid, agent ID, status, and revocation time.

Every direct agent request contains a compact JWS in X-Agent-Request-Proof. The proof has:

    protected header: alg=ES256, kid=<registered active key>
    iss and sub: agentId
    aud: mandate-api
    htm: request HTTP method
    htu: canonical request URL
    body_hash: base64url(SHA-256(raw request bytes))
    iat and exp: lifetime at most 60 seconds
    jti: globally unique single-use request identifier
    nonce: required for sensitive endpoints when challenged

The API uses jose to verify signature and claims, checks that jti is unused, and reads current key, agent, mandate, and capability state online. Valid agent identity is not payment authority; an active mandate, policy result, capability, and merchant verification remain mandatory.

This is DPoP-inspired rather than a formal OAuth DPoP implementation. It delivers short-lived proof of possession without implementing an OAuth authorization server. Formal DPoP is a future interoperability option. [RFC 9449](https://datatracker.ietf.org/doc/rfc9449/) explains why proof of possession does not itself grant authorization.

### Merchant and service identity

- The Merchant Registry is owned and written only by the Mandate service. A registry entry has merchant ID, active endpoint allow-list, ES256 public key/key ID, lifecycle status, and Mandate-service-assigned trust tier.
- Each merchant mock signs quote payloads with its registered ES256 key; the Mandate service rejects an unknown, inactive, wrong-endpoint, expired, or invalidly signed quote before policy evaluation.
- Merchant-to-Mandate and Mandate-to-Vault calls use short-lived, audience-restricted service JWSs with jti and body hash.
- The Vault accepts only sub=mandate-service and rejects agent, browser, and merchant proofs.
- Supabase Cron invokes the protected recurrence tick with a distinct shared bearer secret held in Supabase Vault and the Mandate API server environment. It cannot issue capabilities or call the Vault directly.
- The optional remote MCP adapter verifies the same kind of registered-agent JWS proof, with a distinct `aud=mcp-server`; it is authentication for the controlled demo agent, not a replacement OAuth issuer.

### Rate limits and authoritative replay protection

Use Upstash sliding-window limits by IP, agent ID, mandate ID, merchant ID, and failed-signature identifier. On authorize, capture, revoke, and signed-write endpoints, treat rate-limit infrastructure timeouts as 503; do not use fail-open behavior.

Rate limiting is not financial correctness. Postgres transactions and unique constraints authoritatively enforce:

    used_agent_jti:              UNIQUE(agent_key_id, jti)
    idempotency_keys:            UNIQUE(actor_id, endpoint, idempotency_key)
    capability_consumptions:     UNIQUE(capability_id)
    merchant_capture_references: UNIQUE(merchant_id, merchant_order_ref)

References: [Upstash rate limiting](https://upstash.com/docs/redis/sdks/ratelimit-ts/overview), [timeout behavior](https://upstash.com/docs/redis/sdks/ratelimit-ts/features), [PostgreSQL INSERT ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html).

## 7. Data and Supabase rules

### Exposure and RLS

- Put mandates, keys, quotes, approvals, capabilities, payment references, audit events, idempotency records, and rate-limit data in a non-exposed private schema.
- The browser does not query sensitive business tables through the Data API. It gets principal-scoped data through the BFF.
- If a table or view becomes exposed, enable RLS, apply least-privilege grants, and scope policies to the owning principal or merchant. Authentication alone is not authorization.
- Never expose a Supabase secret/service-role key or Vault secret to the browser.

The mock Vault is an API isolation boundary but not a PCI boundary. It processes test methods only. The Mandate schema contains a `payment_method_summaries` projection with only `payment_method_id`, `brand`, `last4`, and `status`; `provider_token_ref` exists only in the Vault's private store.

At runtime, do not give the Mandate API a Supabase `service_role`/secret key or an administrative database URL: those credentials bypass RLS and can access every table. Create separate login roles and pooled connection URLs: `mandate_runtime` receives only `mandate_private` tables/functions; `vault_runtime` receives only `vault_private` tables/functions. Revoke all grants on `vault_private` from `mandate_runtime`, `anon`, `authenticated`, and `service_role`; do not expose either private schema through the Data API. The Vault receives `VAULT_DATABASE_URL`; the Mandate API receives `MANDATE_DATABASE_URL`. Database migrations use a separate operator/admin credential, never a deployed service credential.

This is runtime least-privilege isolation within one Supabase project, not an independent PCI or cloud-account boundary. If strict operational isolation becomes necessary, move the Vault to a separate Supabase project/account before accepting real payment data.

References: [private schemas](https://supabase.com/docs/guides/database/tables), [Postgres roles and grants](https://supabase.com/docs/guides/database/postgres/roles), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

### Transactional state functions

Critical actions are Postgres transactions invoked only by trusted services, never a sequence of browser-side Supabase writes:

    evaluate_and_issue_capability
    approve_exception_and_issue_capability
    claim_capability_for_authorization
    begin_capture_claimed_capability
    finalize_capture_result
    void_authorization_and_release_state
    revoke_mandate
    create_due_recurrence_runs

Each operation locks state it changes and writes its audit event in the same commit. Migration files are always generated through Supabase CLI with supabase migration new <name>.

### Payment and budget state

    capability:       issued -> authorized -> consumed | voided | expired
    payment_operation: created -> authorization_pending -> authorized -> capture_pending
                                       |                    |                 |
                                       +-> failed           +-> void_pending -> voided
                                                            +-> reconciliation_required

There is no distributed ACID transaction across Postgres and the Vault. `claim_capability_for_authorization` creates the operation and claims the capability in one local transaction. It then calls the Vault with `authorize:<operationId>` as a durable idempotency key. The Vault forwards the same key through Mock Yuno and the selected gateway. A timeout or unknown network result enters `reconciliation_required`; the worker queries `GET /payment-authorizations/:id` and may resend only the same idempotency key.

Capture uses a separate durable `capture:<operationId>` key. Before the call, `begin_capture_claimed_capability` locks the operation and rechecks mandate revocation, quote expiry/cart hash, and current capability state. On success, `finalize_capture_result` records `captured`, debits the final budget, and consumes the capability. On failure or revocation, it drives a void/reconciliation path and releases the outstanding slot only after the Vault confirms no authorization is held. The Mandate API runs this saga after the merchant verification handoff and returns a signed receipt containing only the resulting settlement state and opaque operation identifier; the merchant may fulfill only after the receipt reports `captured`.

The revocation/capture race is defined by committed local state. If revocation commits while an operation is `authorized`, it changes the operation to `void_pending` and capture cannot begin. If `begin_capture_claimed_capability` commits `capture_pending` first, the external capture may already be in flight; revocation records that race and reconciliation determines the result. A confirmed capture follows the post-capture dispute/refund path rather than a false promise that it was voided.

Default behavior debits final budget only at `captured` and permits one outstanding capability per mandate. A merchant may advertise `reserve_on_authorization` when concurrent orders are required, but the mode is fixed in the contract/merchant configuration and cannot be selected by the agent.

### Recurrence

The contract stores a typed recurrence rule (`daily`, `weekly`, or `monthly`), IANA timezone, local time, local execution window, maximum occurrences, `next_run_at_utc`, and a principal-approved `recurring_intent_template` (product request, quantity, preferred merchants, and allowed substitutions). A single Supabase Cron job calls the protected Mandate API tick. The tick locks each due schedule, derives a stable `schedule_slot`, inserts `recurrence_runs` under `UNIQUE(mandate_id, schedule_slot)`, advances `next_run_at_utc`, and dispatches the run to the Agent Simulator with a Mandate-service JWS.

The tick never issues a capability or calls the Vault. The separately authenticated Agent Simulator turns the template into search/quote requests, then submits a standard signed agent intent through the normal policy → merchant verification → payment circuit. `recurrence_runs` progress through `due`, `agent_dispatched`, `approval_pending`, `completed`, `skipped`, or `failed`. An expired quote, no eligible offer, or rejected/expired approval records a reason code; retries use the same run key and do not make a second purchase. Local development exposes an authenticated `demo:tick-recurrence` command; deployment uses Supabase Cron, not Vercel Cron, so the rule remains dynamic even on a Vercel Hobby project.

References: [Supabase Cron](https://supabase.com/docs/guides/cron), [scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).

### Taxonomy

Enable the Supabase-supported `ltree` extension for exact canonical taxonomy paths such as `food.grains.rice` and `food.meat.chicken`. The Mandate service owns the versioned canonical taxonomy and merchant mappings; merchants cannot declare their own canonical category or trust tier. Merchant adapters map local categories/SKUs before evaluation. Use exact `ltree` and B-tree lookups in v1, not a Bloom filter. A later Bloom filter may only prefilter catalog-search candidates; it cannot make or bypass an authorization decision.

Reference: [Supabase Postgres extensions](https://supabase.com/docs/guides/database/extensions).

### Realtime

Use Supabase Realtime Broadcast for low-sensitivity UI notices, such as revocation and approval status. Broadcast event IDs only; fetch authorized details through the BFF. Realtime is never the enforcement mechanism for revocation.

### Audit immutability

Audit events are chained per aggregate stream, such as a mandate, instead of through a single global previous hash. A locked `audit_streams` cursor assigns `sequence`, `previous_hash`, and `event_hash` under `UNIQUE(stream_id, sequence)` so concurrent events cannot fork the stream; correlation IDs link related events across streams. The application writer role may insert audit events but has no update/delete grant. A `BEFORE UPDATE OR DELETE` trigger raises an error for every audit table mutation. An audit verifier replays each stream.

Audit events are immutable and retained for the hackathon. Shorter-lived receipts/PII live in separate records and are redacted or expired with a new audit event, never by deleting or rewriting an event. Database tests prove both SQL mutation rejection and chain-break detection. This gives tamper evidence within the project, not externally witnessed or legally binding evidence.

## 8. Domain, LLM, UI, and test decisions

### Domain

packages/contracts owns Zod schemas for API payloads, errors, reason codes, quote envelopes, and signed-proof claims. packages/domain owns pure policy evaluation, integer money arithmetic, JCS hashing, taxonomy traversal, capability/payment transitions, and Policy Diff inputs. It has no HTTP, database, UI, LLM, or provider dependency.

Use json-canonicalize for RFC 8785-compatible JSON canonicalization and jose for JWS primitives. jose is a cryptographic primitive, not an authorization system; key status, nonce, replay, and policy checks remain application logic.

References: [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html), [json-canonicalize](https://www.npmjs.com/package/json-canonicalize), [jose](https://github.com/panva/jose).

### Internal SDK

`packages/sdk` wraps the shared OpenAPI/Zod contracts, not business rules. `createAgentClient` and `createMerchantClient` accept a base URL and injected `RequestProofSigner`, validate all request/response shapes, attach an idempotency key to mutating calls, and surface stable reason-code errors. The SDK is integration-tested against the Hono apps and used by the agent simulator and merchant mocks. It must not expose Vault APIs, payment data, contract mutation, passkey approval, or raw signing keys. It is a workspace package with an internal README/quickstart, not an npm publication.

### MCP integration

`apps/mcp-server` is an adapter over the SDK and the same policy-backed Mandate API; it contains no independent authorization logic. The committed `stdio` transport is started by the controlled agent simulator and uses its registered agent signing identity. The optional remote adapter uses the MCP TypeScript SDK's stateless Streamable HTTP transport and validates JWS on every request before executing an allow-listed tool.

Do not confuse Vercel AI SDK tools with MCP. AI SDK tools are internal model-function calls in the web app; MCP is an external tool protocol adapter. The optional HTTP transport stays disabled unless its JWS authentication, rate limit, CORS policy, and Playwright/API smoke test pass. Standard OAuth is a later compatibility project only if untrusted third-party MCP clients must connect.

References: [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/), [MCP stdio server transport](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/stdio.html), [MCP client transports](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect).

### LLM boundary

The Vercel AI SDK with an OpenAI provider adapter may call only server-defined, Zod-validated tools:

    collect_contract_constraint
    search_merchant_catalogs
    request_merchant_quote
    draft_contract_for_review
    submit_purchase_intent

The model cannot call the Vault, read a payment reference, modify a contract, approve an exception, issue a capability, or capture a payment. submit_purchase_intent sends structured data to the deterministic policy service and returns its decision.

References: [AI SDK tools](https://ai-sdk.dev/docs/foundations/tools), [AI SDK Core](https://ai-sdk.dev/docs/reference/ai-sdk-core).

### UI

Use Tailwind CSS v4 and shadcn/ui with accessible Radix primitives. Use React Hook Form, Zod, and @hookform/resolvers for contract review and one-off exception dialogs. Use server-rendered data by default and client components only for chat, forms, timers, passkey prompts, attack toggles, and realtime status. Evidence appears in the principal's timeline, not as a separate auditor role.

References: [shadcn/ui for Next.js](https://ui.shadcn.com/docs/installation/next), [shadcn/ui monorepos](https://ui.shadcn.com/docs/monorepo).

### Tests required before the demo

| Layer | Tool | Required proof |
| --- | --- | --- |
| Domain | Vitest | Decisions, canonical hashes, taxonomy, budget modes, reason codes. |
| Hono APIs | Vitest and in-process app.request | Signatures, mismatch, replay, idempotency, merchant mismatch, Vault audience rejection. |
| Database | Supabase local database plus SQL/RPC tests | Atomic local claim/capture/revoke behavior, recurrence run uniqueness, audit immutability, and RLS/grant checks. |
| SDK/MCP | Vitest integration tests | Typed SDK contract compatibility; MCP tool allow-list and lack of sensitive tools. |
| Principal flow | Playwright | Passkey registration, contract activation, test method, exception approval, capture, revocation, and evidence. |
| Payment saga | Vitest/API fixtures | Gateway approval, decline, timeout/reconciliation, capture failure, and void after revocation. |
| Attack demo | Playwright/API fixtures | Altered cart, replay, wrong merchant, revoked mandate, unknown key, and unmapped category. |

Reference: [Playwright](https://playwright.dev/docs/intro).

## 9. Environment, deployment, and implementation order

The initial `.env.example` documents placeholder values only. Values marked server-only are never emitted to Next.js client code or committed.

    NEXT_PUBLIC_SUPABASE_URL=
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
    OPENAI_API_KEY=                            # web/agent server only
    MANDATE_DATABASE_URL=                     # mandate_runtime role only
    VAULT_DATABASE_URL=                       # vault_runtime role only
    MANDATE_API_URL=
    PAYMENT_VAULT_URL=
    MERCHANT_MOCKS_URL=
    MANDATE_SERVICE_PRIVATE_JWK=               # mandate-api only
    VAULT_SERVICE_PRIVATE_JWK=                 # payment-vault only
    AGENT_SIMULATOR_PRIVATE_JWK=               # controlled agent/MCP stdio only
    MERCHANT_DEMO_A_PRIVATE_JWK=               # merchant-mocks only
    MERCHANT_DEMO_B_PRIVATE_JWK=               # merchant-mocks only
    WEBAUTHN_RP_ID=
    WEBAUTHN_ORIGIN=
    WEBAUTHN_RP_NAME=Agentic Mandates
    SCHEDULER_SHARED_SECRET=                   # mandate-api + Supabase Vault only
    UPSTASH_REDIS_REST_URL=
    UPSTASH_REDIS_REST_TOKEN=
    DEMO_ADMIN_SECRET=                         # reset/scenario controls in demo environment only

### Deployment topology

Deploy the monorepo as separate Vercel projects with their own root directory and environment set:

| Vercel project | Root | Exposure | Required production behavior |
| --- | --- | --- | --- |
| Principal web | `apps/web` | Stable custom domain | Hosts the principal UI, BFF, and WebAuthn origin. |
| Mandate API | `apps/mandate-api` | Service URL | Only explicit agent, merchant, scheduler, and health endpoints; signed requests required. |
| Payment Vault | `apps/payment-vault` | Service URL plus hosted test-setup route | Internal payment routes reject browser/agent/merchant identities. |
| Merchant mocks | `apps/merchant-mocks` | Service URL | Two authenticated mock merchant routers. |
| Agent simulator | `apps/agent-simulator` | Internal service URL | Receives only Mandate-service dispatch proofs and owns the agent signing key. |
| MCP server | `apps/mcp-server` | Local `stdio` in the committed build | Deploy a remote HTTP endpoint only as stretch work after its auth tests pass. |

Supabase hosts Auth, private Postgres state, Realtime, migrations, and the one recurrence trigger. Enable `pg_cron` and `pg_net`; the Cron job calls the Mandate API recurrence tick with `Authorization: Bearer <SCHEDULER_SHARED_SECRET>`, where the secret is stored in **Supabase Vault** and mirrored only in the Mandate API server environment. This Supabase secret store is unrelated to the test Payment Vault.

The custom Vercel domain is the sole production WebAuthn origin/RP ID. Preview deployments may exercise non-passkey screens but must not register or approve passkeys. Browser CORS is limited to that web origin; service-to-service traffic uses signatures/secrets rather than permissive CORS. The hosted Vault setup uses a short-lived, one-time redirect/callback rather than browser access to an internal payment endpoint.

References: [Vercel monorepos](https://vercel.com/docs/monorepos), [Hono on Vercel](https://vercel.com/docs/frameworks/backend/hono), [Supabase Cron](https://supabase.com/docs/guides/cron).

### Operational demo controls

Seed deterministic IDs, agent/merchant keys, catalogs, taxonomy mappings, test payment methods, and gateway outcomes. Provide:

    pnpm demo:reset
    pnpm demo:tick-recurrence
    pnpm test:e2e

`demo:reset` is available only in the local/demo environment, requires `DEMO_ADMIN_SECRET` where remote, and reseeds rather than editing production rows manually. UI controls invoke predefined attack fixtures and gateway scenarios; no judge needs database access. Each service exposes a non-sensitive `/health` endpoint. The release rehearsal is: apply migrations → deploy services → seed demo environment → health/smoke check → run Playwright demo flow.

### Implementation sequence and 20-hour scope

The plan assumes four people working during a 20-hour hackathon (roughly 80 person-hours of capacity). Start with a shared 45-minute contract/schema alignment, then work in parallel:

1. **Policy/data owner:** workspace foundations; Zod contracts; private-schema migrations; Merchant Registry; exact taxonomy; policy evaluator; audit trigger; recurrence tables and tick.
2. **Commerce/SDK owner:** two merchant APIs; signed quote envelopes; normalization; internal SDK; agent simulator; deterministic discovery fixtures.
3. **Payment owner:** hosted test Vault; Mock Yuno router; two card gateways; idempotency; saga/reconciliation; revocation-before-capture void.
4. **Experience owner:** Next.js; Supabase session; passkey registration/approval; dashboards; MCP `stdio`; deployment; reset controls; Playwright integration.

The committed path is one end-to-end purchase, one quote-bound escalation, revocation, one data-driven recurring run, two merchant mocks, two card gateway outcomes, SDK integration, MCP `stdio`, and deterministic reset/attacks. Remote Streamable HTTP MCP, elaborate dispute flows, extra merchants/gateways, and generic OAuth interoperability are time-boxed stretch work. If time is constrained, remove stretch work first, never JWS checks, passkey binding, local transaction integrity, payment reconciliation, or revocation semantics.

Implement in this dependency order:

1. Initialize the workspace, strict TypeScript, linting, formatting, lockfile, and `.env.example`.
2. Define shared contracts/domain schemas and create private-schema migrations, seed data, RLS/exposure rules, registry, audit protections, and recurrence tables.
3. Implement and test pure policy, canonical hashing, taxonomy, reason codes, and contract-bound approval payloads before UI.
4. Implement merchant APIs, quote signatures, SDK, agent proof middleware, idempotency, and the test Vault/Mock Yuno/gateway flow.
5. Implement the Postgres/Vault saga, reconciliation, void-on-revocation, and recurrence tick.
6. Implement the web UI, hosted test-payment callback, passkey activation/approval, merchant view, and evidence timeline.
7. Implement MCP `stdio`, deterministic attack controls, deployment configuration, and health endpoints.
8. Add API/database/SDK/Playwright tests, reset from fresh seed, and rehearse the deployed demo.

## 10. Revisit triggers

Re-evaluate the stack if third-party agents need standard OAuth/DPoP, real payment data is accepted, merchants become external deployments, catalog scale proves exact taxonomy queries slow, scheduled workloads exceed a single tick, or production needs separately operated Vault infrastructure and compliance controls.
