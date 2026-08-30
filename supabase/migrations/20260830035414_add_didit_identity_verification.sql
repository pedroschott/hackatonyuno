begin;

-- AgentPay deliberately retains only the current KYC state. Didit's decision,
-- document images, biometric data, and other identity evidence remain at Didit.
create table public.identity_verifications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  didit_session_id text not null unique check (char_length(didit_session_id) between 1 and 160),
  workflow_id uuid not null,
  status text not null check (status in (
    'Not Started', 'In Progress', 'Awaiting User', 'In Review', 'Approved',
    'Declined', 'Resubmitted', 'Abandoned', 'Expired', 'Kyc Expired'
  )),
  approved_at timestamptz,
  decision_at timestamptz,
  last_event_timestamp timestamptz not null default to_timestamp(0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.identity_verifications is
  'Current Didit KYC status only. No identity decision payload, document, biometric, or PII from Didit is persisted.';

create index identity_verifications_status_updated_idx
  on public.identity_verifications (status, updated_at desc);

-- The webhook journal makes verified Didit deliveries idempotent. It intentionally
-- has no Data API grants for browser roles.
create table public.didit_webhook_events (
  event_id uuid primary key,
  didit_session_id text not null check (char_length(didit_session_id) between 1 and 160),
  webhook_type text not null check (char_length(webhook_type) between 1 and 120),
  status text not null check (status in (
    'Not Started', 'In Progress', 'Awaiting User', 'In Review', 'Approved',
    'Declined', 'Resubmitted', 'Abandoned', 'Expired', 'Kyc Expired'
  )),
  provider_timestamp timestamptz not null,
  received_at timestamptz not null default now()
);

comment on table public.didit_webhook_events is
  'Idempotency journal for authenticated Didit webhook deliveries. It contains no Didit decision payload.';

alter table public.identity_verifications enable row level security;
alter table public.didit_webhook_events enable row level security;

revoke all on table public.identity_verifications from anon, authenticated;
revoke all on table public.didit_webhook_events from anon, authenticated;
grant select on table public.identity_verifications to authenticated;

create policy "Users read their own identity verification state"
  on public.identity_verifications for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- This RPC is service-role-only and runs after the Next.js webhook route has
-- verified Didit's timestamp and X-Signature-V2. The insert and state update
-- share a transaction so a replay cannot apply a decision twice.
create or replace function public.apply_didit_webhook(
  p_event_id uuid,
  p_session_id text,
  p_status text,
  p_webhook_type text,
  p_provider_timestamp timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted uuid;
  v_updated_user_id uuid;
begin
  insert into public.didit_webhook_events (
    event_id,
    didit_session_id,
    webhook_type,
    status,
    provider_timestamp
  ) values (
    p_event_id,
    p_session_id,
    p_webhook_type,
    p_status,
    p_provider_timestamp
  )
  on conflict (event_id) do nothing
  returning event_id into v_inserted;

  if v_inserted is null then
    return jsonb_build_object('event_recorded', false, 'state_updated', false);
  end if;

  update public.identity_verifications as verification
  set
    status = p_status,
    approved_at = case
      when p_status = 'Approved' then coalesce(verification.approved_at, now())
      when p_status = 'Kyc Expired' then null
      else verification.approved_at
    end,
    decision_at = case
      when p_status in ('Approved', 'Declined', 'In Review', 'Abandoned') then now()
      else verification.decision_at
    end,
    last_event_timestamp = p_provider_timestamp,
    updated_at = now()
  where verification.didit_session_id = p_session_id
    and p_provider_timestamp >= verification.last_event_timestamp
  returning verification.user_id into v_updated_user_id;

  return jsonb_build_object(
    'event_recorded', true,
    'state_updated', v_updated_user_id is not null
  );
end;
$$;

revoke all on function public.apply_didit_webhook(uuid, text, text, text, timestamptz) from public;
grant execute on function public.apply_didit_webhook(uuid, text, text, text, timestamptz) to service_role;

commit;
