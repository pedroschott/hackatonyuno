# AgentPay

AgentPay is a functional, hackathon-ready authorization and enforcement layer for agent purchases. An agent connects through an OAuth-protected MCP server, requests a narrowly scoped mandate, and can purchase only after the user authorizes that mandate with a real passkey. Stores integrate the merchant SDK and publish their own discovery document; AgentPay never acts as a store directory.

Production: https://agentpay-yuno.vercel.app

## Working flow

1. The user connects `https://agentpay-yuno.vercel.app/mcp` to an MCP client.
2. Supabase OAuth opens AgentPay for sign-in, account creation and consent.
3. The user registers one passkey and saves one or more cards. Raw card numbers are never stored; this challenge build uses encrypted mock-vault references and non-sensitive display metadata.
4. The agent finds a product through normal search, reads the store's `/.well-known/agentpay.json`, and requests a mandate matching the user's instructions. The web app has no form for this: a mandate only ever exists because an agent asked for one.
5. The user opens the approval link and authorizes the mandate with their passkey.
6. The store SDK verifies the signed agent request, mandate signature, live registry status, nonce and policy before returning a mock single-use payment token.
7. The user or agent can revoke the mandate immediately. A checkout still in progress performs a final live registry check before settlement and is refused if revocation committed first; every later checkout is refused too.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3210/dashboard. A new account starts empty: nothing can be charged until an agent requests a mandate and you sign it. Localhost is a WebAuthn secure context. On a phone, open the canonical production HTTPS URL directly in Safari or Chrome; passkeys are bound to that exact hostname and embedded browsers may not expose the device authenticator.

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
| `/dashboard` | Summary: what was charged this month, which mandates are active, what is waiting for your signature |
| `/activity` | Every purchase attempt and the mandate decision made on it |
| `/connect` | See connected assistants and connect another with one link |
| `/m` | Phone-first signing inbox and revocation switch, opened by QR from the desktop app |
| `/store` | Merchant demo with AgentPay checkout verification |
| `/audit` | Security log: hash-chained record of every decision |
| `/mcp` | OAuth-protected Streamable HTTP MCP server |

Every route above is responsive and usable from a phone. `/m` is a separate, deliberately narrower surface — see the decision log.

## MCP tools

- `get_account`
- `get_payment_setup_link` — returns a 15-minute, user-bound AgentPay browser link and accepts no card data
- `create_mandate`
- `get_mandate`
- `purchase`
- `revoke_mandate`

The protected-resource metadata is at `/.well-known/oauth-protected-resource/mcp`. Supabase publishes OAuth authorization-server metadata and supports dynamic client registration for MCP clients.

## Merchant SDK

Build or pack `@agentpay/merchant-sdk` locally:

```bash
npm run sdk:build
npm run sdk:pack
```

See [docs/merchant-sdk.md](docs/merchant-sdk.md) for store integration.

Architecture and the hackathon tradeoffs are documented in [docs/architecture.md](docs/architecture.md) and [docs/decisions.md](docs/decisions.md).
The complete web, MCP, API and V2-service map is in [docs/routes.md](docs/routes.md). Public crawlers receive only the canonical HTML surfaces in `/sitemap.xml`; protocol and authenticated paths are excluded through `/robots.txt`.

## Supabase

Schema changes are versioned in `supabase/migrations/`. Every Data API table has Row Level Security. User-owned cards, credentials, agents and mandates are isolated by `auth.uid()` policies; merchant checkout decisions run through narrowly scoped database functions.

The payment rail is intentionally mocked for the challenge. Authentication, passkey ceremonies, mandate signatures, enforcement, OAuth, MCP, live revocation and merchant verification are functional.
