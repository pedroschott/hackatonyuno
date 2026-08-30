begin;

create table public.identity_verifications (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'didit' check (provider = 'didit'),
  workflow_id uuid not null,
  status text not null check (status in (
    'Not Started', 'In Progress', 'Approved', 'Declined', 'In Review',
    'Expired', 'Abandoned', 'Kyc Expired', 'Resubmitted', 'Awaiting User'
  )),
  entity_status text check (entity_status is null or entity_status in ('ACTIVE', 'FLAGGED', 'BLOCKED')),
  environment text check (environment is null or environment in ('sandbox', 'live')),
  provider_event_at timestamptz,
  entity_event_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.identity_verifications is
  'Minimal Didit verification state. Full decisions, identity documents, images, and biometric data are not persisted in AgentPay.';

create index identity_verifications_user_latest_idx
  on public.identity_verifications (user_id, created_at desc);

alter table public.identity_verifications enable row level security;
revoke all on table public.identity_verifications from public, anon, authenticated;
grant select on table public.identity_verifications to authenticated;
grant all on table public.identity_verifications to service_role;

create policy "Users read their identity verification state"
  on public.identity_verifications for select
  to authenticated
  using ((select auth.uid()) = user_id);

create table agentpay_private.didit_webhook_events (
  event_id uuid primary key,
  webhook_type text not null,
  session_id uuid,
  user_id uuid,
  created_at timestamptz not null default now()
);

comment on table agentpay_private.didit_webhook_events is
  'Idempotency keys for authenticated Didit webhook deliveries; contains no decision payload or biometric data.';

alter table agentpay_private.didit_webhook_events enable row level security;
revoke all on agentpay_private.didit_webhook_events from public, anon, authenticated;
grant usage on schema agentpay_private to service_role;
grant select, insert on table agentpay_private.didit_webhook_events to service_role;

create or replace function public.apply_didit_identity_webhook(
  p_event_id uuid,
  p_webhook_type text,
  p_user_id uuid,
  p_session_id uuid,
  p_status text,
  p_environment text,
  p_created_at bigint
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  v_event_time timestamptz := to_timestamp(p_created_at);
begin
  if p_webhook_type not in ('status.updated', 'data.updated', 'user.status.updated', 'user.data.updated') then
    raise exception 'Unsupported Didit webhook type';
  end if;
  if p_environment not in ('sandbox', 'live') then
    raise exception 'Invalid Didit environment';
  end if;

  insert into agentpay_private.didit_webhook_events (
    event_id, webhook_type, session_id, user_id
  ) values (
    p_event_id, p_webhook_type, p_session_id, p_user_id
  ) on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return false; end if;

  if p_webhook_type in ('status.updated', 'data.updated') then
    if p_session_id is null or p_status not in (
      'Not Started', 'In Progress', 'Approved', 'Declined', 'In Review',
      'Expired', 'Abandoned', 'Kyc Expired', 'Resubmitted', 'Awaiting User'
    ) then
      raise exception 'Invalid Didit session event';
    end if;
    update public.identity_verifications
    set status = p_status,
        environment = p_environment,
        provider_event_at = v_event_time,
        approved_at = case
          when p_status = 'Approved' then coalesce(approved_at, v_event_time)
          else null
        end,
        updated_at = now()
    where session_id = p_session_id
      and user_id = p_user_id
      and (provider_event_at is null or provider_event_at <= v_event_time);
  else
    if p_status not in ('ACTIVE', 'FLAGGED', 'BLOCKED') then
      raise exception 'Invalid Didit user event';
    end if;
    update public.identity_verifications
    set entity_status = p_status,
        entity_event_at = v_event_time,
        updated_at = now()
    where user_id = p_user_id
      and (entity_event_at is null or entity_event_at <= v_event_time);
  end if;

  return true;
end;
$$;

comment on function public.apply_didit_identity_webhook(uuid, text, uuid, uuid, text, text, bigint) is
  'Atomically de-duplicates a server-authenticated Didit event and applies only its minimal status projection.';

revoke all on function public.apply_didit_identity_webhook(uuid, text, uuid, uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.apply_didit_identity_webhook(uuid, text, uuid, uuid, text, text, bigint)
  to service_role;

commit;
