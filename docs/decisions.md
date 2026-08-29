# AgentPay decision log

## One user role and one personal account

The challenge flow uses one account owner with multiple saved cards. There are no buyer/admin/judge roles in the product path. This keeps OAuth consent and mandate ownership understandable while RLS still isolates every user's data.

## Store-owned discovery instead of a directory

Agents find products through search or store tools, then read `/.well-known/agentpay.json` on that store. This avoids central catalog drift and lets every merchant own its products and checkout URL.

## OAuth-protected MCP as the agent connection

The remote `/mcp` server publishes protected-resource metadata and delegates OAuth/OIDC, PKCE and dynamic client registration to Supabase. An access token identifies the user; tool input never selects an arbitrary user.

## Real WebAuthn for authority, not a simulated approval button

Registration and approval use SimpleWebAuthn. The server verifies the credential, origin, RP ID, counter and transaction challenge. Mandate approval signs the canonical mandate hash; one-time exceptions use a challenge bound to that exact exception.

AgentPay binds WebAuthn to its exact canonical hostname instead of a shared parent domain. Registration requires a discoverable, user-verified platform authenticator and prefers the local device, so Face ID or Touch ID is used instead of silently falling into a cross-device QR loop. Because changing the RP ID invalidates credentials created under the old ID, a domain correction requires users to enroll a new passkey.

## Live registry status on every checkout

A long-lived bearer payment credential would make revocation unreliable. The merchant SDK instead verifies the registry's signature and current mandate status for every purchase, so user- or agent-initiated revocation stops the next attempt.

## Mock the payment rail, keep enforcement real

No real processor is needed for the challenge. Successful checkout returns a mock single-use token, while authentication, signatures, replay protection, policy evaluation, escalation, audit and revocation remain production-shaped and testable.

## Payment setup stays outside the agent conversation

The MCP tool accepts no card fields. It returns a 15-minute, signed, user-bound link to AgentPay's authenticated browser UI, where the challenge flow records only brand, last four digits, an optional label, and an encrypted opaque mock-vault reference. The agent receives only safe display metadata and must tell the user never to share a full card number, CVC, PIN, bank password, or vault credential in chat. Saving a payment method grants no purchase authority; a separate passkey-approved mandate is still required.

## Exact-ID public registry functions are intentional

Merchant checkout must retrieve a signed agent key and mandate without a user session. Two `SECURITY DEFINER` functions expose only exact-ID registry projections; base tables remain protected by RLS. Supabase's linter flags the public executability, but it is the deliberate protocol boundary rather than general table access.
