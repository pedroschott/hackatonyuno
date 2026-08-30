# AgentPay decision log

## Start with urgent auto-parts procurement

AgentPay's initial vertical focus is auto-parts procurement, especially time-sensitive vehicle repairs and fleet downtime. These are situations where an agent needs to find a compatible part, compare availability and complete the purchase quickly because every extra approval round keeps a vehicle or operation stopped.

Speed does not mean unlimited authority. The account holder approves a narrow mandate in advance, including merchant or category scope, amount, use-count and expiry limits. The agent can then act immediately inside those limits; only an out-of-scope or above-limit purchase returns to the person for a passkey-approved exception. Auto parts are a strong first niche because fitment, inventory, price and delivery constraints are structured, the decision window is short and the cost of delay is visible.

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

The merchant's live read is necessary but not sufficient: revocation can race with the final checkout write after that read. The deployed Supabase checkout and revocation functions therefore take the same transaction-scoped advisory lock keyed by mandate ID. The operation that acquires the lock first commits first. If revocation wins, checkout re-reads `revoked` and cannot mint a payment token; if checkout wins, its approved attempt is committed to the audit trail before revocation. A bounded test-only checkout window and an in-memory blocked-authorization test make the pre-settlement case reproducible without changing the production rule.

## Mock the payment rail, keep enforcement real

No real processor is needed for the challenge. Successful checkout returns a mock single-use token, while authentication, signatures, replay protection, policy evaluation, escalation, audit and revocation remain production-shaped and testable.

## Payment setup stays outside the agent conversation

The MCP payment-setup tool accepts no card fields. It returns a 15-minute, signed, user-bound link to AgentPay's authenticated browser UI, where the challenge flow records only brand, last four digits, an optional label, and an encrypted opaque mock-vault reference. The agent receives only safe display metadata and must tell the user never to share a full card number, CVC, PIN, bank password, or vault credential in chat. Saving a payment method grants no purchase authority; a separate passkey-approved mandate is still required.

## The card choice is signed into each mandate

An account has exactly one default card whenever at least one saved card exists. MCP and REST mandate creation use that default when no explicit card ID is supplied, but the owner can switch a draft through the card picker before passkey signing. Once signed, the payment choice is immutable with the rest of the mandate. Changing the account default therefore affects only future drafts; it can never silently reroute an active mandate.

Checkout validates that the signed card still belongs to the mandate owner, binds its safe ID into the mock token and audit record, and fails closed with `PAYMENT_METHOD_UNAVAILABLE` otherwise. Card removal is refused while a draft or active mandate references it, while historical usage remains visible through the mandate and attempt records.

## Order metadata is private account data, not registry data

Legal name, tax ID, phone and delivery address live in a dedicated user-owned table with RLS and explicit authenticated grants. The authenticated MCP account view may use these fields for a user-requested order, with an instruction to disclose only what that merchant needs. The public merchant registry and payment tokens never include this profile.

## Exact-ID public registry functions are intentional

Merchant checkout must retrieve a signed agent key and mandate without a user session. Two `SECURITY DEFINER` functions expose only exact-ID registry projections; base tables remain protected by RLS. Supabase's linter flags the public executability, but it is the deliberate protocol boundary rather than general table access.

## The full app is responsive; `/m` stays a separate surface

The console at `/dashboard`, `/activity`, `/audit`, `/connect` and `/account` is fully responsive: a single centred column with a tab bar that scrolls horizontally on small screens. Judges can therefore drive the entire demo from a phone without a second implementation.

`/m` is kept anyway because it answers a different question. The console is the owner's full control surface; `/m` is the approval inbox someone opens from a QR code on another device to approve a mandate or exception with a passkey and turn spending off in one tap. Collapsing the two would either bloat the phone approval flow or strip the console.

## The account holder sees no raw protocol, but does see the mandate

Mandate ids, payment tokens, nonces, reason codes, cart hashes and canonical JSON were on every screen. They proved the system worked, to a reader who already knew the system. `lib/plain.ts` is the single place where registry vocabulary becomes a sentence, so no screen can quietly reintroduce a token, and the technical record was moved to where its audience is: the merchant checkout view still shows the four verification checks, and `/audit` still exposes every payload and the hash chain behind each entry.

