# Merchant mocks

Two Hono e-commerce mocks used to prove the Agentic Mandates merchant boundary. They are not a payment gateway: they never receive payment methods, Vault references, card data, passkeys, or mandate policy.

## Routes

Both marketplaces run in one Hono service but retain distinct IDs, catalogs, local taxonomies, and ES256 quote signing keys.

| Merchant | Base path |
| --- | --- |
| Harvest Market | `/merchants/harvest-market` |
| City Basket | `/merchants/city-basket` |

Each base path exposes:

```text
POST /v1/agents-pay/search
POST /v1/agents-pay/quotes
GET  /v1/agents-pay/quotes/:quoteId
POST /v1/agents-pay/orders/:merchantOrderRef/verification
```

`POST /search` accepts `{ "query": "rice", "limit": 10 }`.

`POST /quotes` accepts only merchant SKUs and quantities:

```json
{
  "items": [{ "merchantSku": "hm-rice-jasmine-2lb", "quantity": 1 }]
}
```

The merchant calculates availability, line prices, shipping, tax, total, order reference, and RFC 8785 cart hash. The returned quote is an immutable signed snapshot. It contains only a merchant-local `merchantCategoryId`; canonical categories and trust tiers are intentionally absent.

Every mutating endpoint requires `Idempotency-Key`. Retrying the same key and payload returns the stored result; using the key with another payload returns `IDEMPOTENCY_KEY_REUSED`.

`POST /orders/:merchantOrderRef/verification` accepts:

```json
{
  "quoteId": "quote_...",
  "purchaseCapability": "opaque-capability-proof"
}
```

The merchant calls its injected `MandateVerificationClient` with only the merchant/order/quote/capability tuple. It records `quoted`, `verification_approved`, `verification_rejected`, or `approval_required`; it never marks an order paid or invokes a Vault/capture endpoint.

## Authentication, persistence, and integration boundary

Search, quote creation, and order-verification requests require an authenticated agent. Quote retrieval accepts either an authenticated agent or the Mandate service, so the Mandate service can independently fetch a quote from the registry-resolved endpoint. A deployed integration must inject the shared ES256 JWS verifier that validates the registered agent/service key, method, URL, body hash, `jti`, expiry, and audience.

`HttpMandateVerificationClient` is a thin server-to-server bridge to `POST /v1/merchant/verifications`. It expects a service proof signer and verifies a Mandate-signed ES256 receipt bound to the merchant ID, order reference, quote ID, capability hash, decision, and expiry. It does not implement policy, capabilities, or payment logic.

The `merchantRegistrySeed` export intentionally contains only public JWKs, endpoint paths, and lifecycle status. The Mandate service owns the endpoint allow-list and all trust-tier assignments.

`createMerchantMocksApp` deliberately requires injected quote, order, idempotency, and rate-limit adapters. The in-memory/allow-all adapters exist only in `src/test-harness.ts`; a Vercel deployment must provide durable database-backed stores and a fail-closed rate limiter.

## Run locally

The root workspace is expected to install this package through pnpm. Until it exists, the package can be run independently:

```sh
cd apps/merchant-mocks
npm install
npm test
DEMO_AGENT_REQUEST_PROOF=local-test-only-proof npm run demo
```

The `.env.example` lists local-demo and future composition variables; export local values in your shell because this package does not load `.env` files itself. Pass the configured `X-Agent-Request-Proof` value to the local demo request harness. It is not production authentication. `src/demo-server.ts` refuses `NODE_ENV=production` and imports the test harness.

There is intentionally no Vercel bootstrap that silently falls back to test authentication, default approval, static private keys, or in-memory state. After the shared JWS and persistence packages exist, the Vercel entry point must instantiate `createMerchantMocksApp` with server-only `MERCHANT_DEMO_A_PRIVATE_JWK` / `MERCHANT_DEMO_B_PRIVATE_JWK`, durable stores, the registered-request authenticator, and `HttpMandateVerificationClient` configured with the active Mandate receipt public keys.

## Deterministic fixtures

- `expired_quote`: enable `demoScenarioControl` and send `X-Demo-Quote-Scenario: expired_quote` plus the matching `X-Demo-Admin-Secret` when creating a quote.
- `cart_changed`, `wrong_merchant`, `unmapped_local_category`, `revoked_mandate`, and `expired_mandate`: construct the local test app with `DemoMandateVerificationClient({ scenario: ... })`.
- The `hm-store-credit-25` and `cb-digital-credit-25` SKUs have deliberately unmapped local categories. The Mandate-side taxonomy adapter must return `UNMAPPED_CATEGORY`; this service never decides that mapping.
- Sending a Harvest quote ID to the City Basket quote or verification route returns `QUOTE_MERCHANT_MISMATCH`.

All test fixtures are synthetic. Private test-only signing material lives exclusively in `src/test-harness.ts`, is not re-exported by the package entry point, and must be replaced by server-only deployment environment values.
