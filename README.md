# AgentPay

![AgentPay logo](public/agentpay-logo.png)

AgentPay is a functional, hackathon-ready authorization and enforcement layer for agent purchases. An agent connects through an OAuth-protected MCP server, requests a narrowly scoped mandate, and can purchase only after the user authorizes that mandate with a real passkey. Stores integrate the merchant SDK and publish their own discovery document; AgentPay never acts as a store directory.

Production: https://agentpay-yuno.vercel.app

## Working flow

1. The user connects `https://agentpay-yuno.vercel.app/mcp` to an MCP client.
2. Supabase OAuth opens AgentPay for sign-in, account creation and consent.
3. The user registers one passkey, saves one or more cards, chooses a default, and completes the compliance and delivery profile. Raw card numbers are never stored; this challenge build uses encrypted mock-vault references and non-sensitive display metadata.
4. The agent finds a product through normal search, reads the store's `/.well-known/agentpay.json`, and requests a mandate matching the user's instructions. The default card is used unless the agent selects another saved card. The web app has no form for this: a mandate only ever exists because an agent asked for one.
5. The user opens the approval link, may switch the draft to another saved card, and authorizes that exact mandate and card choice with their passkey.
6. The store SDK verifies the signed agent request, mandate signature, live registry status, nonce and policy before returning a mock single-use payment token.
7. The user or agent can revoke the mandate immediately. A checkout still in progress performs a final live registry check before settlement and is refused if revocation committed first; every later checkout is refused too.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

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
| `/dashboard` | Summary: what was charged this month, which mandates are active, what is waiting for your signature |
| `/activity` | Every purchase attempt and the mandate decision made on it |
| `/connect` | See connected assistants and connect another with one link |
| `/account` | Compliance, delivery address, saved cards, card usage and default-card controls |
| `/m` | Phone-first signing inbox and revocation switch, opened by QR from the desktop app |
| `/docs` | Merchant documentation: install and set up the SDK in a new store |
| `/store` | Merchant demo with AgentPay checkout verification |
| `/audit` | Security log: hash-chained record of every decision |
| `/mcp` | OAuth-protected Streamable HTTP MCP server |

Every route above is responsive and usable from a phone. `/m` is a separate, deliberately narrower surface — see the decision log.

## MCP tools

- `get_account`
- `get_payment_setup_link` — returns a 15-minute, user-bound AgentPay browser link and accepts no card data
- `create_mandate` — uses the account default unless `vault_card_id` selects another owned card
- `get_mandate`
- `purchase`
- `revoke_mandate`

The protected-resource metadata is at `/.well-known/oauth-protected-resource/mcp`. Supabase publishes OAuth authorization-server metadata and supports dynamic client registration for MCP clients.

## Merchant SDK

A store integrates AgentPay with two routes: a discovery manifest and a verified checkout endpoint. Install the SDK into a merchant project with one command:

```bash
npm run sdk:install -- ../my-store
```

It builds `@agentpay/merchant-sdk`, packs it, copies the tarball into `my-store/vendor/` and installs it there, so the dependency is a relative path the store can commit. To build or pack without installing:

```bash
npm run sdk:build
npm run sdk:pack
```

The complete integration guide is the documentation site at [`/docs`](https://agentpay-yuno.vercel.app/docs) — quickstart, installation, discovery, checkout, framework recipes, testing, the SDK and protocol reference, and troubleshooting. [docs/merchant-sdk.md](docs/merchant-sdk.md) is the short version for readers browsing this repository.

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
