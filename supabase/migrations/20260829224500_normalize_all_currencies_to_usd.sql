begin;

-- Normalize default column values to USD
alter table public.products
  alter column currency set default 'USD';

alter table public.merchants
  alter column currency set default 'USD';

-- Update all existing product and merchant rows to USD
update public.products
  set currency = 'USD'
  where currency <> 'USD';

update public.merchants
  set currency = 'USD'
  where currency <> 'USD';

commit;
