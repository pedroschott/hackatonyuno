# AgentPay decision log

## One user role and one personal account

The challenge flow uses one account owner with multiple saved cards. There are no buyer/admin/judge roles in the product path. This keeps OAuth consent and mandate ownership understandable while RLS still isolates every user's data.

## Store-owned discovery instead of a directory

Agents find products through search or store tools, then read `/.well-known/agentpay.json` on that store. This avoids central catalog drift and lets every merchant own its products and checkout URL.

The supported-store endpoint is a deliberately smaller object than a directory: it contains only merchants that verified a live HTTPS discovery document and opted into listing, with the store URL and discovery URL needed to continue research on that store. AgentPay stores no copied catalog and provides no search ranking. Hosted mock stores work by exact shared URL and never enter this public list.

## The store owns a queryable catalog; AgentPay owns nothing but the question

Agents could not reliably find products. The demo store was a client-rendered page, so the HTML an agent fetched contained no product at all, and the manifest said how to pay but not what existed or what a product id looked like. Agents guessed ids from names and URL slugs, then guessed merchant ids and categories for the mandate, and discovered every guess only at purchase time.

The fix keeps discovery store-owned. The manifest gained optional `catalog_endpoint`, `categories`, `currency` and `product_url_template` fields, and the SDK ships `createAgentPayCatalogHandler`, a route that filters the store's own products by text, exact category, price ceiling and exact id with one shared, deterministic semantics. `find_products` over MCP reads the manifest and asks that endpoint one question. AgentPay never copies, indexes or ranks a catalog; it only relays the store's answer with a `mandate_hint` built from it. Every new manifest field is optional so a store on SDK 0.1.0 is still discovered, and its product pages can still carry the exact id in `agentpay:*` meta tags and JSON-LD.

The rejected alternative was scraping product pages inside AgentPay. It would have made AgentPay a crawler with an opinion about merchandising, put HTML parsing on the purchase path, and still not have produced an id the checkout handler would accept.

## Validate the mandate before the passkey, and explain every refusal

The mandate schema was unlearnable from the tool surface. `create_mandate` took free-text merchant and category strings, and the only feedback for a wrong one was `MERCHANT_NOT_IN_SCOPE` after the user had already signed. `get_mandate` threw on a draft, so an agent polling for authorization saw an exception instead of a status. Refusals named a rule and stopped, and the only tool that changed a mandate was `revoke_mandate`, so agents revoked and recreated, two or three times, for a category typo.

Three changes, all on the enforcement side. `create_mandate` resolves `merchant_urls` to exact ids through discovery and checks the categories against the store's declared vocabulary, failing loud before the user is asked to sign; ids passed verbatim must at least look like `mrc_…`. `check_purchase` runs the same policy engine as checkout against the live mandate without contacting the merchant or recording an attempt, so the agent learns the outcome before the destructive call. Every decision, from `get_mandate`, `check_purchase` and `purchase` alike, carries `explanation`, `remedy` and `next_tool`, and an escalation carries the `approval_url` and the exact `retry_with` arguments. Tool results are also emitted as JSON text, not only `structuredContent`, because a client that renders only `content` was hiding the mandate id from the model.

## A signed mandate is immutable; an amendment is a replacement the user signs

`amend_mandate` exists so that "wrong category" has a path other than revoke-and-recreate, without weakening what a signature means. An unsigned draft is edited in place, since nothing has been signed. A signed mandate is never edited: the tool creates a replacement draft carrying everything forward plus the change, tagged with the mandate it supersedes. Nothing changes until the user signs the replacement with their passkey; at that moment, inside the same request, the old mandate is revoked. There is no window in which both are active with widened authority, and no window in which the agent has nothing.

The rejected alternative was mutating an active mandate under a fresh passkey. It would have re-signed the artifact in place and broken the invariant that a merchant's cached copy of a mandate id always describes the same authority.

## One identity, a separate merchant control plane

The existing Supabase Auth account can own buyer data and any number of merchant integrations, but developer sign-in does not require a buyer passkey. A passkey authorizes spending; making it a prerequisite for registering a store would confuse two trust decisions.

The merchant console generates immutable random `mrc_...` identifiers instead of accepting developer-chosen slugs. Mandates use exact IDs, so changing one later would invalidate policy intent. Merchant ownership, product writes, API-key metadata, and merchant-side attempt reads are isolated by RLS. Merchant activity deliberately excludes buyer identity, card data, and full mandate details.

Ownership lives in a separate RLS-protected membership table so Supabase user UUIDs never become public merchant metadata. Authenticated developers receive column-level updates for editable business fields, but cannot mark themselves agent-ready or verified. Live verification is a server-only registry mutation: an owner-bound database function also requires a dedicated high-entropy proof held only by AgentPay's server. This avoids putting a general Supabase secret key in the application environment. Any later website or discovery URL change clears that result automatically.

