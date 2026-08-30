# Didit KYC integration

Didit verifies the identity holder of an AgentPay account. It is a Control Plane capability, not a merchant-SDK capability: stores and agents do not receive the Didit API key, KYC session URL, decision payload, documents, biometric data, or other identity evidence.

## Flow

1. An authenticated user opens **Account → Identity verification**, reads the disclosure, and consents.
2. `POST /api/identity-verification` identifies the user from the Supabase session and creates a Didit session with the fixed Compliance workflow `81cd4c97-fe07-4ec9-943d-f257f6582267` and `vendor_data` bound to the internal user ID.
3. The route stores only the user/session mapping and a status in `public.identity_verifications`, then returns the hosted URL. The web component opens it with `@didit-protocol/sdk-web`.
4. Didit delivers a V3 signed status event to `POST /api/webhooks/didit`. The route enforces a five-minute timestamp window, canonicalizes the payload, verifies `X-Signature-V2` with HMAC-SHA256 in constant time, and applies it once through a service-role-only database function.
5. The account UI reads the user-owned status. Neither the browser callback nor Didit's redirect approves the user.

The current KYC result is intentionally informational for the existing mandate policy. Do not make KYC a mandatory payment gate without an explicit product/policy decision: doing so would change the demo's current passkey approval contract. The status is ready for that future policy input.

## Environment

Keep all values server-side in Vercel and in an uncommitted `.env.local` for local development:

```bash
DIDIT_API_KEY=your-didit-api-key
DIDIT_WEBHOOK_SECRET=your-didit-webhook-signing-secret
SUPABASE_SECRET_KEY=your-supabase-secret-key
```

`DIDIT_API_KEY` and `DIDIT_WEBHOOK_SECRET` must never use a `NEXT_PUBLIC_` prefix. The workflow ID is deliberately code configuration in `lib/didit.ts`, not an environment variable. `SUPABASE_SECRET_KEY` is the existing server-only Supabase key needed to persist a verified webhook; `SUPABASE_SERVICE_ROLE_KEY` remains supported for a project still using legacy keys.

## Deploy and register the webhook

1. Apply `supabase/migrations/20260830035414_add_didit_identity_verification.sql` to the linked project.
2. Add the three server-side values above to the Vercel production environment, then deploy the branch.
3. In the Didit console, create one V3 webhook destination:

   ```json
   {
     "label": "AgentPay production KYC",
     "url": "https://agentpay-yuno.vercel.app/api/webhooks/didit",
     "webhook_version": "v3",
     "subscribed_events": ["status.updated", "data.updated"]
   }
   ```

4. Copy Didit's returned `secret_shared_key` directly to Vercel as `DIDIT_WEBHOOK_SECRET`; do not commit it. Configure Didit's webhook only after the endpoint is deployed at the production hostname.

## Data boundary

`identity_verifications` holds the current session ID, workflow ID, status, and timestamps. It has RLS that permits a user to read only their own status. The service role writes it only after either an authenticated backend request or a successfully verified Didit webhook. `didit_webhook_events` is an idempotency journal with no browser-role grants. No Didit `decision` object, document field, government identifier, selfie, liveness score, or other biometric data is saved in Supabase.

The webhook applies the literal Didit statuses: `Not Started`, `In Progress`, `Awaiting User`, `In Review`, `Approved`, `Declined`, `Resubmitted`, `Abandoned`, `Expired`, and `Kyc Expired`. Duplicate `event_id` deliveries are accepted but do not change state twice. Events older than the stored provider timestamp cannot overwrite a newer status.

## Manual verification

1. Sign in at `/account`, enable the disclosure checkbox, and select **Verify identity**.
2. Confirm the hosted Didit modal receives a newly created session and complete the workflow.
3. In Didit, inspect the V3 delivery to `/api/webhooks/didit`; it must receive `200 ok`.
4. Refresh `/account` and confirm the status is **Verified** only after an `Approved` webhook.
5. Replay the exact delivery from Didit's console. The response remains `200`, and `didit_webhook_events` contains only one row for the `event_id`.
6. Change one character in `X-Signature-V2` or use a timestamp older than five minutes. The endpoint must return `401` and change no database state.
