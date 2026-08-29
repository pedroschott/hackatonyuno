create extension if not exists pgcrypto with schema extensions;

create table public.agents (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Personal shopping agent',
  public_key text not null,
  created_at timestamptz not null default now(),
  unique (owner_id)
);

create table public.agent_secrets (
  agent_id text primary key references public.agents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  encrypted_private_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id)
);

create table public.merchants (
  id text primary key,
  name text not null,
  category text not null,
  agent_ready boolean not null default true,
  checkout_url text
);

create table public.products (
  id text primary key,
  merchant_id text not null references public.merchants(id) on delete cascade,
  name text not null,
  category text not null,
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'BRL' check (char_length(currency) = 3)
);

create table public.vault_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand text not null check (char_length(brand) between 2 and 32),
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  payment_ref text not null unique,
  created_at timestamptz not null default now()
);

comment on table public.vault_cards is
  'Mock card vault. Stores brand, last four digits, and an opaque payment reference only; never PAN or CVV.';

create table public.webauthn_credentials (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  public_key text not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text,
  backed_up boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, id)
);

create table public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('register', 'mandate', 'approval')),
  entity_id uuid,
  challenge text not null,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.mandates (
  id uuid primary key default gen_random_uuid(),
  issuer_user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null references public.agents(id),
  type text not null default 'intent' check (type = 'intent'),
  scope jsonb not null,
  limits jsonb not null,
  validity jsonb not null,
  payment jsonb not null,
  "authorization" jsonb,
  server_sig text,
  status text not null default 'draft' check (status in ('draft', 'active', 'revoked', 'expired')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references public.mandates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  merchant_id text not null,
  product_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  decision text not null check (decision in ('approved', 'refused', 'escalated')),
  reason_code text,
  exception_id uuid,
  cart_hash text not null,
  payment_token jsonb,
  verification jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mandate_id uuid not null references public.mandates(id) on delete cascade,
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  cart_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  decided_at timestamptz,
  consumed_at timestamptz,
  "authorization" jsonb,
  created_at timestamptz not null default now()
);

alter table public.attempts
  add constraint attempts_exception_id_fkey
  foreign key (exception_id) references public.approvals(id);

create table public.audit_log (
  seq bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ts timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity text,
  payload jsonb not null default '{}'::jsonb,
  prev_hash text not null,
  hash text not null unique
);

create table public.used_nonces (
  nonce text primary key,
  agent_id text not null,
  seen_at timestamptz not null default now()
);

create index attempts_mandate_created_idx on public.attempts (mandate_id, created_at desc);
create index approvals_user_status_idx on public.approvals (user_id, status, created_at desc);
create index mandates_user_status_idx on public.mandates (issuer_user_id, status, created_at desc);
create index audit_user_seq_idx on public.audit_log (user_id, seq desc);
create index nonce_seen_at_idx on public.used_nonces (seen_at);

alter table public.agents enable row level security;
alter table public.agent_secrets enable row level security;
alter table public.merchants enable row level security;
alter table public.products enable row level security;
alter table public.vault_cards enable row level security;
alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_challenges enable row level security;
alter table public.mandates enable row level security;
alter table public.attempts enable row level security;
alter table public.approvals enable row level security;
alter table public.audit_log enable row level security;
alter table public.used_nonces enable row level security;

create policy "Public agent keys are readable"
  on public.agents for select to anon, authenticated using (true);
create policy "Users create their own agent"
  on public.agents for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Users update their own agent"
  on public.agents for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create policy "Users read their encrypted agent key"
  on public.agent_secrets for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users create their encrypted agent key"
  on public.agent_secrets for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update their encrypted agent key"
  on public.agent_secrets for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Merchant metadata is public"
  on public.merchants for select to anon, authenticated using (agent_ready = true);
create policy "Product catalog is public"
  on public.products for select to anon, authenticated using (true);

create policy "Users read their cards"
  on public.vault_cards for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add their cards"
  on public.vault_cards for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users delete their cards"
  on public.vault_cards for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users manage their transaction passkeys"
  on public.webauthn_credentials for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage their WebAuthn challenges"
  on public.webauthn_challenges for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Users manage their mandates"
  on public.mandates for all to authenticated
  using ((select auth.uid()) = issuer_user_id) with check ((select auth.uid()) = issuer_user_id);
create policy "Users read their attempts"
  on public.attempts for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users record their attempts"
  on public.attempts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users manage their approvals"
  on public.approvals for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users read their audit trail"
  on public.audit_log for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users append their audit trail"
  on public.audit_log for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Verified merchant handlers consume nonces"
  on public.used_nonces for insert to anon, authenticated
  with check (seen_at between now() - interval '1 minute' and now() + interval '1 minute');

grant select, insert, update on public.agents to authenticated;
grant select on public.agents to anon;
grant select, insert, update on public.agent_secrets to authenticated;
grant select on public.merchants, public.products to anon, authenticated;
grant select, insert, delete on public.vault_cards to authenticated;
grant select, insert, update, delete on public.webauthn_credentials to authenticated;
grant select, insert, update, delete on public.webauthn_challenges to authenticated;
grant select, insert, update, delete on public.mandates to authenticated;
grant select, insert on public.attempts to authenticated;
grant select, insert, update on public.approvals to authenticated;
grant select, insert on public.audit_log to authenticated;
grant insert on public.used_nonces to anon, authenticated;
grant usage, select on sequence public.audit_log_seq_seq to authenticated;

create or replace function public.append_agentpay_audit(
  p_actor text,
  p_action text,
  p_entity text default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_prev text;
  v_hash text;
  v_ts timestamptz := clock_timestamp();
  v_seq bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  select a.hash into v_prev
  from public.audit_log a
  where a.user_id = v_user_id
  order by a.seq desc
  limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  v_hash := encode(
    extensions.digest(
      convert_to(v_prev || v_ts::text || p_actor || p_action || coalesce(p_entity, '') || p_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into public.audit_log (user_id, ts, actor, action, entity, payload, prev_hash, hash)
  values (v_user_id, v_ts, p_actor, p_action, p_entity, p_payload, v_prev, v_hash)
  returning seq into v_seq;

  return jsonb_build_object('seq', v_seq, 'hash', v_hash, 'prev_hash', v_prev);
end;
$$;

revoke all on function public.append_agentpay_audit(text, text, text, jsonb) from public;
grant execute on function public.append_agentpay_audit(text, text, text, jsonb) to authenticated;

create or replace function public.get_mandate_registry(p_mandate_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'mandate_id', m.id,
    'type', m.type,
    'issuer', jsonb_build_object('user_id', m.issuer_user_id),
    'agent', jsonb_build_object('agent_id', a.id, 'public_key', a.public_key),
    'scope', m.scope,
    'limits', m.limits,
    'validity', m.validity,
    'payment', m.payment,
    'authorization', m."authorization",
    'server_sig', m.server_sig,
    'status', m.status,
    'usage', jsonb_build_object(
      'approved_uses', count(t.id) filter (where t.decision = 'approved'),
      'cumulative_cents', coalesce(sum(t.amount_cents) filter (where t.decision = 'approved'), 0)
    )
  )
  from public.mandates m
  join public.agents a on a.id = m.agent_id
  left join public.attempts t
    on t.mandate_id = m.id
    and t.created_at >= date_trunc('month', now())
  where m.id = p_mandate_id
    and m.status <> 'draft'
  group by m.id, a.id, a.public_key;
$$;

comment on function public.get_mandate_registry(uuid) is
  'Intentional public liveness endpoint. Returns one sanitized mandate by unguessable UUID; never lists mandates.';
revoke all on function public.get_mandate_registry(uuid) from public;
grant execute on function public.get_mandate_registry(uuid) to anon, authenticated;

create or replace function public.revoke_agentpay_mandate(p_mandate_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.mandates;
begin
  update public.mandates
  set status = 'revoked', revoked_at = coalesce(revoked_at, now()), updated_at = now()
  where id = p_mandate_id
    and issuer_user_id = (select auth.uid())
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Mandate not found';
  end if;

  perform public.append_agentpay_audit(
    'user:' || (select auth.uid())::text,
    'mandate.revoked',
    p_mandate_id::text,
    jsonb_build_object('status', 'revoked')
  );
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'revoked_at', v_row.revoked_at);
end;
$$;

revoke all on function public.revoke_agentpay_mandate(uuid) from public;
grant execute on function public.revoke_agentpay_mandate(uuid) to authenticated;

create or replace function public.evaluate_agentpay_checkout(
  p_mandate_id uuid,
  p_agent_id text,
  p_merchant_id text,
  p_product_id text,
  p_category text,
  p_amount_cents integer,
  p_currency text,
  p_exception_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_mandate public.mandates;
  v_attempt_id uuid := gen_random_uuid();
  v_approval_id uuid;
  v_decision text := 'approved';
  v_reason text;
  v_uses integer := 0;
  v_cumulative bigint := 0;
  v_cart_hash text;
  v_payment_token jsonb;
  v_exception_valid boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_mandate_id::text, 0));
  select * into v_mandate
  from public.mandates
  where id = p_mandate_id and issuer_user_id = v_user_id;

  if v_mandate.id is null then
    return jsonb_build_object('decision', 'refused', 'reason_code', 'MANDATE_NOT_FOUND');
  end if;

  if p_amount_cents <= 0 or char_length(p_currency) <> 3 or p_category = '' then
    raise exception 'Invalid merchant cart';
  end if;

  v_cart_hash := encode(
    extensions.digest(
      convert_to(p_mandate_id::text || '|' || p_merchant_id || '|' || p_product_id || '|' || p_amount_cents::text || '|' || p_currency, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select
    count(*) filter (where decision = 'approved'),
    coalesce(sum(amount_cents) filter (where decision = 'approved'), 0)
  into v_uses, v_cumulative
  from public.attempts
  where mandate_id = p_mandate_id
    and created_at >= date_trunc('month', now());

  if p_exception_id is not null then
    select exists(
      select 1 from public.approvals ap
      where ap.id = p_exception_id
        and ap.user_id = v_user_id
        and ap.mandate_id = p_mandate_id
        and ap.cart_hash = v_cart_hash
        and ap.status = 'approved'
        and ap.consumed_at is null
    ) into v_exception_valid;
  end if;

  if p_agent_id <> v_mandate.agent_id then
    v_decision := 'refused'; v_reason := 'AGENT_SIGNATURE_INVALID';
  elsif v_mandate.status = 'revoked' then
    v_decision := 'refused'; v_reason := 'MANDATE_REVOKED';
  elsif v_mandate.status <> 'active'
    or now() < (v_mandate.validity->>'not_before')::timestamptz
    or now() > (v_mandate.validity->>'expires_at')::timestamptz then
    v_decision := 'refused'; v_reason := 'MANDATE_EXPIRED';
  elsif not ((v_mandate.scope->'merchants') ? p_merchant_id) then
    v_decision := 'refused'; v_reason := 'MERCHANT_NOT_IN_SCOPE';
  elsif not ((v_mandate.scope->'categories') ? p_category) then
    v_decision := 'refused'; v_reason := 'CATEGORY_NOT_IN_SCOPE';
  elsif v_uses >= (v_mandate.limits->>'max_uses')::integer then
    v_decision := 'refused'; v_reason := 'USES_EXCEEDED';
  elsif v_cumulative + p_amount_cents > (v_mandate.limits->>'cumulative_cents')::bigint then
    v_decision := 'refused'; v_reason := 'CUMULATIVE_EXCEEDED';
  elsif p_amount_cents > (v_mandate.limits->>'per_purchase_cents')::integer
    and not v_exception_valid then
    v_decision := 'escalated'; v_reason := 'AMOUNT_EXCEEDS_LIMIT';
  end if;

  if v_decision = 'approved' then
    v_payment_token := jsonb_build_object(
      'token', 'vt_mock_' || replace(gen_random_uuid()::text, '-', ''),
      'allowance', jsonb_build_object(
        'reason', case when v_exception_valid then 'approved_exception' else 'one_time' end,
        'max_amount_cents', p_amount_cents,
        'currency', p_currency,
        'merchant_id', p_merchant_id,
        'attempt_id', v_attempt_id,
        'expires_at', now() + interval '5 minutes'
      )
    );
  end if;

  insert into public.attempts (
    id, mandate_id, user_id, agent_id, merchant_id, product_id, amount_cents,
    currency, decision, reason_code, exception_id, cart_hash, payment_token, verification
  ) values (
    v_attempt_id, p_mandate_id, v_user_id, p_agent_id, p_merchant_id, p_product_id,
    p_amount_cents, p_currency, v_decision, v_reason,
    case when v_exception_valid then p_exception_id else null end,
    v_cart_hash, v_payment_token,
    jsonb_build_object('agent_signature', true, 'mandate_signature', v_mandate.server_sig is not null,
      'registry_status', v_mandate.status, 'policy_engine', 'postgres-v1')
  );

  if v_exception_valid then
    update public.approvals set consumed_at = now() where id = p_exception_id;
  elsif v_decision = 'escalated' then
    insert into public.approvals (user_id, mandate_id, attempt_id, cart_hash)
    values (v_user_id, p_mandate_id, v_attempt_id, v_cart_hash)
    returning id into v_approval_id;
  end if;

  perform public.append_agentpay_audit(
    'agent:' || p_agent_id,
    'attempt.' || v_decision,
    v_attempt_id::text,
    jsonb_build_object(
      'mandate_id', p_mandate_id,
      'merchant_id', p_merchant_id,
      'product_id', p_product_id,
      'amount_cents', p_amount_cents,
      'reason_code', v_reason,
      'approval_id', v_approval_id
    )
  );

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'decision', v_decision,
    'reason_code', v_reason,
    'approval_id', v_approval_id,
    'payment_token', v_payment_token
  );
end;
$$;

revoke all on function public.evaluate_agentpay_checkout(uuid, text, text, text, text, integer, text, uuid) from public;
grant execute on function public.evaluate_agentpay_checkout(uuid, text, text, text, text, integer, text, uuid) to authenticated;

insert into public.merchants (id, name, category, agent_ready)
values
  ('mrc_autoparts', 'AutoParts', 'automotive', true),
  ('mrc_pneufast', 'PneuFast', 'automotive', true);

insert into public.products (id, merchant_id, name, category, price_cents, currency)
values
  ('prd_standard_tires', 'mrc_autoparts', 'Standard tire set', 'tires', 154800, 'BRL'),
  ('prd_premium_tires', 'mrc_autoparts', 'Premium tire set', 'tires', 172000, 'BRL'),
  ('prd_floor_mats', 'mrc_autoparts', 'All-weather floor mats', 'accessories', 28900, 'BRL'),
  ('prd_pneufast_tires', 'mrc_pneufast', 'PneuFast tire set', 'tires', 149900, 'BRL');