Server-side catalog keys are returned once and stored only as SHA-256 hashes. Exact high-entropy key authentication is a narrow `SECURITY DEFINER` boundary with explicit grants; it can create products only for an active merchant. Live merchants remain inactive until AgentPay fetches a public HTTPS manifest, rejects redirects and private network addresses, and verifies that its merchant ID matches the registered identity.

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

## Didit gates new spending authority, without copying biometric data

AgentPay uses Didit's hosted v3 session rather than uploading documents through its own UI. The account holder sees an explicit disclosure and affirmative consent before leaving AgentPay. The server sends Didit a stable Supabase user UUID as `vendor_data`, receives only the hosted `url`, and never exposes the API key or session token to application code beyond the redirect URL Didit generated.

Didit's live create-session response may omit the optional `session_kind` discriminator. AgentPay accepts an omitted value only after validating the session ID, hosted URL, exact user binding, Free KYC workflow binding, and status; an explicit `business` session is still rejected.

Didit is the source of truth for the checks in its published `Free KYC` workflow (`51f322cc-7a71-4259-a8e2-015fd7017ca9`). The workflow ID is a public per-session configuration value pinned in server code, while only the API key and webhook signing key remain in the deployment environment. Paid add-ons, including White Label, stay disabled because they require a cash balance even while the core modules have free usage remaining. This keeps the demo on the free workflow and prevents a missing or drifted environment variable from silently selecting another flow. A mandate or one-time exception cannot be passkey-authorized or used unless the latest session is `Approved` and Didit's linked user entity is neither `FLAGGED` nor `BLOCKED`. The user-facing and MCP paths fail before merchant contact, while a database trigger independently prevents any approved attempt or mock payment token from committing. That final gate also covers mandates that were already active when this integration shipped.

The database trigger has a one-way rollout latch. A schema migration alone does not interrupt the currently deployed demo; the server turns the latch on only after it successfully creates and stores a real Didit session. From that point onward the database gate stays enabled. This makes deployment order safe without creating a runtime bypass once the provider is demonstrably configured.

The normal result path is a v3 webhook authenticated with `X-Signature-V2` over Didit's canonical JSON, with the raw-body signature accepted as a full-body fallback. Events older than five minutes are refused, stable event IDs are de-duplicated in one database transaction, and older status events cannot overwrite newer ones. Signed onboarding or test events that are not bound to an AgentPay user UUID are acknowledged and ignored so Didit does not retry them as delivery failures. The browser return route independently retrieves the decision from Didit, checks the session, user and workflow binding, and reconciles state if a webhook was missed.

AgentPay deliberately persists only the session ID, workflow ID, overall status, environment, linked-entity status and timestamps. It does not store Didit's decision payload, identity documents, selfies, videos, biometric templates, extracted identity data, or provider session token. That makes the fraud boundary demonstrable while keeping AgentPay outside the document and biometric data path.

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

## USD is the single product currency

AgentPay stores every price, mandate limit, attempt and mock payment allowance as exact integer USD cents. It does not fetch exchange rates or compare values across denominations: a merchant product outside USD is refused with `CURRENCY_MISMATCH`.

The forward migration preserves each integer cent amount instead of inventing a one-time exchange rate. Currency is part of the signed mandate artifact, so any active legacy non-USD mandate is revoked and its obsolete authorization material is cleared; the buyer must sign a new USD mandate. Historical audit payloads remain untouched because rewriting them would invalidate the append-only hash chain.

## B2B emergency procurement is the primary demo case

We considered consumer purchases, recurring procurement and emergency operational purchases.

The demo uses an unexpected fleet maintenance event: a vehicle is immobilized, every additional day creates operational cost, and an agent must find the required part from an unfamiliar supplier and complete the purchase quickly.

This scenario demonstrates why agentic purchasing is valuable beyond convenience. The agent can search broadly and act quickly, while AgentPay limits the authority granted to it and keeps the purchase verifiable and auditable.

The rejected primary demo was a simple recurring purchase. It was easier to automate, but did not demonstrate the economic value of discovery, urgency and controlled autonomy as clearly.

## Every purchase states why it was made

An attempt recorded what was bought, under which mandate, and what the policy engine decided. It recorded nothing about the request behind it — and that is precisely what a buyer needs three months later when they do not recognise a charge. The mandate says the purchase was *allowed*; it never said what it was *for*.

`purchase_reason` is now required on every attempt, in the buyer's own words. "The delivery van's front rotors are scored and it runs tomorrow" and "I just want it" are both complete answers; an invented business justification is not, and the tool description says so explicitly, because a model asked for a reason will otherwise manufacture a plausible one.

The requirement lives in `evaluate_agentpay_checkout`, not only in the MCP tool schema. A record with exceptions is not a record: the console trial route had to start supplying a reason too, and it does. The reason is inside the hash-chained audit payload rather than sitting in a column beside it, so it is covered by the same tamper evidence as the decision.

We rejected making it optional with a default. A field that is usually empty is worse than absent — it teaches everyone reading the log that the answer is unavailable, and the one time it matters, it is.

## The delivery address belongs to AgentPay, not to the conversation

