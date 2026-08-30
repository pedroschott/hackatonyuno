# Decision log

## 2026-08-29: Keep this repository backend-first

The repository is the reusable protocol and service foundation, not a demo product. The previous Next.js consumer UI, storefront, seeded state, duplicate merchant SDK, mock merchant service, and Supabase schema tied to that demo were removed.

This makes the integration boundary explicit: a new product repository can consume the SDK and compose the backend services without inheriting fake catalogs, user-facing flows, or a second implementation of the protocol.

## 2026-08-29: Require injected production adapters

Backend app factories continue to require authentication, persistence, registry, signing, and payment dependencies. In-memory implementations remain available for unit tests, but there is no production fallback. This keeps live behavior defensible when inputs or deployment infrastructure change.
