# AgentPay

![AgentPay logo](public/agentpay-logo.png)

AgentPay is a functional, hackathon-ready authorization and enforcement layer for agent purchases. An agent connects through an OAuth-protected MCP server, requests a narrowly scoped mandate, and can purchase only after the user authorizes that mandate with a real passkey. Stores integrate the merchant SDK and publish their own discovery document; AgentPay never acts as a store directory.

All product prices, mandate limits, attempts, and mock payment allowances use USD, stored as exact integer cents. AgentPay does not perform foreign-exchange conversion.

Production: https://agentpay-yuno.vercel.app

## Working flow

1. The user connects `https://agentpay-yuno.vercel.app/mcp` to an MCP client.
2. Supabase OAuth opens AgentPay for sign-in, account creation and consent.
3. The user registers one passkey, saves one or more cards, chooses a default, completes the compliance and delivery profile, and passes Didit's hosted Free KYC workflow. AgentPay stores only Didit's session status; documents, images, biometrics, and the full decision remain with Didit. Raw card numbers are never stored; this challenge build uses encrypted mock-vault references and non-sensitive display metadata.
4. The agent finds the store through normal search, then calls `find_products` with any URL on it. AgentPay reads the store's `/.well-known/agentpay.json` and the catalog endpoint it advertises, and returns the exact merchant id, category slugs, prices in cents and product ids. The agent requests a mandate with those values; a merchant or category the store cannot satisfy is rejected before the user is asked to sign. The default card is used unless the agent selects another saved card. The web app has no form for this: a mandate only ever exists because an agent asked for one.
5. The user opens the approval link, may switch the draft to another saved card, and—only while Didit's latest decision is approved and the user is not flagged or blocked—authorizes that exact mandate and card choice with their passkey.
6. The agent runs `check_purchase`, a dry run against the live mandate that records nothing, then `purchase`. The store SDK verifies the signed agent request, mandate signature, live registry status, nonce and policy before returning a mock single-use payment token. Every decision carries an explanation, a remedy and the next tool to call; a scope refusal is fixed with `amend_mandate`, which the user signs once and which retires the old mandate at that moment.
7. The user or agent can revoke the mandate immediately. A checkout still in progress performs a final live registry check before settlement and is refused if revocation committed first; every later checkout is refused too.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

The merchant console uses the publishable Supabase key for authenticated, RLS-protected developer work. `MERCHANT_VERIFICATION_SECRET` is a dedicated server-only proof used after AgentPay fetches and validates a live merchant discovery document. Generate it with `openssl rand -hex 32`, keep it identical in the Vercel environment and the hashed Supabase verification configuration, and never expose it to browser code. The deployed project is already configured.

Identity verification requires server-only `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`, and `SUPABASE_SECRET_KEY` values. A legacy `SUPABASE_SERVICE_ROLE_KEY` remains accepted as a fallback. AgentPay pins Didit's public `Free KYC` workflow ID (`51f322cc-7a71-4259-a8e2-015fd7017ca9`) in server code and sends it with every session request. Keep paid workflow add-ons such as White Label disabled: the core checks use Didit's monthly free allowance, but a paid add-on still makes session creation require a cash balance. Configure the Didit v3 webhook destination as `https://<agentpay-host>/api/webhooks/didit`, webhook version `v3`, subscribed to `status.updated`, `data.updated`, `user.status.updated`, and `user.data.updated`. Never prefix the secrets with `NEXT_PUBLIC_`.

Open http://localhost:3210 for the landing page, or http://localhost:3210/dashboard for the app. A new account starts empty: nothing can be charged until an agent requests a mandate and you sign it. Localhost is a WebAuthn secure context. On a phone, open the canonical production HTTPS URL directly in Safari or Chrome; passkeys are bound to that exact hostname and embedded browsers may not expose the device authenticator.

The hosted Supabase Auth service delivers transactional email through Resend from `AgentPay <auth@fwdco.space>`, with a 30-email-per-hour project limit. This is separate from the mocked payment rail. If you run the local Supabase stack, set `RESEND_API_KEY` in your shell before `supabase start`; never expose or commit that key.

