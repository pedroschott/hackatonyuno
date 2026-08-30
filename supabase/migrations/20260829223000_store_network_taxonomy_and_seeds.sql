begin;

-- ============================================================================
-- Phase 1 Store Network: Taxonomy, Category Closure, Directory, & Seeds
-- ============================================================================

-- 1. Extend safe public merchant directory projection
alter table public.merchants
  add column if not exists slug text,
  add column if not exists vertical text,
  add column if not exists storefront_url text,
  add column if not exists discovery_url text,
  add column if not exists currency text default 'USD',
  add column if not exists display_status text default 'active' check (display_status in ('active', 'inactive')),
  add column if not exists logo_key text;

alter table public.merchants
  alter column category drop not null;

create unique index if not exists merchants_slug_idx
  on public.merchants (slug)
  where slug is not null;

create index if not exists merchants_vertical_idx
  on public.merchants (vertical);

create index if not exists merchants_display_status_idx
  on public.merchants (display_status);

-- 2. Versioned taxonomy tables (private mandate authorization state)
create table if not exists agentpay_private.taxonomy_versions (
  version text primary key,
  status text not null check (status in ('active', 'retired')),
  created_at timestamptz not null default now()
);

comment on table agentpay_private.taxonomy_versions is
  'Versioned canonical commerce taxonomies for mandate authorization.';

create table if not exists agentpay_private.taxonomy_categories (
  version text not null references agentpay_private.taxonomy_versions(version) on delete cascade,
  category_id text not null check (category_id ~ '^[a-z][a-z0-9._/-]{0,159}$'),
  parent_category_id text,
  display_name text not null,
  created_at timestamptz not null default now(),
  primary key (version, category_id)
);

comment on table agentpay_private.taxonomy_categories is
  'Hierarchical canonical taxonomy categories for a given taxonomy version.';

create index if not exists taxonomy_categories_parent_idx
  on agentpay_private.taxonomy_categories (version, parent_category_id);

create table if not exists agentpay_private.taxonomy_category_closure (
  version text not null references agentpay_private.taxonomy_versions(version) on delete cascade,
  ancestor_category_id text not null,
  descendant_category_id text not null,
  depth integer not null check (depth >= 0),
  primary key (version, ancestor_category_id, descendant_category_id)
);

comment on table agentpay_private.taxonomy_category_closure is
  'Transitive closure index for exact canonical category parent authorization.';

create index if not exists taxonomy_category_closure_ancestor_descendant_idx
  on agentpay_private.taxonomy_category_closure (ancestor_category_id, descendant_category_id);

create index if not exists taxonomy_category_closure_descendant_idx
  on agentpay_private.taxonomy_category_closure (version, descendant_category_id);

-- 3. Row Level Security & permissions
alter table agentpay_private.taxonomy_versions enable row level security;
alter table agentpay_private.taxonomy_categories enable row level security;
alter table agentpay_private.taxonomy_category_closure enable row level security;

revoke all on agentpay_private.taxonomy_versions from anon, authenticated;
revoke all on agentpay_private.taxonomy_categories from anon, authenticated;
revoke all on agentpay_private.taxonomy_category_closure from anon, authenticated;

-- 4. Seed taxonomy version
insert into agentpay_private.taxonomy_versions (version, status)
values ('2026-08-29', 'active')
on conflict (version) do update set
  status = excluded.status;

-- 5. Seed taxonomy categories
insert into agentpay_private.taxonomy_categories (
  version,
  category_id,
  parent_category_id,
  display_name
) values
  -- Root categories
  ('2026-08-29', 'food', null, 'Food & Grocery'),
  ('2026-08-29', 'automotive', null, 'Automotive & Fleet'),
  ('2026-08-29', 'beauty', null, 'Personal Care & Beauty'),

  -- Child categories
  ('2026-08-29', 'food.grains', 'food', 'Grains & Staples'),
  ('2026-08-29', 'food.meat', 'food', 'Meat & Poultry'),
  ('2026-08-29', 'food.prepared', 'food', 'Prepared Foods'),
  ('2026-08-29', 'automotive.tires', 'automotive', 'Tires & Wheels'),
  ('2026-08-29', 'automotive.accessories', 'automotive', 'Vehicle Accessories'),
  ('2026-08-29', 'beauty.skincare', 'beauty', 'Skincare'),
  ('2026-08-29', 'beauty.oils', 'beauty', 'Botanical & Essential Oils'),

  -- Leaf categories
  ('2026-08-29', 'food.grains.rice', 'food.grains', 'Rice'),
  ('2026-08-29', 'food.meat.poultry', 'food.meat', 'Poultry'),
  ('2026-08-29', 'food.prepared.burgers', 'food.prepared', 'Burgers & Meal Kits')
on conflict (version, category_id) do update set
  parent_category_id = excluded.parent_category_id,
  display_name = excluded.display_name;

