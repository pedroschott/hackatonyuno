# Mock Store Network Integration Plan

## Purpose

This plan turns the mock merchants into one demonstrable AgentPay store network.
It replaces the split between the legacy AutoParts storefront, source-only V2
merchant APIs, and the standalone Beauty HTML fixture.

AgentPay must not become an agent-facing merchant directory. Each merchant is
discovered from its own storefront and "/.well-known/agentpay.json". The
authenticated AgentPay dashboard may show connected stores to the user, but
the MCP server must not provide a store-listing tool.

## Inventory and target state

| Merchant or fixture | Current state | Target state |
| --- | --- | --- |
| AutoParts | Legacy Next storefront and checkout flow | Automotive reference storefront on the common merchant contract. |
| PneuFast | Seed data and negative policy scenario only | Keep as an out-of-scope attack fixture; do not show it as connected. |
| Harvest Market | V2 Hono API and local catalog; no UI or deployment | Independent grocery storefront and merchant API. |
| City Basket | V2 Hono API and local catalog; no UI or deployment | Independent grocery storefront and merchant API. |
| Maré Botanicals | Standalone Beauty HTML fixture in "demo/beauty-store-mock" | Port its UI/catalog into a merchant storefront; do not merge the fixture unchanged. |

The dashboard shows AutoParts, Harvest Market, City Basket, and Maré
Botanicals. The three new mocks are Harvest, City Basket, and Maré.

## Authority boundaries

1. A merchant owns its catalog, stock, local category, quote, order reference,
   discovery document, and quote-signing key.
2. The Mandate service owns trust tier, canonical-category mapping, policy,
   capabilities, payment-operation state, and revocation decisions.
3. The Vault owns provider token references and authorization/capture state.
   Merchant, MCP client, browser UI, and AgentPay application data never get a
   provider token, card secret, or Vault credential.
4. A merchant cannot self-assign a trust tier or claim that a local category is
   permitted by a mandate.
5. A capability is opaque, short lived, and bound to one quote, cart, and
   merchant. It is not a reusable payment credential.
6. Missing category mapping, stale quote, invalid proof, wrong audience,
   registry failure, or ambiguous settlement state must fail closed.

## Canonical data model

### Safe directory and private registry

Use two separate projections.

"public.merchants" is the authenticated-user directory projection. It contains
safe display and navigation data only:

~~~text
id, slug, name, vertical, storefront_url, discovery_url,
currency, display_status, logo_key, agent_ready
~~~

The dashboard calls an authenticated "GET /api/merchant-directory" endpoint.
It may return mandate compatibility but it must not expose signing material,
trust tiers, provider data, or a generic MCP/search API.

"agentpay_private.merchant_registry" stays as the private authorization
projection. It holds verified endpoint origin, signing key ID and JWK,
lifecycle, and Mandate-service-assigned trust tier. RLS stays enabled and
"anon"/"authenticated" retain no table access.

Before tightening the legacy "public.merchants" policy, refactor AutoParts away
from direct anonymous reads. This avoids breaking checkout during migration.

### Versioned canonical taxonomy

Add these private tables:

~~~text
taxonomy_versions(version, status, created_at)
taxonomy_categories(version, category_id, parent_category_id, display_name)
taxonomy_category_closure(version, ancestor_category_id, descendant_category_id)
merchant_taxonomy_mappings(
  merchant_id, merchant_category_id, taxonomy_version,
  canonical_category, status
)
~~~

The closure table enables indexed, exact parent-category authorization. A
mandate scoped to "food" can permit "food.grains.rice" only when the exact
ancestor/descendant relation exists. A Bloom filter may later pre-filter
catalog search, but it must never make an authorization decision: false
positives are unacceptable in payments.

Initial mappings include:

| Merchant | Local category | Canonical category |
| --- | --- | --- |
| AutoParts | tires | automotive.tires |
| AutoParts | accessories | automotive.accessories |
| Harvest Market | pantry.rice-and-grains | food.grains.rice |
| Harvest Market | fresh.poultry | food.meat.poultry |
| Harvest Market | prepared.burger-kits | food.prepared.burgers |
| City Basket | grocery/dry-goods/rice | food.grains.rice |
| City Basket | meat-and-seafood/chicken | food.meat.poultry |
| City Basket | ready-to-eat/burgers | food.prepared.burgers |
| Maré Botanicals | Ported beauty categories | Defined beauty.* leaves |

Digital/store-credit fixtures remain intentionally unmapped and return
"UNMAPPED_CATEGORY"; they never silently inherit a parent permission.

### Money and catalog ownership

All protocol amounts use integer minor units with an ISO 4217 currency. There
is no automatic FX conversion. Configure all interactive hackathon merchants
in BRL, so one test payment method and mandate works across stores; a quote in
another currency still fails explicitly.

AgentPay must not centralize each merchant catalog. The current "seedProducts"
and "public.products" are legacy AutoParts compatibility data, not a model for
the new stores. Each merchant owns product lookup. AgentPay stores directory
metadata, signed quote snapshots, and user-visible attempt/audit projections.

## Common merchant contract

Every merchant has its own origin, discovery document, key pair, and
server-only configuration. It serves:

~~~text
GET  /.well-known/agentpay.json
POST /v1/agents-pay/search
POST /v1/agents-pay/quotes
GET  /v1/agents-pay/quotes/:quoteId
POST /v1/agents-pay/orders/:merchantOrderRef/verification
~~~

Refactor "apps/merchant-mocks" into a configurable single-merchant runtime.
Each deployment receives "MERCHANT_ID", catalog configuration, its own private
signing key, and the Mandate-service URL. Harvest and City Basket are separate
deployments, not two browser routes with an implicit shared identity. Maré
uses the same contract after its UI port.

