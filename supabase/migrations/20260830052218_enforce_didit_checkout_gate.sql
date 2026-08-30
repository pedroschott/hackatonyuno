begin;

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

comment on function public.enforce_agentpay_identity_on_approved_attempt() is
  'Defense-in-depth checkout gate: no approved attempt or payment token can commit unless the mandate owner has a current passing Didit decision.';

revoke all on function public.enforce_agentpay_identity_on_approved_attempt()
  from public, anon, authenticated;

create trigger require_didit_identity_before_approved_attempt
before insert on public.attempts
for each row execute function public.enforce_agentpay_identity_on_approved_attempt();

commit;
