# Payment Vault mock

This is an isolated, test-only card-payment Vault. It models the boundary that a
real tokenization provider would provide; it is not a PCI system or a real
payment processor.

The Vault accepts fixed test fixtures only. It never accepts, hashes, stores,
or returns a card number or security code. The Mandate service receives an
opaque `paymentMethodId`, display-safe brand, and last four digits. The private
Vault record retains its generated provider-token reference.

## Boundaries

- Only a service JWS with `iss=sub=mandate-service` and `aud=payment-vault`
  can call `/internal/v1/*`.
- The JWS is ES256, bound to HTTP method, full URL, raw-body hash, `jti`, and a
  maximum 60-second lifetime. The verifier and durable replay store are
  injected.
- Browser access is limited to the hosted fixture-selection screen. It cannot
  call payment-method exchange, authorization, capture, or void routes.
- Every mutable internal route requires `Idempotency-Key`.

## Routes

| Route | Caller | Purpose |
| --- | --- | --- |
| `GET /hosted/test-payment-methods/setup?session_id=...` | Browser | Renders a fixture-only setup form. |
| `POST /hosted/test-payment-methods/setup` | Browser | Selects a fixture and redirects to the allowlisted BFF return URL with a one-time setup code. |
| `POST /internal/v1/hosted-setup-sessions` | Mandate service | Creates an allowlisted setup session. |
| `POST /internal/v1/hosted-setup-sessions/:id/exchange` | Mandate service | Exchanges a setup code once for an opaque payment-method summary. |
| `POST /internal/v1/payment-methods/test` | Mandate service | Creates an opaque test method directly for seeded/demo use. |
| `POST /internal/v1/payment-authorizations` | Mandate service | Creates an idempotent authorization for one Mandate payment operation. |
| `GET /internal/v1/payment-authorizations/:id` | Mandate service | Reads or reconciles an operation. |
| `POST /internal/v1/payment-authorizations/:id/capture` | Mandate service | Captures an authorized operation. |
| `POST /internal/v1/payment-authorizations/:id/void` | Mandate service | Voids an authorization that has not been captured. |

## Mock Yuno scenarios

`DeterministicMockYunoRouter` routes from the operation ID to exactly one of
two mock card gateways. `InMemoryMockPaymentScenarioResolver` can set a
scenario before the operation begins:

- `approved`
- `declined`
- `authorization_timeout` — the first response requires reconciliation; a
  later status lookup deterministically resolves it.
- `capture_failed`

Scenario choice is never an HTTP request field.

## Runtime composition

`createPaymentVaultApp` has no insecure defaults and no deployment entry
point. A deployable composition root must inject a real service-JWS verifier,
durable replay/idempotency/session/authorization stores, fixed hosted base URL
and callback-origin allowlist, and the Mock Yuno router. The in-memory harness
in `src/test-harness.ts` is test-only and is deliberately excluded from
`src/index.ts`.

Run the focused checks from this directory:

```sh
pnpm test
pnpm build
```
