# Agentic Mandates

Agentic Mandates is a backend-first foundation for constrained agent purchases. This repository contains the protocol contracts, policy domain, integration SDK, mandate authorization service, and isolated payment vault. It intentionally contains no storefront, product catalog, fake merchant, seeded consumer data, or frontend demo.

## Repository layout

- `packages/contracts`: shared Zod schemas and protocol types.
- `packages/domain`: canonicalization and money-domain helpers.
- `packages/sdk`: typed, proof-signing HTTP clients for agents and merchant backends.
- `apps/mandate-api`: injected Hono service that issues capabilities, verifies merchant settlement requests, and handles revocation.
- `apps/payment-vault`: isolated Hono service boundary for payment-method setup and authorization.
- `tests/attack-suite`: provider-neutral adversarial scenarios for future integration tests.

Applications integrate this foundation by supplying durable stores, identity and request-proof verification, the merchant registry and taxonomy, signing keys, and a payment-provider adapter. In-memory implementations are test harnesses only; they are not runtime defaults.

## Requirements

- Node.js 22 or newer
- pnpm 11.19.0

## Verify

```sh
pnpm install
pnpm check
```

For package-specific usage, see [the SDK guide](packages/sdk/README.md), [Mandate API guide](apps/mandate-api/README.md), and [Payment Vault guide](apps/payment-vault/README.md).

Architecture boundaries and integration responsibilities are recorded in [docs/architecture.md](docs/architecture.md). Cleanup and foundation decisions are recorded in [docs/decisions.md](docs/decisions.md).
