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

## Revocation and settlement share one ordering boundary

The merchant's live read is necessary but not sufficient: revocation can race with the final checkout write after that read. The deployed Supabase checkout and revocation functions therefore take the same transaction-scoped advisory lock keyed by mandate ID. The operation that acquires the lock first commits first. If revocation wins, checkout re-reads `revoked` and cannot mint a payment token; if checkout wins, its approved attempt is committed to the audit trail before revocation. An eight-second dashboard trial window makes the pre-settlement case visible to judges without changing the production rule.

## Mock the payment rail, keep enforcement real

No real processor is needed for the challenge. Successful checkout returns a mock single-use token, while authentication, signatures, replay protection, policy evaluation, escalation, audit and revocation remain production-shaped and testable.

## Payment setup stays outside the agent conversation

The MCP tool accepts no card fields. It returns a 15-minute, signed, user-bound link to AgentPay's authenticated browser UI, where the challenge flow records only brand, last four digits, an optional label, and an encrypted opaque mock-vault reference. The agent receives only safe display metadata and must tell the user never to share a full card number, CVC, PIN, bank password, or vault credential in chat. Saving a payment method grants no purchase authority; a separate passkey-approved mandate is still required.

## Exact-ID public registry functions are intentional

Merchant checkout must retrieve a signed agent key and mandate without a user session. Two `SECURITY DEFINER` functions expose only exact-ID registry projections; base tables remain protected by RLS. Supabase's linter flags the public executability, but it is the deliberate protocol boundary rather than general table access.

## The full app is responsive; `/m` stays a separate surface

The console at `/dashboard`, `/contracts/new`, `/audit` and `/connect` is fully responsive: below `lg` the sidebar becomes an off-canvas drawer behind a top bar, side rails collapse into a single column, and the fixed limit and scope grids reflow. Judges can therefore drive the entire demo from a phone without a second implementation.

`/m` is kept anyway because it answers a different question. The console is the owner's full control surface; `/m` is the approval inbox someone opens from a QR code on another device to approve a mandate or exception with a passkey and revoke in one tap. Collapsing the two would either bloat the phone approval flow or strip the console. The audit log keeps its columns behind a horizontal scroll rather than dropping data, since an auditor reading it on a phone still needs the actor, action, entity and hash chain.