## Verify

```bash
npm run check
npm run build
npm run sdk:pack
```

`npm run check` runs TypeScript, policy/SDK tests and the installable SDK build. The authenticated live MCP smoke accepts an email and password:

```bash
npm run test:mcp -- user@example.com 'password'
```

### Verify mid-turn revocation

The automated Mandate API test starts a payment authorization, revokes the mandate while that authorization is in flight, then confirms the authorization is voided and no usage is recorded. The deployed checkout route also accepts a bounded, test-only pre-settlement window for live failure rehearsals.

The delay is only a test affordance. The security boundary is the final Supabase transaction: checkout and revocation take the same per-mandate advisory lock, so their outcome has one defensible order under concurrency.

## Main surfaces

| Route | Purpose |
|---|---|
| `/` | Landing page: what AgentPay does for a buyer, and where a merchant starts |
| `/privacy` | Privacy Policy: data handling, sharing, security, retention, and user rights |
| `/terms` | Terms of Service: mandate use, responsibilities, and challenge-build limitations |
| `/dashboard` | Summary: what was charged this month, which mandates are active, what is waiting for your signature |
| `/activity` | Every purchase attempt and the mandate decision made on it |
| `/connect` | See connected assistants and connect another with one link |
| `/account` | Didit Free KYC verification, compliance, delivery address, saved cards, card usage and default-card controls |
| `/m` | Phone-first signing inbox and revocation switch, opened by QR from the desktop app |
| `/docs` | Merchant documentation: install and set up the SDK in a new store |
| `/developers` | Merchant console: create identities, hosted test stores, products, keys, and inspect checkout activity |
| `/developers/stores` | Verified live-store registry; currently empty until a real public merchant opts in |
| `/store` | Merchant demo with AgentPay checkout verification. Server-rendered, with one canonical `/store/products/:id` page per product carrying `agentpay:*` meta tags and JSON-LD |
| `/audit` | Security log: hash-chained record of every decision |
| `/mcp` | OAuth-protected Streamable HTTP MCP server |

Every route above is responsive and usable from a phone. `/m` is a separate, deliberately narrower surface — see the decision log.

## MCP tools

The working order is `get_account → find_products → create_mandate → get_mandate → check_purchase → purchase`. Every tool returns its data both as `structuredContent` and as JSON text, so a model that only reads `content` still sees the ids it was given.

- `get_account` — identity-verification state, saved cards, every mandate with status and a one-line summary, pending approvals, and the single `next_step` for this account
- `get_payment_setup_link` — returns a 15-minute, user-bound AgentPay browser link and accepts no card data
- `find_products` — takes any URL on a store, reads its manifest and catalog endpoint, and returns the exact merchant id, category slugs, currency, prices in cents and product ids, plus a `mandate_hint` ready for `create_mandate`
- `create_mandate` — accepts `merchant_urls` (resolved to exact ids) or `merchant_ids`; rejects a category the store does not sell before the user is asked to sign; defaults `max_uses` to 1, expiry to 7 days, the card to the account default, and `cumulative_cents` to `per_purchase_cents × max_uses`
- `amend_mandate` — widens scope, raises limits or extends expiry. A draft is edited in place; a signed mandate is immutable, so it proposes a replacement that the user signs once and that revokes the old mandate at that moment
- `get_mandate` — live status, remaining uses and budget, and the next step. A draft is a state, not an error
- `check_purchase` — dry run of one product against the live mandate: same policy engine, no merchant contact, no attempt recorded
- `purchase` — signed merchant checkout plus the final atomic registry decision. `escalated` carries `approval_url` and `retry_with`; `refused` carries `explanation`, `remedy` and `next_tool`
- `revoke_mandate` — final; for the user saying stop, never for fixing scope

