# Agentic Mandates attack suite

This directory contains declarative security and correctness fixtures for the
critical purchase circuit. They describe the expected result before an
implementation is evaluated, so they can be used against the in-memory demo,
the deployed APIs, or a future end-to-end harness.

## Fixture format

Every `*.json` scenario follows `fixture.schema.json` and contains:

- `preconditions`: deterministic clock, mandate, quote, actor, and mock-payment
  state. Amounts are integer minor units.
- `steps`: semantic actions. A runner maps these to API calls and injects its
  own valid test proofs; fixtures deliberately contain no credentials, JWSs,
  tokens, or card data.
- `expected.outcomes`: the stable HTTP status, decision, reason code, and, when
  applicable, settlement status for each asserted step.
- `expected.invariants`: state that must remain true even when requests race.

`$name` values in a step input refer to a value produced by a prior step. For
example, `$purchaseCapability` is the capability returned by `issue-capability`.

## Runner requirements

A runner should reset all state before each fixture, use the supplied clock,
and validate the response body against the public contracts. It must not use
fixture actor labels as authentication; labels such as `agent-primary` are
instructions for selecting a preconfigured test identity.

For `09-two-concurrent-purchases.json`, start both purchase paths at a barrier
before their authority reservation/claim. The winner is explicitly scheduled
to make the expected outcome reproducible. Regardless of scheduling, the
invariants are mandatory: there can be only one capture and captured authority
can never exceed 50,000 minor units.

The suite intentionally tests the authorization boundary, not payment-card
entry. Payment methods are opaque fixture IDs only; a Vault test adapter owns
any simulated payment behavior.

