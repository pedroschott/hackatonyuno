begin;

-- Application state is kept outside the Data API's exposed schemas. The Vault
-- receives no raw card data in this mock, but its provider token reference is
-- still isolated from Mandate application state.
create schema if not exists mandate_private;
create schema if not exists vault_private;
create schema if not exists extensions;

create extension if not exists ltree with schema extensions;

revoke all on schema mandate_private from public;
revoke all on schema vault_private from public;

create table mandate_private.merchant_registry (
  merchant_id text primary key check (merchant_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  endpoint_url text not null check (endpoint_url ~ '^https?://'),
  signing_key_id text not null check (signing_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  signing_public_jwk jsonb not null check (jsonb_typeof(signing_public_jwk) = 'object'),
  trust_tier smallint not null check (trust_tier between 1 and 3),
  status text not null check (status in ('active', 'inactive', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mandate_private.merchant_taxonomy_mappings (
  merchant_id text not null references mandate_private.merchant_registry(merchant_id) on delete restrict,
  merchant_category_id text not null check (merchant_category_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'),
  taxonomy_version text not null check (taxonomy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  canonical_category_path extensions.ltree not null,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, merchant_category_id, taxonomy_version)
);

create index merchant_taxonomy_mappings_category_path_idx
  on mandate_private.merchant_taxonomy_mappings using gist (canonical_category_path);

create table mandate_private.agent_keys (
  agent_id text not null check (agent_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  key_id text not null check (key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  public_jwk jsonb not null check (jsonb_typeof(public_jwk) = 'object'),
  status text not null check (status in ('active', 'revoked')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (agent_id, key_id),
  check ((status = 'active' and revoked_at is null) or (status = 'revoked' and revoked_at is not null))
);

create table mandate_private.payment_method_summaries (
  payment_method_id text primary key check (payment_method_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  principal_id uuid not null references auth.users(id) on delete restrict,
  brand text not null check (char_length(brand) between 1 and 32),
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  status text not null check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mandate_private.mandates (
  mandate_id text primary key check (mandate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  principal_id uuid not null references auth.users(id) on delete restrict,
  agent_id text not null check (agent_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'active', 'paused', 'revoked', 'expired')),
  payment_method_id text not null references mandate_private.payment_method_summaries(payment_method_id) on delete restrict,
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  policy_hash text not null check (policy_hash ~ '^[A-Za-z0-9_-]{43}$'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  captured_amount_minor bigint not null default 0 check (captured_amount_minor >= 0),
  captured_uses integer not null default 0 check (captured_uses >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_from < valid_until),
  check ((status = 'revoked') = (revoked_at is not null))
);

create index mandates_principal_status_idx
  on mandate_private.mandates (principal_id, status, valid_until);
create index mandates_agent_status_idx
  on mandate_private.mandates (agent_id, status, valid_until);

create table mandate_private.mandate_versions (
  mandate_id text not null references mandate_private.mandates(mandate_id) on delete restrict,
  version integer not null check (version > 0),
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  policy_hash text not null check (policy_hash ~ '^[A-Za-z0-9_-]{43}$'),
  payment_method_id text not null references mandate_private.payment_method_summaries(payment_method_id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (mandate_id, version)
);

create table mandate_private.quote_snapshots (
  quote_id text primary key check (quote_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  merchant_id text not null references mandate_private.merchant_registry(merchant_id) on delete restrict,
  merchant_order_ref text not null check (merchant_order_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  signed_quote jsonb not null check (jsonb_typeof(signed_quote) = 'object'),
  merchant_cart_hash text not null check (merchant_cart_hash ~ '^[A-Za-z0-9_-]{43}$'),
  canonical_cart_hash text not null check (canonical_cart_hash ~ '^[A-Za-z0-9_-]{43}$'),
  taxonomy_version text not null check (taxonomy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  expires_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  unique (merchant_id, merchant_order_ref)
);

create index quote_snapshots_expiry_idx on mandate_private.quote_snapshots (expires_at);

create table mandate_private.approval_requests (
  approval_request_id text primary key check (approval_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  mandate_id text not null references mandate_private.mandates(mandate_id) on delete restrict,
  quote_id text references mandate_private.quote_snapshots(quote_id) on delete restrict,
  purpose text not null check (purpose in ('mandate_activation', 'exception_approval')),
  approval_payload_hash text not null check (approval_payload_hash ~ '^[A-Za-z0-9_-]{43}$'),
  reason_codes text[] not null default '{}' check (cardinality(reason_codes) > 0),
  status text not null check (status in ('pending', 'approved', 'rejected', 'expired', 'invalidated')),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status in ('pending', 'expired', 'invalidated') and resolved_at is null) or (status in ('approved', 'rejected') and resolved_at is not null))
);

create index approval_requests_pending_idx
  on mandate_private.approval_requests (mandate_id, status, expires_at);

create table mandate_private.webauthn_credentials (
  credential_id text primary key check (credential_id ~ '^[A-Za-z0-9_-]{16,1024}$'),
  principal_id uuid not null references auth.users(id) on delete restrict,
  public_key bytea not null,
  algorithm integer not null,
  sign_count bigint not null default 0 check (sign_count >= 0),
  transports jsonb not null default '[]'::jsonb check (jsonb_typeof(transports) = 'array'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table mandate_private.approval_challenges (
  challenge_id text primary key check (challenge_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  approval_request_id text references mandate_private.approval_requests(approval_request_id) on delete restrict,
  principal_id uuid not null references auth.users(id) on delete restrict,
  challenge_hash text not null check (challenge_hash ~ '^[A-Za-z0-9_-]{43}$'),
  approval_payload_hash text not null check (approval_payload_hash ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index approval_challenges_principal_idx
  on mandate_private.approval_challenges (principal_id, expires_at) where consumed_at is null;

create table mandate_private.capabilities (
  capability_id text primary key check (capability_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  token_hash text not null unique check (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  mandate_id text not null references mandate_private.mandates(mandate_id) on delete restrict,
  mandate_version integer not null check (mandate_version > 0),
  agent_id text not null check (agent_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  merchant_id text not null references mandate_private.merchant_registry(merchant_id) on delete restrict,
  quote_id text not null references mandate_private.quote_snapshots(quote_id) on delete restrict,
  canonical_cart_hash text not null check (canonical_cart_hash ~ '^[A-Za-z0-9_-]{43}$'),
  max_amount_minor bigint not null check (max_amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  approval_request_id text references mandate_private.approval_requests(approval_request_id) on delete restrict,
  status text not null check (status in ('issued', 'authorized', 'consumed', 'voided', 'expired')),
  expires_at timestamptz not null,
  authorized_at timestamptz,
  consumed_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status = 'issued' and authorized_at is null and consumed_at is null and voided_at is null)
    or (status = 'authorized' and authorized_at is not null and consumed_at is null and voided_at is null)
    or (status = 'consumed' and authorized_at is not null and consumed_at is not null and voided_at is null)
    or (status = 'voided' and voided_at is not null)
    or status = 'expired'
  )
);

create index capabilities_mandate_live_idx
  on mandate_private.capabilities (mandate_id, status, expires_at);

create table mandate_private.payment_operations (
  operation_id text primary key check (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  mandate_id text not null references mandate_private.mandates(mandate_id) on delete restrict,
  capability_id text not null unique references mandate_private.capabilities(capability_id) on delete restrict,
  merchant_id text not null references mandate_private.merchant_registry(merchant_id) on delete restrict,
  merchant_order_ref text not null check (merchant_order_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  quote_id text not null references mandate_private.quote_snapshots(quote_id) on delete restrict,
  payment_method_id text not null references mandate_private.payment_method_summaries(payment_method_id) on delete restrict,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  state text not null check (state in (
    'created', 'authorization_pending', 'authorized', 'capture_pending',
    'captured', 'void_pending', 'voided', 'failed', 'reconciliation_required'
  )),
  vault_authorization_id text,
  authorization_idempotency_key text not null unique,
  capture_idempotency_key text not null unique,
  void_idempotency_key text not null unique,
  failure_reason_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  captured_at timestamptz,
  unique (merchant_id, merchant_order_ref)
);

create index payment_operations_reconciliation_idx
  on mandate_private.payment_operations (state, updated_at)
  where state in ('authorization_pending', 'capture_pending', 'void_pending', 'reconciliation_required');

create table mandate_private.idempotency_records (
  scope text not null check (char_length(scope) between 1 and 255),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  request_fingerprint text not null check (request_fingerprint ~ '^[A-Za-z0-9_-]{43}$'),
  response_status integer not null check (response_status between 100 and 599),
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (scope, idempotency_key)
);

create index idempotency_records_expiry_idx on mandate_private.idempotency_records (expires_at);

create table mandate_private.request_proof_replays (
  issuer_id text not null check (issuer_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  jti text not null check (jti ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (issuer_id, jti)
);

create index request_proof_replays_expiry_idx on mandate_private.request_proof_replays (expires_at);

create table mandate_private.recurrence_schedules (
  mandate_id text primary key references mandate_private.mandates(mandate_id) on delete restrict,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  timezone text not null check (char_length(timezone) between 1 and 100),
  local_run_time time not null,
  execution_window_minutes integer not null check (execution_window_minutes between 1 and 1_440),
  max_occurrences integer not null check (max_occurrences > 0),
  executed_occurrences integer not null default 0 check (executed_occurrences >= 0),
  recurring_intent_template jsonb not null check (jsonb_typeof(recurring_intent_template) = 'object'),
  next_run_at_utc timestamptz not null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recurrence_schedules_due_idx
  on mandate_private.recurrence_schedules (next_run_at_utc)
  where status = 'active';

create table mandate_private.recurrence_runs (
  recurrence_run_id text primary key check (recurrence_run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  mandate_id text not null references mandate_private.mandates(mandate_id) on delete restrict,
  schedule_slot timestamptz not null,
  status text not null check (status in ('due', 'agent_dispatched', 'approval_pending', 'completed', 'skipped', 'failed')),
  reason_code text,
  purchase_operation_id text references mandate_private.payment_operations(operation_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mandate_id, schedule_slot)
);

create table mandate_private.audit_events (
  audit_event_id text primary key check (audit_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  principal_id uuid references auth.users(id) on delete restrict,
  aggregate_type text not null check (char_length(aggregate_type) between 1 and 80),
  aggregate_id text not null check (char_length(aggregate_id) between 1 and 160),
  event_type text not null check (char_length(event_type) between 1 and 120),
  event_payload jsonb not null check (jsonb_typeof(event_payload) = 'object'),
  previous_event_hash text check (previous_event_hash is null or previous_event_hash ~ '^[A-Za-z0-9_-]{43}$'),
  event_hash text not null unique check (event_hash ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now()
);

create index audit_events_aggregate_idx
  on mandate_private.audit_events (aggregate_type, aggregate_id, created_at);
create index audit_events_principal_idx
  on mandate_private.audit_events (principal_id, created_at);

create table vault_private.payment_methods (
  payment_method_id text primary key check (payment_method_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  principal_id uuid not null references auth.users(id) on delete restrict,
  provider_token_ref text not null unique check (char_length(provider_token_ref) between 16 and 255),
  brand text not null check (char_length(brand) between 1 and 32),
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  status text not null check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table vault_private.payment_authorizations (
  vault_authorization_id text primary key check (vault_authorization_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  operation_id text not null unique check (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  payment_method_id text not null references vault_private.payment_methods(payment_method_id) on delete restrict,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  merchant_reference text not null check (char_length(merchant_reference) between 1 and 160),
  gateway_id text not null check (char_length(gateway_id) between 1 and 80),
  state text not null check (state in (
    'authorization_pending', 'authorized', 'captured', 'voided', 'declined', 'reconciliation_required', 'capture_failed'
  )),
  authorization_idempotency_key text not null unique,
  capture_idempotency_key text unique,
  void_idempotency_key text unique,
  scenario text not null check (scenario in ('approved', 'declined', 'authorization_timeout', 'capture_failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  captured_at timestamptz,
  voided_at timestamptz
);

create index payment_authorizations_operation_state_idx
  on vault_private.payment_authorizations (operation_id, state);

create table vault_private.idempotency_records (
  scope text not null check (char_length(scope) between 1 and 255),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  request_fingerprint text not null check (request_fingerprint ~ '^[A-Za-z0-9_-]{43}$'),
  response_status integer not null check (response_status between 100 and 599),
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (scope, idempotency_key)
);

create or replace function mandate_private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function mandate_private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'audit events are append-only';
end;
$$;

create trigger merchant_registry_set_updated_at
before update on mandate_private.merchant_registry
for each row execute function mandate_private.set_updated_at();

create trigger merchant_taxonomy_mappings_set_updated_at
before update on mandate_private.merchant_taxonomy_mappings
for each row execute function mandate_private.set_updated_at();

create trigger payment_method_summaries_set_updated_at
before update on mandate_private.payment_method_summaries
for each row execute function mandate_private.set_updated_at();

create trigger mandates_set_updated_at
before update on mandate_private.mandates
for each row execute function mandate_private.set_updated_at();

create trigger payment_operations_set_updated_at
before update on mandate_private.payment_operations
for each row execute function mandate_private.set_updated_at();

create trigger recurrence_schedules_set_updated_at
before update on mandate_private.recurrence_schedules
for each row execute function mandate_private.set_updated_at();

create trigger recurrence_runs_set_updated_at
before update on mandate_private.recurrence_runs
for each row execute function mandate_private.set_updated_at();

create trigger vault_payment_methods_set_updated_at
before update on vault_private.payment_methods
for each row execute function mandate_private.set_updated_at();

create trigger vault_payment_authorizations_set_updated_at
before update on vault_private.payment_authorizations
for each row execute function mandate_private.set_updated_at();

create trigger audit_events_no_update
before update on mandate_private.audit_events
for each row execute function mandate_private.prevent_audit_mutation();

create trigger audit_events_no_delete
before delete on mandate_private.audit_events
for each row execute function mandate_private.prevent_audit_mutation();

revoke all on all tables in schema mandate_private from public;
revoke all on all tables in schema vault_private from public;
revoke all on all sequences in schema mandate_private from public;
revoke all on all sequences in schema vault_private from public;

alter default privileges in schema mandate_private revoke all on tables from public;
alter default privileges in schema vault_private revoke all on tables from public;

commit;