-- 6. Seed taxonomy category closure (self depth 0, child depth 1, grandchild depth 2)
insert into agentpay_private.taxonomy_category_closure (
  version,
  ancestor_category_id,
  descendant_category_id,
  depth
) values
  -- Self-closures (depth 0)
  ('2026-08-29', 'food', 'food', 0),
  ('2026-08-29', 'automotive', 'automotive', 0),
  ('2026-08-29', 'beauty', 'beauty', 0),
  ('2026-08-29', 'food.grains', 'food.grains', 0),
  ('2026-08-29', 'food.meat', 'food.meat', 0),
  ('2026-08-29', 'food.prepared', 'food.prepared', 0),
  ('2026-08-29', 'automotive.tires', 'automotive.tires', 0),
  ('2026-08-29', 'automotive.accessories', 'automotive.accessories', 0),
  ('2026-08-29', 'beauty.skincare', 'beauty.skincare', 0),
  ('2026-08-29', 'beauty.oils', 'beauty.oils', 0),
  ('2026-08-29', 'food.grains.rice', 'food.grains.rice', 0),
  ('2026-08-29', 'food.meat.poultry', 'food.meat.poultry', 0),
  ('2026-08-29', 'food.prepared.burgers', 'food.prepared.burgers', 0),

  -- Direct child closures (depth 1)
  ('2026-08-29', 'food', 'food.grains', 1),
  ('2026-08-29', 'food', 'food.meat', 1),
  ('2026-08-29', 'food', 'food.prepared', 1),
  ('2026-08-29', 'automotive', 'automotive.tires', 1),
  ('2026-08-29', 'automotive', 'automotive.accessories', 1),
  ('2026-08-29', 'beauty', 'beauty.skincare', 1),
  ('2026-08-29', 'beauty', 'beauty.oils', 1),
  ('2026-08-29', 'food.grains', 'food.grains.rice', 1),
  ('2026-08-29', 'food.meat', 'food.meat.poultry', 1),
  ('2026-08-29', 'food.prepared', 'food.prepared.burgers', 1),

  -- Grandchild closures (depth 2)
  ('2026-08-29', 'food', 'food.grains.rice', 2),
  ('2026-08-29', 'food', 'food.meat.poultry', 2),
  ('2026-08-29', 'food', 'food.prepared.burgers', 2)
on conflict (version, ancestor_category_id, descendant_category_id) do update set
  depth = excluded.depth;

-- 7. Seed public merchants (safe directory projection)
insert into public.merchants (
  id,
  name,
  slug,
  vertical,
  category,
  storefront_url,
  discovery_url,
  currency,
  display_status,
  agent_ready
) values
  (
    'mrc_autoparts',
    'AutoParts',
    'autoparts',
    'automotive',
    'automotive',
    '/store',
    '/merchants/autoparts/.well-known/agentpay.json',
    'USD',
    'active',
    true
  ),
  (
    'mrc_harvest_market',
    'Harvest Market',
    'harvest-market',
    'grocery',
    'grocery',
    '/merchants/harvest-market',
    '/merchants/harvest-market/.well-known/agentpay.json',
    'USD',
    'active',
    true
  ),
  (
    'mrc_city_basket',
    'City Basket',
    'city-basket',
    'grocery',
    'grocery',
    '/merchants/city-basket',
    '/merchants/city-basket/.well-known/agentpay.json',
    'USD',
    'active',
    true
  ),
  (
    'mrc_mare_botanicals',
    'Maré Botanicals',
    'mare-botanicals',
    'beauty',
    'beauty',
    '/merchants/mare-botanicals',
    '/merchants/mare-botanicals/.well-known/agentpay.json',
    'USD',
    'active',
    true
  ),
  (
    'mrc_pneufast',
    'PneuFast',
    'pneufast',
    'automotive',
    'automotive',
    '/store/pneufast',
    '/merchants/pneufast/.well-known/agentpay.json',
    'USD',
    'inactive',
    false
  )
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  vertical = excluded.vertical,
  category = coalesce(excluded.category, public.merchants.category),
  storefront_url = excluded.storefront_url,
  discovery_url = excluded.discovery_url,
  currency = excluded.currency,
  display_status = excluded.display_status,
  agent_ready = excluded.agent_ready;

