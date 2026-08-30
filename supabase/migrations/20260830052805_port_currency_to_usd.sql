begin;

-- Monetary integers remain exact cents. Existing catalog and transaction rows
-- change denomination without applying an implicit or time-dependent FX rate.
update public.products
set currency = 'USD'
where currency <> 'USD';

alter table public.products
  alter column currency set default 'USD';

alter table public.products
  drop constraint if exists products_currency_check;
alter table public.products
  drop constraint if exists products_currency_usd_check;
alter table public.products
  add constraint products_currency_usd_check check (currency = 'USD');

-- Currency is covered by the signed mandate artifact. A legacy active mandate
-- cannot be silently reinterpreted as USD, so make it non-spendable and clear
-- the now-obsolete authorization material. The buyer must authorize a new USD
-- mandate before another checkout can succeed.
update public.mandates
set limits = jsonb_set(limits, '{currency}', '"USD"'::jsonb, true),
    status = case when status = 'active' then 'revoked' else status end,
    revoked_at = case
      when status = 'active' then coalesce(revoked_at, now())
      else revoked_at
    end,
    "authorization" = null,
    server_sig = null,
    updated_at = now()
where coalesce(limits->>'currency', '') <> 'USD';

alter table public.mandates
  drop constraint if exists mandates_limits_currency_usd_check;
alter table public.mandates
  add constraint mandates_limits_currency_usd_check
  check (limits->>'currency' = 'USD');

-- Attempt rows are historical evidence. Preserve their exact cent amount and
-- decision while moving the current product-wide denomination to USD. Audit
-- payloads are deliberately untouched because mutating them would break the
-- append-only hash chain.
update public.attempts
set currency = 'USD',
    payment_token = case
      when payment_token is null then null
      else jsonb_set(payment_token, '{allowance,currency}', '"USD"'::jsonb, true)
    end
where currency <> 'USD';

create or replace function public.create_agentpay_merchant(
  p_merchant_id text,
  p_name text,
  p_category text,
  p_description text,
  p_website_url text,
  p_discovery_url text,
  p_checkout_url text,
  p_hosted_store boolean,
  p_sample_product_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_base_url text := regexp_replace(
    coalesce(p_website_url, ''),
    '/stores/' || coalesce(p_merchant_id, '') || '$',
    ''
  );
  v_merchant public.merchants%rowtype;
  v_product public.products%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_merchant_id !~ '^mrc_[a-f0-9]{20}$'
    or char_length(p_name) not between 2 and 120
    or char_length(p_category) not between 2 and 80
    or (p_description is not null and char_length(p_description) not between 1 and 500)
    or p_website_url is null
    or p_discovery_url is null
    or (not p_hosted_store and (p_website_url !~ '^https://' or p_discovery_url !~ '^https://'))
    or (p_hosted_store and (p_sample_product_id is null or p_sample_product_id !~ '^prd_[a-f0-9]{20}$'))
    or (
      p_hosted_store and (
        p_checkout_url is null
        or not agentpay_private.is_allowed_hosted_store_base(v_base_url)
        or p_website_url <> (v_base_url || '/stores/' || p_merchant_id)
        or p_discovery_url <> (v_base_url || '/api/stores/' || p_merchant_id || '/agentpay.json')
        or p_checkout_url <> (v_base_url || '/api/stores/' || p_merchant_id || '/checkout')
      )
    ) then
    raise exception 'Invalid merchant payload';
  end if;

  insert into public.merchants (
    id, name, category, description, website_url, discovery_url, checkout_url,
    environment, hosted_store, publicly_listed, agent_ready,
    verification_status, last_verified_at
  ) values (
    p_merchant_id, p_name, lower(p_category), p_description, p_website_url,
    p_discovery_url, case when p_hosted_store then p_checkout_url else null end,
    case when p_hosted_store then 'test' else 'live' end, p_hosted_store, false,
    p_hosted_store, case when p_hosted_store then 'verified' else 'unverified' end,
    case when p_hosted_store then now() else null end
  ) returning * into v_merchant;

  insert into public.merchant_memberships (merchant_id, user_id, role)
  values (p_merchant_id, v_user_id, 'owner');

  if p_hosted_store then
    insert into public.products (
      id, merchant_id, name, description, category, sku, price_cents, currency
    ) values (
      p_sample_product_id, p_merchant_id, 'Sample product',
      'A test product for the first AgentPay integration run.', lower(p_category),
      'SAMPLE-001', 4900, 'USD'
    ) returning * into v_product;
  end if;

  return jsonb_build_object(
    'merchant', to_jsonb(v_merchant),
    'sample_product', case when p_hosted_store then to_jsonb(v_product) else null end
  );
end;
$$;

revoke all on function public.create_agentpay_merchant(text, text, text, text, text, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.create_agentpay_merchant(text, text, text, text, text, text, text, boolean, text)
  to authenticated;

create or replace function public.create_agentpay_merchant_product(
  p_secret_hash text,
  p_merchant_id text,
  p_product_id text,
  p_name text,
  p_description text,
  p_category text,
  p_sku text,
  p_price_cents integer,
  p_currency text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_merchant_id text;
  v_product public.products%rowtype;
begin
  if p_secret_hash is null or p_secret_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  if p_product_id !~ '^prd_[a-f0-9]{20}$'
    or char_length(p_name) not between 2 and 160
    or char_length(p_description) not between 1 and 1000
    or char_length(p_category) not between 1 and 80
    or char_length(p_sku) not between 1 and 80
    or p_price_cents <= 0
    or p_currency <> 'USD' then
    raise exception 'Invalid product payload';
  end if;

  select api_key.merchant_id into v_merchant_id
  from public.merchant_api_keys api_key
  join public.merchants merchant on merchant.id = api_key.merchant_id
  where api_key.secret_hash = p_secret_hash
    and api_key.merchant_id = p_merchant_id
    and api_key.revoked_at is null
    and (api_key.expires_at is null or api_key.expires_at > now())
    and merchant.agent_ready = true
  for update of api_key;

  if v_merchant_id is null then
    return null;
  end if;

  update public.merchant_api_keys
  set last_used_at = now()
  where secret_hash = p_secret_hash;

  insert into public.products (
    id, merchant_id, name, description, category, sku, price_cents, currency
  ) values (
    p_product_id, v_merchant_id, p_name, p_description, lower(p_category), p_sku,
    p_price_cents, p_currency
  ) returning * into v_product;

  return to_jsonb(v_product);
end;
$$;

comment on function public.create_agentpay_merchant_product(text, text, text, text, text, text, text, integer, text) is
  'API-key-authenticated USD product creation for an active merchant test or live catalog.';

revoke all on function public.create_agentpay_merchant_product(text, text, text, text, text, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.create_agentpay_merchant_product(text, text, text, text, text, text, text, integer, text)
  to anon;

commit;
