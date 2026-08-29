# Mandate API core

This package owns the server-side authorization circuit for one Agentic
Mandates purchase. It exposes an injected Hono application:

- `POST /v1/agent/intents` accepts only a quote reference from an authenticated agent and emits a short-lived ES256 capability after independently validating the registry, quote signature, taxonomy, and deterministic policy.
- `POST /v1/merchant/verifications` accepts a merchant service request plus that capability, refetches and validates the quote, atomically claims the capability, and drives the injected Vault authorization/capture saga.
- `POST /v1/mandates/:mandateId/revocations` authenticates the principal through an injected browser/BFF adapter and makes subsequent verification fail synchronously.

`createMandateApiApp` has no production fallback authentication, storage,
merchant URL, signing key, payment method, or payment provider. Production
composition must inject ES256 request-proof authenticators, a durable
transactional `MandateStateStore`, a Mandate-owned merchant registry/taxonomy,
an immutable `MandateTrustPolicyStore`, and an HTTP `PaymentVaultClient` backed
by the isolated test Payment Vault. Merchant trust comes only from the Mandate
registry; a minimum trust tier is a contract constraint, not merchant input.

The core accepts only an opaque `paymentMethodId`; it never accepts raw card
data, provider tokens, browser payment data, or a direct agent-to-Vault path.
`src/test-harness.ts` provides in-memory identities and deterministic merchant
and payment fixtures for tests only.

Run the package checks from the repository root:

```sh
pnpm --filter @agentic-mandates/mandate-api typecheck
pnpm --filter @agentic-mandates/mandate-api test
```