-- 8. Seed private merchant registry (mandate authorization projection)
insert into agentpay_private.merchant_registry (
  merchant_id,
  endpoint_url,
  signing_key_id,
  signing_public_jwk,
  trust_tier,
  status
) values
  (
    'mrc_autoparts',
    'https://autoparts.local/v1/agents-pay',
    'autoparts-2026-08',
    '{"kty":"EC","crv":"P-256","x":"uBUFVoWW2YeBOibdYSSYlV_uyAG58V7_lzMHbPWfYBw","y":"0o2yc-c6uIY301hip_fuAmoc1Ce9QSxN9XE0hzbQVbk","key_ops":["verify"],"ext":true}'::jsonb,
    1,
    'active'
  ),
  (
    'mrc_harvest_market',
    'https://harvest.local/v1/agents-pay',
    'harvest-market-2026-08',
    '{"kty":"EC","crv":"P-256","x":"7C4izDlK5_4FlwtsBXTTWJpLa4ZlQbSirEZWWWBwKbo","y":"OuzRkDK0WIADuQhn8rlZEO9SiuX1pVuzN-s3AzCfe6w","key_ops":["verify"],"ext":true}'::jsonb,
    1,
    'active'
  ),
  (
    'mrc_city_basket',
    'https://citybasket.local/v1/agents-pay',
    'city-basket-2026-08',
    '{"kty":"EC","crv":"P-256","x":"Y15afop1gkzDoqOqQ77BrISq-uSqjPxTSfGQxEeQ8Yc","y":"WIh3aiQKK9A4sr7TXOkbW0uh1gN3mjLqgGHU8asUcRE","key_ops":["verify"],"ext":true}'::jsonb,
    1,
    'active'
  ),
  (
    'mrc_mare_botanicals',
    'https://mare.local/v1/agents-pay',
    'mare-botanicals-2026-08',
    '{"kty":"EC","crv":"P-256","x":"Iv1Wb5kXS5k41A0M-dwBjhoeFLkEPWFtjU4U-gzB5Yg","y":"syS_Gu66yn4l-IZxXMKtNug8nrZsRLukk8Wk2C2ACqA","key_ops":["verify"],"ext":true}'::jsonb,
    1,
    'active'
  ),
  (
    'mrc_pneufast',
    'https://pneufast.local/v1/agents-pay',
    'pneufast-2026-08',
    '{"kty":"EC","crv":"P-256","x":"rip6umXYk0Vl415u2PNbN5JMcRQrM51AbPdQAeC2coo","y":"tPOW7x5QIYynzPW2Cyv9GjsMhxSUt30PWSkS6e68M2M","key_ops":["verify"],"ext":true}'::jsonb,
    3,
    'inactive'
  )
on conflict (merchant_id) do update set
  endpoint_url = excluded.endpoint_url,
  signing_key_id = excluded.signing_key_id,
  signing_public_jwk = excluded.signing_public_jwk,
  trust_tier = excluded.trust_tier,
  status = excluded.status,
  updated_at = now();

-- 9. Seed merchant taxonomy mappings
insert into agentpay_private.merchant_taxonomy_mappings (
  merchant_id,
  merchant_category_id,
  taxonomy_version,
  canonical_category,
  status
) values
  -- AutoParts
  ('mrc_autoparts', 'tires', '2026-08-29', 'automotive.tires', 'active'),
  ('mrc_autoparts', 'accessories', '2026-08-29', 'automotive.accessories', 'active'),

  -- Harvest Market
  ('mrc_harvest_market', 'pantry.rice-and-grains', '2026-08-29', 'food.grains.rice', 'active'),
  ('mrc_harvest_market', 'fresh.poultry', '2026-08-29', 'food.meat.poultry', 'active'),
  ('mrc_harvest_market', 'prepared.burger-kits', '2026-08-29', 'food.prepared.burgers', 'active'),
  ('mrc_harvest_market', 'stored-value.store-credit', '2026-08-29', 'unmapped.store-credit', 'retired'),

  -- City Basket
  ('mrc_city_basket', 'grocery/dry-goods/rice', '2026-08-29', 'food.grains.rice', 'active'),
  ('mrc_city_basket', 'meat-and-seafood/chicken', '2026-08-29', 'food.meat.poultry', 'active'),
  ('mrc_city_basket', 'ready-to-eat/burgers', '2026-08-29', 'food.prepared.burgers', 'active'),
  ('mrc_city_basket', 'digital/wallet-credit', '2026-08-29', 'unmapped.digital-credit', 'retired'),

  -- Maré Botanicals
  ('mrc_mare_botanicals', 'skincare.face', '2026-08-29', 'beauty.skincare', 'active'),
  ('mrc_mare_botanicals', 'hair.oils', '2026-08-29', 'beauty.oils', 'active'),
  ('mrc_mare_botanicals', 'bath.body', '2026-08-29', 'beauty.skincare', 'active'),
  ('mrc_mare_botanicals', 'vouchers.gift', '2026-08-29', 'unmapped.gift-voucher', 'retired'),

  -- PneuFast
  ('mrc_pneufast', 'tires', '2026-08-29', 'automotive.tires', 'active')
on conflict (merchant_id, merchant_category_id, taxonomy_version) do update set
  canonical_category = excluded.canonical_category,
  status = excluded.status,
  updated_at = now();

commit;