The full flow with example payloads is at [`/docs/agents`](https://agentpay-yuno.vercel.app/docs/agents). The protected-resource metadata is at `/.well-known/oauth-protected-resource/mcp`. Supabase publishes OAuth authorization-server metadata and supports dynamic client registration for MCP clients.

## Merchant SDK

A store first signs in at [`/developers`](https://agentpay-yuno.vercel.app/developers) and creates a merchant. AgentPay assigns the immutable merchant ID used in mandates; developers no longer invent an ID in configuration. A hosted test merchant immediately receives a working storefront, sample catalog, discovery manifest, checkout endpoint, and server-side catalog API key.

A live store then integrates AgentPay with three routes: a discovery manifest, a catalog endpoint built with `createAgentPayCatalogHandler` (so agents query exact product ids, categories and prices instead of scraping rendered pages), and a verified checkout endpoint. The catalog is optional: the manifest fields added in SDK 0.2.0 are all optional, so a store on 0.1.0 is still discovered. Install the SDK into a merchant project with one command:

```bash
npm run sdk:install -- ../my-store
```

It builds `@agentpay/merchant-sdk`, packs it, copies the tarball into `my-store/vendor/` and installs it there, so the dependency is a relative path the store can commit. To build or pack without installing:

```bash
npm run sdk:build
npm run sdk:pack
```

The complete integration guide is the documentation site at [`/docs`](https://agentpay-yuno.vercel.app/docs) — including a comprehensive prompt that merchants can paste into a coding agent to adapt, implement, test, and document the integration in their own store. It also covers quickstart, installation, discovery, checkout, framework recipes, testing, the SDK and protocol reference, and troubleshooting. [docs/merchant-sdk.md](docs/merchant-sdk.md) is the short version for readers browsing this repository.

The supported live-store endpoint is [`/api/stores`](https://agentpay-yuno.vercel.app/api/stores). It intentionally returns no stores until a real HTTPS merchant completes discovery verification and explicitly opts into public listing. Hosted mocks remain unlisted test fixtures.

## Documentation

| Document | What it covers |
|---|---|
| [`/docs`](https://agentpay-yuno.vercel.app/docs) (`app/(docs)/docs/**`) | Merchant-facing guide to installing and setting up the SDK in a new store |
| [docs/merchant-sdk.md](docs/merchant-sdk.md) | Repository-side summary of the same integration |
| [docs/architecture.md](docs/architecture.md) | System diagram, trust boundaries and the enforcement path |
| [docs/decisions.md](docs/decisions.md) | Decision log: trade-offs, rejected alternatives and deliberate limits |
| [docs/routes.md](docs/routes.md) | Every web, MCP, API and V2-service endpoint |
| [public/llms.txt](public/llms.txt) | Agent-readable summary of the public surfaces |

The docs site is part of the application, so it deploys with the code it documents. `components/docs/nav.ts` is the single source of truth for the sidebar, search index, page metadata and sitemap entries; a new page is one entry there plus one `page.tsx`.

**Documentation is updated in the same pull request as the code it describes.** `AGENTS.md` carries the table of what to update when, and a pull request that changes behaviour without updating documentation is treated as unfinished.

Public crawlers receive only the canonical HTML surfaces in `/sitemap.xml` — the documentation site included; protocol and authenticated paths are excluded through `/robots.txt`.

## Supabase

Schema changes are versioned in `supabase/migrations/`. Every Data API table has Row Level Security. User-owned cards, credentials, agents and mandates are isolated by `auth.uid()` policies; merchant checkout decisions run through narrowly scoped database functions.

Supabase Auth uses the verified `fwdco.space` domain through Resend SMTP for confirmation, recovery and security emails. The SMTP credential lives only in the hosted Supabase configuration (and in a developer's local environment when running the local stack), never in Vercel or the browser bundle. The 30-email-per-hour Auth limit keeps the live demo usable while bounding accidental or abusive sends.

The payment rail is intentionally mocked for the challenge. Authentication, passkey ceremonies, mandate signatures, enforcement, OAuth, MCP, live revocation and merchant verification are functional.
