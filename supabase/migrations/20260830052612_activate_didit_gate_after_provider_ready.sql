begin;

create table agentpay_private.didit_verification_config (
  singleton boolean primary key default true check (singleton),
  checkout_gate_enabled boolean not null default false,
  enabled_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table agentpay_private.didit_verification_config is
  'Rollout latch for the checkout defense-in-depth trigger. It turns on only after the deployed server successfully creates a Didit session.';

alter table agentpay_private.didit_verification_config enable row level security;
revoke all on agentpay_private.didit_verification_config from public, anon, authenticated;
grant select, update on agentpay_private.didit_verification_config to service_role;

insert into agentpay_private.didit_verification_config (singleton)
values (true);

create or replace function public.enable_agentpay_didit_checkout_gate()
returns boolean
language sql
security invoker
set search_path = ''
as $$
  update agentpay_private.didit_verification_config
  set checkout_gate_enabled = true,
      enabled_at = coalesce(enabled_at, now()),
      updated_at = now()
  where singleton = true
  returning checkout_gate_enabled;
$$;

revoke all on function public.enable_agentpay_didit_checkout_gate()
  from public, anon, authenticated;
grant execute on function public.enable_agentpay_didit_checkout_gate()
  to service_role;

create or replace function public.enforce_agentpay_identity_on_approved_attempt()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_verified boolean := false;
begin
  if new.decision <> 'approved' then return new; end if;
  if not exists (
    select 1
    from agentpay_private.didit_verification_config config
    where config.singleton = true
      and config.checkout_gate_enabled = true
  ) then
    return new;
  end if;

  select mandate.issuer_user_id
  into v_user_id
  from public.mandates mandate
  where mandate.id = new.mandate_id;

  select (
    verification.status = 'Approved'
    and verification.entity_status is distinct from 'FLAGGED'
    and verification.entity_status is distinct from 'BLOCKED'
  )
  into v_verified
  from public.identity_verifications verification
  where verification.user_id = v_user_id
  order by verification.created_at desc
  limit 1;

  if not coalesce(v_verified, false) then
    raise exception 'Identity verification is required before checkout';
  end if;
  return new;
end;
$$;

commit;
