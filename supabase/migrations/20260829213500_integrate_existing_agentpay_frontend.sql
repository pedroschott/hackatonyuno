alter table public.vault_cards
  add column if not exists label text;

alter table public.mandates
  add column if not exists natural_language_description text,
  add column if not exists origin jsonb;

alter table public.mandates drop constraint if exists mandates_status_check;
alter table public.mandates
  add constraint mandates_status_check
  check (status = any (array['draft'::text, 'active'::text, 'revoked'::text, 'expired'::text, 'declined'::text]));

insert into public.products (id, merchant_id, name, category, price_cents, currency)
values
  ('prd_tire_std', 'mrc_autoparts', 'Standard tire set', 'tires', 154800, 'BRL'),
  ('prd_tire_prm', 'mrc_autoparts', 'Premium tire set', 'tires', 172000, 'BRL'),
  ('prd_acc_jack', 'mrc_autoparts', 'Hydraulic jack 2t', 'accessories', 38900, 'BRL'),
  ('prd_acc_mats', 'mrc_autoparts', 'All-weather floor mats', 'accessories', 12900, 'BRL'),
  ('prd_pf_std', 'mrc_pneufast', 'Standard tire set (PneuFast)', 'tires', 149000, 'BRL')
on conflict (id) do update set
  merchant_id = excluded.merchant_id,
  name = excluded.name,
  category = excluded.category,
  price_cents = excluded.price_cents,
  currency = excluded.currency;