An agent that asks "where should I send it?" is asking whoever is talking to it. In a fleet that is a driver, not the person holding the card, and there is no way for the store to tell the difference.

Orders therefore ship to the address on the account, which AgentPay already holds and the buyer confirmed once. `ship_to` on `purchase` is a one-off override for a single order — the depot instead of the yard — merged over the registered address so a partial answer still produces a deliverable parcel, and never written back to the account. `SHIPPING_ADDRESS_REQUIRED` sends the buyer to `/account` to complete their own address rather than dictating one in chat.

The rejected alternative was letting the agent collect and save an address. It moves a fraud primitive into the least authenticated part of the system.

## Shipping is inside the amount the mandate is checked against

A per-purchase limit that covers the sticker price and not the delivery is a limit the buyer did not agree to. Stores quote delivery for the exact destination, so the amount is not knowable until the address is.

`createAgentPayCheckoutHandler` gained `resolveFulfillment`, called before the policy runs. The store returns a delivery quote; the handler evaluates the mandate against `charge.total_cents` — product plus delivery — and returns both halves so nothing is hidden. A store that does not serve the address returns `null` and the handler refuses with `SHIPPING_ADDRESS_UNSUPPORTED` before a mandate use is consumed, which matters because a use spent on an undeliverable order is a use the buyer paid for and did not get.

The approval hash covers the total, so approving a $180 order to the depot does not silently authorise the same part shipped somewhere that costs more. `resolveFulfillment` is optional: a store on SDK 0.2.0 quotes nothing, `charge` is the product price, and its behaviour is unchanged.

## Disputes are the corrective control, and they are not the model's to decide

Every other rule in AgentPay is preventive: a mandate refuses what it does not cover. Nothing handled the case the whole design admits is possible — a charge that was inside the mandate and still wrong. Without that, "revoke the mandate" was the only remedy, which stops the next purchase and does nothing about the one that already happened.

A dispute attaches to one approved attempt. Writes go through `SECURITY DEFINER` functions rather than RLS policies, because the two sides need different powers over the same row: a buyer can open and withdraw, a merchant can answer and resolve, and neither can do the other's. A partial unique index keeps one open case per charge, so "disputing it again" adds to the case rather than opening a second one against the same money.

The analysis reads one dispute against that buyer's history at that merchant — including the purchase reasons recorded at the time — and recommends refund, uphold or request-evidence. It writes only to `analysis`. `status` is set by a person through a different function, so a model that mis-reads a case cannot close it: an LLM with the power to resolve disputes is a new way to move money that nobody agreed to.

With no `ANTHROPIC_API_KEY`, or when the API call fails, a deterministic reading runs instead and says so in `engine`. This is a demo property as much as an engineering one: a judge changing inputs live always gets an answer, and it is always labelled with which engine produced it.

## Merchants see a pseudonym, not a customer

A merchant answering a dispute needs to know whether this is the buyer's first order or their fourth. They do not need to know who the buyer is.

Every merchant-facing surface identifies the account as `sha256(user_id + "|" + merchant_id)`: stable within one merchant, unlinkable across merchants, and never the account id. Delivery addresses reach the merchant because they have to ship to them; identity does not, because they do not.

## The purchase trail is a different question from the security log

The hash-chained log already held everything, interleaved with every other event on the account. That is the right shape for "prove nothing was edited" and the wrong shape for the question people actually ask, which is "what happened with *this* charge?"

Clicking any purchase on `/dashboard` or `/activity` now opens its trail: the four verifications, the mandate it was checked against with that month's usage, the delivery, the reason it was bought, the log entries that name it with their hashes, and the dispute action. Nothing new is stored — it is the same rows, assembled around one attempt.

`search_security_log` gives an agent the same access, including `attempt_id` and `mandate_id` filters for one item's full trail. It verifies the chain over the whole log rather than the matching slice, because verification over a filtered subset would let a removed entry pass unnoticed, and it reports the result on every call so an agent can tell the user the history is intact.

## A published demo account, still an empty one

Signing up depends on one thing that lives outside the system: a confirmation email from a young sending domain, which Gmail, Outlook and iCloud all file as spam, under a 30-per-hour project cap. Someone who never receives it never sees anything.

`demo7421@fwdco.space` is an ordinary account, created through the same public sign-up endpoint as everyone else's and confirmed through the same confirmation link. Its password is published in the README. That does not contradict *No seeded account data*: what is seeded is an account, not account data. It holds no passkey, no card, no identity decision and no mandate, so it renders the same empty dashboard as any new account, and the same passkey signature, Didit decision and mandate check stand between it and a charge. Publishing the password grants what an email address grants — the right to start the flow.

Its one real limit is the passkey: the app offers registration only while an account holds none, so the first device to register a passkey for the shared account is the only one that can sign for it, and the README says so.

The rejected alternative was a demo account pre-loaded with an approved identity decision and a saved card. It would have saved two minutes and cost the property a payments console cannot afford to lose: that what is on the screen was actually enforced, and can be checked.
