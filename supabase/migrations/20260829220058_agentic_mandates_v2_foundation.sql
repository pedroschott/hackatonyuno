begin;

-- V2 is additive: the existing public AgentPay tables remain the source of
-- truth for user-visible mandates, passkeys, approvals, and audit records.
-- Provider references and settlement state are deliberately kept out of the
-- public Data API.
create schema if not exists agentpay_private;
create schema if not exists vault_private;

revoke all on schema agentpay_private from public;
revoke all on schema vault_private from public;

create table agentpay_private.merchant_registry (
  merchant_id text primary key references public.merchants(id) on delete restrict,
  endpoint_url text not null check (endpoint_url ~ '^https://'),
  signing_key_id text not null check (signing_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  signing_public_jwk jsonb not null check (jsonb_typeof(signing_public_jwk) = 'object'),
  trust_tier smallint not null check (trust_tier between 1 and 3),
  status text not null check (status in ('active', 'inactive', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table agentpay_private.merchant_registry is
  'Mandate-service-owned merchant identity, endpoint, signing key, and trust tier.';

create table agentpay_private.merchant_taxonomy_mappings (
  merchant_id text not null references agentpay_private.merchant_registry(merchant_id) on delete restrict,
  merchant_category_id text not null check (merchant_category_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'),
  taxonomy_version text not null check (taxonomy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  canonical_category text not null check (canonical_category ~ '^[a-z][a-z0-9._/-]{0,159}$'),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, merchant_category_id, taxonomy_version)
);

create index merchant_taxonomy_mappings_canonical_category_idx
  on agentpay_private.merchant_taxonomy_mappings (canonical_category)
  where status = 'active';

-- The public card record remains display-only. This row is created only by
-- the hosted test Vault; the Mandate service never reads provider_token_ref.
create table vault_private.payment_methods (
  payment_method_id uuid primary key references public.vault_cards(id) on delete restrict,
  principal_id uuid not null references auth.users(id) on delete restrict,
  provider_token_ref text not null unique check (char_length(provider_token_ref) between 16 and 255),
  brand text not null check (char_length(brand) between 2 and 32),
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table vault_private.payment_methods is
  'Hosted test-payment Vault state. Provider token references never leave this schema or Vault service.';

create table agentpay_private.quote_snapshots (
  quote_id text primary key check (quote_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  merchant_id text not null references agentpay_private.merchant_registry(merchant_id) on delete restrict,
  merchant_order_ref text not null check (merchant_order_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  merchant_category_id text not null check (merchant_category_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'),
  canonical_category text not null check (canonical_category ~ '^[a-z][a-z0-9._/-]{0,159}$'),
  taxonomy_version text not null check (taxonomy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  cart_hash text not null check (cart_hash ~ '^[A-Za-z0-9_-]{43}$'),
  signed_quote jsonb not null check (jsonb_typeof(signed_quote) = 'object'),
  expires_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  unique (merchant_id, merchant_order_ref)
);

create index quote_snapshots_expiry_idx
  on agentpay_private.quote_snapshots (expires_at);

create table agentpay_private.payment_operations (
  operation_id uuid primary key,
  mandate_id uuid not null references public.mandates(id) on delete restrict,
  merchant_id text not null references agentpay_private.merchant_registry(merchant_id) on delete restrict,
  merchant_order_ref text not null check (merchant_order_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  quote_id text not null references agentpay_private.quote_snapshots(quote_id) on delete restrict,
  payment_method_id uuid not null references vault_private.payment_methods(payment_method_id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
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
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, merchant_order_ref)
);

create index payment_operations_reconciliation_idx
  on agentpay_private.payment_operations (state, updated_at)
  where state in ('authorization_pending', 'capture_pending', 'void_pending', 'reconciliation_required');

create table agentpay_private.capabilities (
  capability_id uuid primary key,
  token_hash text not null unique check (token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  operation_id uuid not null unique references agentpay_private.payment_operations(operation_id) on delete restrict,
  mandate_id uuid not null references public.mandates(id) on delete restrict,
  agent_id text not null references public.agents(id) on delete restrict,
  merchant_id text not null references agentpay_private.merchant_registry(merchant_id) on delete restrict,
  quote_id text not null references agentpay_private.quote_snapshots(quote_id) on delete restrict,
  cart_hash text not null check (cart_hash ~ '^[A-Za-z0-9_-]{43}$'),
  max_amount_cents integer not null check (max_amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('issued', 'authorized', 'consumed', 'voided', 'expired')),
  expires_at timestamptz not null,
  authorized_at timestamptz,
  consumed_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);

create index capabilities_mandate_live_idx
  on agentpay_private.capabilities (mandate_id, status, expires_at);

create table agentpay_private.idempotency_records (
  scope text not null check (char_length(scope) between 1 and 255),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  request_fingerprint text not null check (request_fingerprint ~ '^[A-Za-z0-9_-]{43}$'),
  response_status integer not null check (response_status between 100 and 599),
  response_body jsonb not null check (jsonb_typeof(response_body) in ('object', 'array')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (scope, idempotency_key)
);

create index idempotency_records_expiry_idx
  on agentpay_private.idempotency_records (expires_at);

create table agentpay_private.request_proof_replays (
  key_id text not null check (key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  jti text not null check (jti ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (key_id, jti)
);

create index request_proof_replays_expiry_idx
  on agentpay_private.request_proof_replays (expires_at);

create table agentpay_private.recurrence_schedules (
  mandate_id uuid primary key references public.mandates(id) on delete restrict,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  timezone text not null check (char_length(timezone) between 1 and 100),
  local_run_time time not null,
  execution_window_minutes integer not null check (execution_window_minutes between 1 and 1440),
  max_occurrences integer not null check (max_occurrences > 0),
  executed_occurrences integer not null default 0 check (executed_occurrences >= 0),
  intent_template jsonb not null check (jsonb_typeof(intent_template) = 'object'),
  next_run_at_utc timestamptz not null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recurrence_schedules_due_idx
  on agentpay_private.recurrence_schedules (next_run_at_utc)
  where status = 'active';

create table agentpay_private.recurrence_runs (
  recurrence_run_id uuid primary key,
  mandate_id uuid not null references public.mandates(id) on delete restrict,
  schedule_slot timestamptz not null,
  status text not null check (status in ('due', 'processing', 'approval_pending', 'completed', 'skipped', 'failed')),
  reason_code text,
  payment_operation_id uuid references agentpay_private.payment_operations(operation_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mandate_id, schedule_slot)
);

create index recurrence_runs_pending_idx
  on agentpay_private.recurrence_runs (status, created_at)
  where status in ('due', 'processing', 'approval_pending');

alter table agentpay_private.merchant_registry enable row level security;
alter table agentpay_private.merchant_taxonomy_mappings enable row level security;
alter table agentpay_private.quote_snapshots enable row level security;
alter table agentpay_private.payment_operations enable row level security;
alter table agentpay_private.capabilities enable row level security;
alter table agentpay_private.idempotency_records enable row level security;
alter table agentpay_private.request_proof_replays enable row level security;
alter table agentpay_private.recurrence_schedules enable row level security;
alter table agentpay_private.recurrence_runs enable row level security;
alter table vault_private.payment_methods enable row level security;

revoke all on all tables in schema agentpay_private from anon, authenticated;
revoke all on all tables in schema vault_private from anon, authenticated;

commit;