Remove "app/.well-known/agentpay.json" from the AgentPay origin after AutoParts
has its own merchant origin. AgentPay owns MCP/OAuth discovery; a merchant owns
merchant discovery.

Port Maré's visual catalog and automation hooks, but replace Pix, boleto, and
local simulated card paths with an AgentPay mandate/quote status. An agent
cannot initiate Pix or access a banking application.

## Dashboard and mandate UX

Add a "ConnectedStores" section to the authenticated dashboard. Each card
shows merchant name, vertical, verified/inactive status, supported canonical
categories, currency, active-mandate compatibility ("covered", "requires
approval", or "outside scope"), storefront URL, and discovery URL.

Replace hard-coded "seedMerchants", product category unions, and the mobile
merchant-name map with directory/taxonomy read models. The contract builder
offers registered merchants and canonical categories; it does not accept an
arbitrary browser-supplied merchant ID.

Historical attempts retain their immutable merchant ID, display snapshot, and
quote reference. A later directory rename must not rewrite audit history.

## V2 purchase and settlement path

Complete durable V2 composition before making new stores available:

~~~text
Agent discovers merchant URL
  -> merchant search and signed quote
  -> Mandate verifies merchant, quote, mapping, trust, and policy
  -> quote-bound opaque capability
  -> merchant atomically claims order verification
  -> Vault authorization
  -> capture after fulfillment condition
  -> immutable attempt and dashboard audit projection
~~~

Replace the legacy "payment_token" path with this sequence behind a feature
flag, then remove the old path after manual acceptance. The in-memory stores
and allow-all authentication remain test-harness-only; Vercel entry points
must use durable Supabase adapters and fail closed.

Revocation rules are fixed:

- Before capture: request Vault void and mark the operation voided.
- After capture: preserve the settlement and start the mocked refund/dispute
  path; do not pretend that the charge was undone.
- During a timeout: mark reconciliation required and do not allow fulfillment
  until a durable terminal result exists.

## Deployment topology

Deploy distinct Vercel projects or aliases:

~~~text
agentpay.<domain>       Dashboard, OAuth, passkeys, MCP
mandate.<domain>        Hono Mandate service
vault.<domain>          Hosted test-payment Vault
autoparts.<domain>      Merchant storefront and API
harvest.<domain>        Merchant storefront and API
citybasket.<domain>     Merchant storefront and API
mare.<domain>           Merchant storefront and API
~~~

Each merchant gets a dedicated signing key and service-proof configuration.
The Vault is separate from the AgentPay browser application. Server-only
environment variables contain URLs, private JWKs, service-proof keys, and
Supabase server credentials; no secret uses a "NEXT_PUBLIC_" name.

## Delivery sequence

Implement on a new integration branch from the latest "main". Do not directly
merge the Beauty PR and do not apply a database migration before schema review.

1. **Directory and taxonomy migration**
   - Add safe directory fields and taxonomy/closure tables.
   - Seed registry entries and mappings for the four interactive stores.
   - Add active-mapping, merchant lookup, and taxonomy-closure indexes.
   - Verify RLS, grants, migration behavior, and database advisors.

2. **Durable V2 adapters**
   - Implement Supabase-backed merchant quote/order/idempotency stores,
     Mandate operations/capabilities, and Vault payment methods.
   - Add service-authenticated proof verification and a fail-closed rate
     limiter.
   - Keep test-harness adapters out of production entry points.

3. **Merchant runtime and storefronts**
   - Deploy configured Harvest and City Basket runtimes.
   - Convert AutoParts to the common discovery and quote contract.
   - Port Maré UI/catalog and remove its non-agentic payment flow.

4. **Dashboard and contracts**
   - Add "GET /api/merchant-directory" and "ConnectedStores".
   - Replace seed data and static merchant/category assumptions.
   - Render safe compatibility state without exposing registry/Vault secrets.

5. **MCP and settlement switch-over**
   - Wire "purchase" to quote, capability, authorize, and capture.
   - Feature-flag the legacy checkout and remove it only after validation.
   - Move discovery documents to merchant origins.

6. **Preview acceptance and merge**
   - Deploy previews with production-like server secrets.
   - Run attack tests and the manual script below.
   - Open a focused PR and merge only after acceptance passes.

## Acceptance checklist

### Automated

- Harvest and City Basket rice products both map to "food.grains.rice" and are
  authorized by the same canonical scope.
- An unmapped credit SKU fails closed.
- Cross-currency, wrong-merchant, tampered-quote, expired-quote, invalid-JWS,
  replay, duplicate-purchase, concurrent overspend, and mid-flight revocation
  produce deterministic refusal or reconciliation.
- A low-trust merchant triggers a quote-bound one-time passkey approval.
- Browser roles cannot read private registry, taxonomy, capability, operation,
  or Vault-token data.

### Manual Vercel preview

1. Register a passkey and save a test payment method in the hosted Vault.
2. See all four interactive stores in Connected stores.
3. Confirm each discovery document is served from its merchant origin.
4. Use MCP to find a product, request the narrowest mandate, and approve it
   with a passkey.
5. Purchase an in-scope product from every merchant and observe settlement and
   audit state in the dashboard.
6. Attempt an unmapped category, low-trust merchant, and PneuFast. Verify the
   expected escalation or refusal.
7. Revoke before capture and during a delayed operation. Verify void or
   reconciliation, with no merchant fulfillment.

## Out of scope

- Real payment processing, real card data, bank login, Pix initiation, and
  automatic currency conversion.
- A public AgentPay catalog or MCP merchant-directory tool.
- npm publication of the internal SDK.
