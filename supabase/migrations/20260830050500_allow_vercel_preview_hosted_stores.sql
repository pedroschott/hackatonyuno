begin;

create or replace function agentpay_private.is_allowed_hosted_store_base(p_base_url text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    p_base_url in ('https://agentpay-yuno.vercel.app', 'http://localhost:3210')
    or p_base_url ~ '^https://agentpay-yuno-[a-z0-9-]+-pedroschotts-projects\.vercel\.app$';
$$;

comment on function agentpay_private.is_allowed_hosted_store_base(text) is
  'Allows the canonical app, localhost, and Vercel preview hosts owned by this project team.';

revoke all on function agentpay_private.is_allowed_hosted_store_base(text)
  from public, anon, authenticated;

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
      'SAMPLE-001', 4900, 'BRL'
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

commit;
