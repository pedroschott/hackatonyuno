begin;

alter table public.merchants
  add column description text,
  add column website_url text,
  add column discovery_url text,
  add column environment text not null default 'test',
  add column hosted_store boolean not null default false,
  add column publicly_listed boolean not null default false,
  add column verification_status text not null default 'unverified',
  add column verification_error text,
  add column last_verified_at timestamptz,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add constraint merchants_description_length
    check (description is null or char_length(description) between 1 and 500),
  add constraint merchants_urls_are_http
    check (
      (website_url is null or website_url ~ '^https?://') and
      (discovery_url is null or discovery_url ~ '^https?://') and
      (checkout_url is null or checkout_url ~ '^https?://')
    ),
  add constraint merchants_environment_valid
    check (environment in ('test', 'live')),
  add constraint merchants_verification_status_valid
    check (verification_status in ('unverified', 'pending', 'verified', 'failed')),
  add constraint merchants_public_listing_requires_verified_live_store
    check (
      not publicly_listed or (
        environment = 'live' and
        verification_status = 'verified' and
        agent_ready = true and
        website_url is not null
      )
    ),
  add constraint merchants_hosted_store_is_test_only
    check (not hosted_store or environment = 'test');

alter table public.merchants alter column agent_ready set default false;

update public.merchants
set
  environment = 'test',
  verification_status = 'verified',
  updated_at = now()
where true;

create index merchants_supported_idx
  on public.merchants (publicly_listed, verification_status, name)
  where publicly_listed = true and verification_status = 'verified';

create table public.merchant_memberships (
  merchant_id text not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner')),
  created_at timestamptz not null default now(),
  primary key (merchant_id, user_id)
);

comment on table public.merchant_memberships is
  'RLS-protected developer ownership. User IDs never appear in public merchant metadata.';

create index merchant_memberships_user_created_idx
  on public.merchant_memberships (user_id, created_at desc);

alter table public.merchant_memberships enable row level security;

create policy "Developers read their merchant memberships"
  on public.merchant_memberships for select to authenticated
  using ((select auth.uid()) = user_id);

alter table public.products
  add column description text,
  add column sku text,
  add column active boolean not null default true,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add constraint products_description_length
    check (description is null or char_length(description) between 1 and 1000),
  add constraint products_sku_length
    check (sku is null or char_length(sku) between 1 and 80);

update public.products
set
  description = coalesce(description, name),
  sku = coalesce(sku, upper(replace(id, 'prd_', ''))),
  updated_at = now();

alter table public.products
  alter column description set not null,
  alter column sku set not null;

create unique index products_merchant_sku_unique_idx
  on public.products (merchant_id, lower(sku));

create index products_merchant_active_idx
  on public.products (merchant_id, active, created_at desc);

create table public.merchant_api_keys (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchants(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  environment text not null check (environment in ('test', 'live')),
  prefix text not null unique check (prefix ~ '^ap_(test|live)_[A-Za-z0-9]{10}$'),
  secret_hash text not null unique check (secret_hash ~ '^[a-f0-9]{64}$'),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > created_at)
);

comment on table public.merchant_api_keys is
  'Merchant catalog API keys. Only SHA-256 hashes are stored; plaintext keys are returned once at creation.';

create index merchant_api_keys_merchant_created_idx
  on public.merchant_api_keys (merchant_id, created_at desc);

create index merchant_api_keys_created_by_idx
  on public.merchant_api_keys (created_by);

alter table public.merchant_api_keys enable row level security;

drop policy "Merchant metadata is public" on public.merchants;

create policy "Agent-ready merchant metadata is public"
  on public.merchants for select to anon
  using (agent_ready = true);

