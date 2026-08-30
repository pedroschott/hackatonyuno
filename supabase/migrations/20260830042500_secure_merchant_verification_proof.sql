begin;

create table agentpay_private.merchant_verification_config (
  singleton boolean primary key default true check (singleton),
  secret_hash text not null check (secret_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now()
);

comment on table agentpay_private.merchant_verification_config is
  'Hash of the server-only proof required to persist a live merchant verification result.';

alter table agentpay_private.merchant_verification_config enable row level security;
revoke all on agentpay_private.merchant_verification_config from public, anon, authenticated;

insert into agentpay_private.merchant_verification_config (singleton, secret_hash)
values (true, 'bd7c3506f4595135a27ce14a8506ea5c453139bd5355eaa6f8ece26a5d88106b');

create or replace function public.record_agentpay_merchant_verification(
  p_merchant_id text,
  p_proof_secret text,
  p_status text,
  p_checkout_url text default null,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_merchant public.merchants%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_proof_secret is null
    or char_length(p_proof_secret) < 32
    or not exists (
      select 1
      from agentpay_private.merchant_verification_config config
      where config.singleton = true
        and config.secret_hash = encode(extensions.digest(p_proof_secret, 'sha256'), 'hex')
    ) then
    raise exception 'Invalid verification proof';
  end if;

  select merchant.*
  into v_merchant
  from public.merchants merchant
  join public.merchant_memberships membership
    on membership.merchant_id = merchant.id
  where merchant.id = p_merchant_id
    and membership.user_id = v_user_id
    and membership.role = 'owner'
  for update of merchant;

  if not found then
    raise exception 'Merchant not found';
  end if;
  if v_merchant.hosted_store then
    raise exception 'Hosted test stores are verified automatically';
  end if;
  if p_status not in ('pending', 'verified', 'failed') then
    raise exception 'Invalid verification status';
  end if;

  if p_status = 'verified' then
    if p_checkout_url is null
      or p_checkout_url !~ '^https://'
      or char_length(p_checkout_url) > 2048 then
      raise exception 'A valid HTTPS checkout URL is required';
    end if;

    update public.merchants
    set checkout_url = p_checkout_url,
        verification_status = 'verified',
        verification_error = null,
        last_verified_at = now(),
        agent_ready = true,
        updated_at = now()
    where id = p_merchant_id
    returning * into v_merchant;
  elsif p_status = 'failed' then
    update public.merchants
    set verification_status = 'failed',
        verification_error = left(coalesce(nullif(p_error, ''), 'Verification failed'), 500),
        last_verified_at = null,
        agent_ready = false,
        publicly_listed = false,
        updated_at = now()
    where id = p_merchant_id
    returning * into v_merchant;
  else
    update public.merchants
    set verification_status = 'pending',
        verification_error = null,
        last_verified_at = null,
        agent_ready = false,
        publicly_listed = false,
        updated_at = now()
    where id = p_merchant_id
    returning * into v_merchant;
  end if;

  return to_jsonb(v_merchant);
end;
$$;

comment on function public.record_agentpay_merchant_verification(text, text, text, text, text) is
  'Records server-verified live discovery state for an authenticated merchant owner after validating a server-only proof.';

revoke all on function public.record_agentpay_merchant_verification(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_agentpay_merchant_verification(text, text, text, text, text)
  to authenticated;

commit;
