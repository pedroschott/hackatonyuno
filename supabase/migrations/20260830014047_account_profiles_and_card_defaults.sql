-- Add the user-owned order profile and make saved-card selection explicit.
begin;

create table public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  legal_name text check (legal_name is null or char_length(legal_name) between 1 and 120),
  tax_id text check (tax_id is null or char_length(tax_id) between 4 and 32),
  phone text check (phone is null or char_length(phone) between 7 and 32),
  address_line1 text check (address_line1 is null or char_length(address_line1) between 1 and 160),
  address_line2 text check (address_line2 is null or char_length(address_line2) between 1 and 160),
  city text check (city is null or char_length(city) between 1 and 100),
  region text check (region is null or char_length(region) between 1 and 100),
  postal_code text check (postal_code is null or char_length(postal_code) between 3 and 20),
  country_code text not null default 'BR' check (country_code ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customer_profiles is
  'User-owned compliance and fulfillment profile used for agent-assisted ordering. Protected by RLS.';
comment on column public.customer_profiles.tax_id is
  'User-entered jurisdictional tax identifier. Never included in public registry projections or payment tokens.';

alter table public.customer_profiles enable row level security;

revoke all on table public.customer_profiles from anon, authenticated;
grant select, insert, update on table public.customer_profiles to authenticated;

create policy "Users read their profile"
  on public.customer_profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their profile"
  on public.customer_profiles for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their profile"
  on public.customer_profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.vault_cards
  add column is_default boolean not null default false,
  add column updated_at timestamptz not null default now();

with ranked as (
  select id, row_number() over (partition by user_id order by created_at, id) as position
  from public.vault_cards
)
update public.vault_cards as cards
set is_default = true
from ranked
where cards.id = ranked.id and ranked.position = 1;

create unique index vault_cards_one_default_per_user_idx
  on public.vault_cards (user_id)
  where is_default;

create or replace function public.ensure_agentpay_card_default()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.vault_cards
      where user_id = new.user_id and is_default
    ) then
      new.is_default := true;
    end if;
    return new;
  end if;

  if old.is_default then
    update public.vault_cards
    set is_default = true, updated_at = now()
    where id = (
      select id from public.vault_cards
      where user_id = old.user_id
      order by created_at, id
      limit 1
    );
  end if;
  return old;
end;
$$;

revoke all on function public.ensure_agentpay_card_default() from public;

create trigger vault_cards_default_on_insert
before insert on public.vault_cards
for each row execute function public.ensure_agentpay_card_default();

create trigger vault_cards_default_after_delete
after delete on public.vault_cards
for each row execute function public.ensure_agentpay_card_default();

grant update on table public.vault_cards to authenticated;

create policy "Users update their cards"
  on public.vault_cards for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete their cards" on public.vault_cards;
create policy "Users delete unbound cards"
  on public.vault_cards for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    and not exists (
      select 1
      from public.mandates
      where issuer_user_id = (select auth.uid())
        and status in ('draft', 'active')
        and payment->>'vault_card_id' = vault_cards.id::text
    )
  );

create or replace function public.set_default_agentpay_card(p_card_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.vault_cards;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':default-card', 0));

  select * into v_card
  from public.vault_cards
  where id = p_card_id and user_id = v_user_id;

  if v_card.id is null then
    raise exception 'Payment method not found';
  end if;

  update public.vault_cards
  set is_default = false, updated_at = now()
  where user_id = v_user_id and is_default and id <> p_card_id;

  update public.vault_cards
  set is_default = true, updated_at = now()
  where id = p_card_id and user_id = v_user_id;

  return jsonb_build_object('id', p_card_id, 'is_default', true);
end;
$$;

revoke all on function public.set_default_agentpay_card(uuid) from public;
grant execute on function public.set_default_agentpay_card(uuid) to authenticated;

comment on function public.set_default_agentpay_card(uuid) is
  'Atomically sets one user-owned saved card as the account default.';

-- Keep revocation and checkout on the same per-mandate ordering boundary even
-- when this migration is deployed onto an environment that predates the
-- dedicated serialization migration.
create or replace function public.revoke_agentpay_mandate(p_mandate_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.mandates;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_mandate_id::text, 0));

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
    jsonb_build_object(
      'status', 'revoked',
      'revoked_at', v_row.revoked_at,
      'linearization', 'mandate-checkout-lock-v1'
    )
  );
  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'revoked_at', v_row.revoked_at
  );
end;
$$;

revoke all on function public.revoke_agentpay_mandate(uuid) from public;
grant execute on function public.revoke_agentpay_mandate(uuid) to authenticated;

comment on function public.revoke_agentpay_mandate(uuid) is
  'Revokes a user-owned mandate under the same advisory transaction lock used by checkout settlement.';

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
  v_payment_method_id uuid;
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

  begin
    v_payment_method_id := (v_mandate.payment->>'vault_card_id')::uuid;
  exception when invalid_text_representation then
    v_payment_method_id := null;
  end;

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
  elsif v_payment_method_id is null or not exists (
    select 1 from public.vault_cards
    where id = v_payment_method_id and user_id = v_user_id
  ) then
    v_decision := 'refused'; v_reason := 'PAYMENT_METHOD_UNAVAILABLE';
  elsif not ((v_mandate.scope->'merchants') ? p_merchant_id) then
    v_decision := 'refused'; v_reason := 'MERCHANT_NOT_IN_SCOPE';
  elsif not ((v_mandate.scope->'categories') ? p_category) then
    v_decision := 'refused'; v_reason := 'CATEGORY_NOT_IN_SCOPE';
  elsif p_currency <> (v_mandate.limits->>'currency') then
    v_decision := 'refused'; v_reason := 'CURRENCY_MISMATCH';
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
      'payment_method_id', v_payment_method_id,
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
    jsonb_build_object(
      'agent_signature', true,
      'mandate_signature', v_mandate.server_sig is not null,
      'registry_status', v_mandate.status,
      'policy_engine', 'postgres-v1',
      'payment_method_id', v_payment_method_id
    )
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
      'payment_method_id', v_payment_method_id,
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
    'payment_method_id', v_payment_method_id,
    'payment_token', v_payment_token
  );
end;
$$;

revoke all on function public.evaluate_agentpay_checkout(uuid, text, text, text, text, integer, text, uuid) from public;
grant execute on function public.evaluate_agentpay_checkout(uuid, text, text, text, text, integer, text, uuid) to authenticated;

commit;