create policy "Developers read public and owned merchants"
  on public.merchants for select to authenticated
  using (
    agent_ready = true or exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = merchants.id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy "Developers update their merchants"
  on public.merchants for update to authenticated
  using (
    exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = merchants.id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  )
  with check (
    exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = merchants.id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

drop policy "Product catalog is public" on public.products;

create policy "Agent-ready product catalog is public"
  on public.products for select to anon
  using (
    active = true and exists (
      select 1
      from public.merchants merchant
      where merchant.id = products.merchant_id
        and merchant.agent_ready = true
    )
  );

create policy "Developers read public and owned products"
  on public.products for select to authenticated
  using (
    (
      active = true and exists (
        select 1
        from public.merchants merchant
        where merchant.id = products.merchant_id
          and merchant.agent_ready = true
      )
    ) or exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = products.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy "Developers create products for their merchants"
  on public.products for insert to authenticated
  with check (
    exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = products.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy "Developers update products for their merchants"
  on public.products for update to authenticated
  using (
    exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = products.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  )
  with check (
    exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = products.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy "Developers delete products from their merchants"
  on public.products for delete to authenticated
  using (
    exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = products.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

drop policy "Users read their attempts" on public.attempts;

create policy "Users and developers read relevant attempts"
  on public.attempts for select to authenticated
  using (
    (select auth.uid()) = user_id or exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = attempts.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy "Developers read their merchant API keys"
  on public.merchant_api_keys for select to authenticated
  using (
    exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = merchant_api_keys.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create policy "Developers create their merchant API keys"
  on public.merchant_api_keys for insert to authenticated
  with check (
    created_by = (select auth.uid()) and exists (
      select 1
      from public.merchant_memberships membership
      join public.merchants merchant on merchant.id = membership.merchant_id
      where membership.merchant_id = merchant_api_keys.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
        and merchant.environment = merchant_api_keys.environment
    )
  );

create policy "Developers revoke their merchant API keys"
  on public.merchant_api_keys for update to authenticated
  using (
    exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = merchant_api_keys.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  )
  with check (
    exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = merchant_api_keys.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

create or replace function public.reset_agentpay_merchant_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.hosted_store and (
    new.website_url is distinct from old.website_url or
    new.discovery_url is distinct from old.discovery_url
  ) then
    raise exception 'Hosted store URLs are immutable';
  elsif (
    new.website_url is distinct from old.website_url or
    new.discovery_url is distinct from old.discovery_url
  ) then
    new.checkout_url := null;
    new.agent_ready := false;
    new.publicly_listed := false;
    new.verification_status := 'unverified';
    new.verification_error := null;
    new.last_verified_at := null;
  end if;
  return new;
end;
$$;

create trigger reset_merchant_verification_when_endpoint_changes
before update of website_url, discovery_url on public.merchants
for each row execute function public.reset_agentpay_merchant_verification();

revoke all on public.merchants from anon, authenticated;
revoke all on public.merchant_memberships from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.merchant_api_keys from anon, authenticated;

grant select on public.merchants to anon, authenticated;
grant update (name, category, description, website_url, discovery_url, publicly_listed, updated_at)
  on public.merchants to authenticated;
grant select on public.merchant_memberships to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select on public.products to anon;
grant select, insert, update on public.merchant_api_keys to authenticated;

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
      p_hosted_store and not (
        (
          p_website_url = 'https://agentpay-yuno.vercel.app/stores/' || p_merchant_id and
          p_discovery_url = 'https://agentpay-yuno.vercel.app/api/stores/' || p_merchant_id || '/agentpay.json' and
          p_checkout_url = 'https://agentpay-yuno.vercel.app/api/stores/' || p_merchant_id || '/checkout'
        ) or (
          p_website_url = 'http://localhost:3210/stores/' || p_merchant_id and
          p_discovery_url = 'http://localhost:3210/api/stores/' || p_merchant_id || '/agentpay.json' and
          p_checkout_url = 'http://localhost:3210/api/stores/' || p_merchant_id || '/checkout'
        )
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

comment on function public.create_agentpay_merchant(text, text, text, text, text, text, text, boolean, text) is
  'Atomically creates a merchant, private owner membership, and optional hosted-store sample product.';

revoke all on function public.create_agentpay_merchant(text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.create_agentpay_merchant(text, text, text, text, text, text, text, boolean, text) to authenticated;

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
  'API-key-authenticated product creation for an active merchant test or live catalog.';

revoke all on function public.create_agentpay_merchant_product(text, text, text, text, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.create_agentpay_merchant_product(text, text, text, text, text, text, text, integer, text) to anon;

commit;