The first pass at this overcorrected. Removing the word "mandate" left the app saying "who can spend" and "nobody can spend your money", which describes a product AgentPay is not: an agent holding a balance. An agent holds no money and no card. A mandate is a signed authorization layered on the account holder's own payment method — a scope, a set of limits and an expiry that a purchase must fall inside, checked live at the registry on every attempt. A person who reads "turn off spending" and then watches a checkout get refused mid-flight has no word for what actually happened.

The screens therefore name the object again and explain it once: "Active mandates", "requested a mandate", "Revoke mandate", "Within the mandate's limits", "That store is outside the mandate's scope". A mandate card shows the short mandate reference and the card it draws on, so a judge can match what is on screen against `get_mandate` over MCP and against the security log. This is the smallest vocabulary that is still true; reason codes, tokens and canonical JSON stay out of the account holder's screens.

## The app cannot create a mandate; only an agent can ask for one

`/contracts/new` let a person hand-build a mandate in the browser. That is the wrong shape for the product: a mandate is an answer to something an agent asked for, and hand-authoring one skips the conversation that gives it meaning. The form is gone. Mandates are created only through `create_mandate` over MCP, land in "Waiting for you", and become active only after a passkey approval. This also removes the one code path where a mandate existed without an originating agent request.

## No seeded account data

The build shipped with a fictional agent, card, company and pre-authorized mandate so the dashboard looked populated before sign-in. A judge could not tell demo scaffolding from real state, which is the worst property a payments console can have. Agents, cards, mandates, purchases and the audit chain now come only from Supabase for the signed-in user; an empty account renders an empty account. The demo merchant catalogue in `lib/seed.ts` stays, because a store that a real agent buys from has to exist and it is explicitly a merchant fixture, not account data.

## The merchant documentation ships inside the application

A store integrator needs one URL, not a repository tour. `/docs` is a documentation site built from the app's own design system in `app/(docs)/docs/**`, deployed with the code it describes, so a change to `sdk/index.ts` and a change to its documentation land in the same commit and the same deployment. A separate documentation repository or hosted service would have drifted within a day of a hackathon.

`components/docs/nav.ts` is the single source of truth for the sidebar, the client-side search index, page titles and descriptions, previous/next links and `sitemap.xml`. That removes the usual failure mode where a page exists but is unreachable, or is listed twice with two different titles.

There is no MDX pipeline and no syntax-highlighting dependency: pages are TSX using a small prose kit, and the highlighter is a forty-line tokenizer. Content and structure are typechecked with the rest of the app, and the docs add no build step and no runtime dependency.

## The SDK exports its own test helpers

A merchant cannot rehearse an approved purchase without a signed mandate, and could not produce one without canonical JSON and Ed25519 signing. Rather than leave integrators to reverse-engineer both, `@agentpay/merchant-sdk` re-exports `canonicalJson`, `signText`, `signCanonical`, `verifyText`, `generateEd25519KeyPair` and `agentSigningMessage`, plus the registry types. They are generic primitives holding no secret, and they turn "test your integration" from a paragraph of theory into a file a merchant can run offline against a stubbed registry.

`npm run sdk:install -- ../my-store` exists for the same reason: it builds, packs, vendors and installs the package in one step, so the first documented instruction a merchant follows is one command rather than five.

## The root URL is a landing page, not a redirect to the dashboard

`/` used to redirect to `/dashboard`, so the first thing anyone reached was a sign-in wall for a product they had not been told about yet. A judge, an integrator and a crawler all arrive at the root, and none of them start signed in.

`/` is now a static public page that explains the product in the user's terms — connect an assistant, sign a mandate with a passkey, watch every attempt, revoke in one tap — with a single developer section pointing at `/docs`. It is a server component that reads no account state, so `StoreProvider` excludes it from the 1.5s `/api/state` poll alongside `/docs`.

The mandate shown in the hero is deliberately static markup rather than live data: a marketing surface must not depend on a session, and a fabricated "live" panel would be exactly the seeded-demo-data problem this log already rejects. It mirrors what `MandateCard` renders, and the page states that the payment rail is mocked rather than implying settled money.
