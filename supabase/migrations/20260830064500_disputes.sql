-- Disputes: what happens after an agent buys something the buyer did not want.
--
-- Every prior control in AgentPay is preventive — a mandate refuses what it does
-- not cover. A dispute is the corrective one: the charge already happened, and
-- both sides now need the same record of why. The buyer opens it against one
-- attempt; the merchant answers it from the console or through their API key;
-- every state change is an event on a timeline neither side can rewrite.
--
-- Writes go through SECURITY DEFINER functions rather than RLS policies, so a
-- buyer cannot mark their own dispute refunded and a merchant cannot withdraw
-- one on the buyer's behalf.

create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_id text not null references public.merchants(id) on delete restrict,
  mandate_id uuid references public.mandates(id) on delete set null,
  reason_code text not null check (reason_code in (
    'not_recognized', 'not_received', 'not_as_described', 'duplicate_charge',
    'wrong_amount', 'outside_mandate', 'cancelled_order', 'other'
  )),
  status text not null default 'open' check (status in (
    'open', 'under_review', 'evidence_requested',
    'resolved_refunded', 'resolved_upheld', 'withdrawn'
  )),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  buyer_statement text not null check (char_length(buyer_statement) between 10 and 2000),
  merchant_response text check (merchant_response is null or char_length(merchant_response) between 1 and 2000),
  resolution text check (resolution is null or char_length(resolution) between 1 and 2000),
  resolved_at timestamptz,
  -- The model's reading of the buyer's history at this merchant. Advisory: it
  -- never changes `status`, which only a person sets.
  analysis jsonb,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open dispute per charge. A buyer who disputes the same attempt twice is
-- adding to the first one, not opening a second case against the same money.
create unique index if not exists disputes_one_open_per_attempt
  on public.disputes (attempt_id)
  where status not in ('withdrawn', 'resolved_refunded', 'resolved_upheld');

create index if not exists disputes_user_created_idx on public.disputes (user_id, created_at desc);
create index if not exists disputes_merchant_created_idx on public.disputes (merchant_id, created_at desc);
create index if not exists disputes_mandate_idx on public.disputes (mandate_id);

create table if not exists public.dispute_events (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes(id) on delete cascade,
  actor text not null check (actor in ('buyer', 'merchant', 'agentpay', 'analysis')),
  action text not null check (char_length(action) between 1 and 60),
  detail text check (detail is null or char_length(detail) <= 2000),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists dispute_events_dispute_idx on public.dispute_events (dispute_id, created_at);

alter table public.disputes enable row level security;
alter table public.dispute_events enable row level security;

drop policy if exists "Buyer and merchant read the dispute" on public.disputes;
create policy "Buyer and merchant read the dispute" on public.disputes
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.merchant_memberships membership
      where membership.merchant_id = disputes.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

drop policy if exists "Buyer and merchant read the dispute timeline" on public.dispute_events;
create policy "Buyer and merchant read the dispute timeline" on public.dispute_events
  for select to authenticated
  using (
    exists (
      select 1 from public.disputes dispute
      where dispute.id = dispute_events.dispute_id
        and (
          dispute.user_id = (select auth.uid())
          or exists (
            select 1 from public.merchant_memberships membership
            where membership.merchant_id = dispute.merchant_id
              and membership.user_id = (select auth.uid())
              and membership.role = 'owner'
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Buyer side
-- ---------------------------------------------------------------------------

create or replace function public.open_agentpay_dispute(
  p_attempt_id uuid,
  p_reason_code text,
  p_buyer_statement text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_attempt public.attempts;
  v_dispute public.disputes;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and user_id = v_user_id;

  if v_attempt.id is null then
    raise exception 'Purchase not found';
  end if;
  -- Only money that actually moved can be disputed. A refused attempt already
  -- has its answer: the reason code that refused it.
  if v_attempt.decision <> 'approved' then
    raise exception 'Only an approved purchase can be disputed';
  end if;

  insert into public.disputes (
    attempt_id, user_id, merchant_id, mandate_id, reason_code,
    amount_cents, currency, buyer_statement
  ) values (
    v_attempt.id, v_user_id, v_attempt.merchant_id, v_attempt.mandate_id,
    p_reason_code, v_attempt.amount_cents, v_attempt.currency, btrim(p_buyer_statement)
  ) returning * into v_dispute;

  insert into public.dispute_events (dispute_id, actor, action, detail, payload)
  values (
    v_dispute.id, 'buyer', 'opened', btrim(p_buyer_statement),
    jsonb_build_object(
      'reason_code', p_reason_code,
      'amount_cents', v_attempt.amount_cents,
      'purchase_reason', v_attempt.purchase_reason
    )
  );

  perform public.append_agentpay_audit(
    'user:' || v_user_id::text,
    'dispute.opened',
    v_dispute.id::text,
    jsonb_build_object(
      'attempt_id', v_attempt.id,
      'merchant_id', v_attempt.merchant_id,
      'reason_code', p_reason_code,
      'amount_cents', v_attempt.amount_cents
    )
  );

  return to_jsonb(v_dispute);
end;
$function$;

create or replace function public.withdraw_agentpay_dispute(p_dispute_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_dispute public.disputes;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  update public.disputes
  set status = 'withdrawn', resolved_at = now(), updated_at = now(),
      resolution = coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Withdrawn by the account holder.')
  where id = p_dispute_id
    and user_id = v_user_id
    and status not in ('withdrawn', 'resolved_refunded', 'resolved_upheld')
  returning * into v_dispute;

  if v_dispute.id is null then
    raise exception 'No open dispute to withdraw';
  end if;

  insert into public.dispute_events (dispute_id, actor, action, detail)
  values (v_dispute.id, 'buyer', 'withdrawn', v_dispute.resolution);

  perform public.append_agentpay_audit(
    'user:' || v_user_id::text, 'dispute.withdrawn', v_dispute.id::text,
    jsonb_build_object('attempt_id', v_dispute.attempt_id)
  );

  return to_jsonb(v_dispute);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Merchant side, by console session
-- ---------------------------------------------------------------------------

create or replace function public.respond_to_agentpay_dispute(
  p_dispute_id uuid,
  p_status text,
  p_merchant_response text,
  p_resolution text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_dispute public.disputes;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_status not in ('under_review', 'evidence_requested', 'resolved_refunded', 'resolved_upheld') then
    raise exception 'Invalid dispute status';
  end if;

  select * into v_dispute
  from public.disputes
  where id = p_dispute_id
    and exists (
      select 1 from public.merchant_memberships membership
      where membership.merchant_id = disputes.merchant_id
        and membership.user_id = v_user_id
        and membership.role = 'owner'
    );

  if v_dispute.id is null then
    raise exception 'Dispute not found';
  end if;
  if v_dispute.status in ('withdrawn', 'resolved_refunded', 'resolved_upheld') then
    raise exception 'This dispute is already closed';
  end if;

  update public.disputes
  set status = p_status,
      merchant_response = nullif(btrim(coalesce(p_merchant_response, '')), ''),
      resolution = case when p_status like 'resolved_%'
        then nullif(btrim(coalesce(p_resolution, p_merchant_response, '')), '') else resolution end,
      resolved_at = case when p_status like 'resolved_%' then now() else resolved_at end,
      updated_at = now()
  where id = p_dispute_id
  returning * into v_dispute;

  insert into public.dispute_events (dispute_id, actor, action, detail, payload)
  values (v_dispute.id, 'merchant', p_status, v_dispute.merchant_response, jsonb_build_object('via', 'console'));

  return to_jsonb(v_dispute);
end;
$function$;

create or replace function public.record_agentpay_dispute_analysis(p_dispute_id uuid, p_analysis jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_dispute public.disputes;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  update public.disputes
  set analysis = p_analysis, analyzed_at = now(), updated_at = now()
  where id = p_dispute_id
    and (
      user_id = v_user_id
      or exists (
        select 1 from public.merchant_memberships membership
        where membership.merchant_id = disputes.merchant_id
          and membership.user_id = v_user_id
          and membership.role = 'owner'
      )
    )
  returning * into v_dispute;

  if v_dispute.id is null then
    raise exception 'Dispute not found';
  end if;

  insert into public.dispute_events (dispute_id, actor, action, detail, payload)
  values (
    v_dispute.id, 'analysis', 'analyzed',
    p_analysis->>'summary',
    jsonb_build_object(
      'likely_cause', p_analysis->>'likely_cause',
      'confidence', p_analysis->>'confidence',
      'recommendation', p_analysis->>'recommendation',
      'model', p_analysis->>'model'
    )
  );

  return to_jsonb(v_dispute);
end;
$function$;

revoke all on function public.open_agentpay_dispute(uuid, text, text) from public;
grant execute on function public.open_agentpay_dispute(uuid, text, text) to authenticated;
revoke all on function public.withdraw_agentpay_dispute(uuid, text) from public;
grant execute on function public.withdraw_agentpay_dispute(uuid, text) to authenticated;
revoke all on function public.respond_to_agentpay_dispute(uuid, text, text, text) from public;
grant execute on function public.respond_to_agentpay_dispute(uuid, text, text, text) to authenticated;
revoke all on function public.record_agentpay_dispute_analysis(uuid, jsonb) from public;
grant execute on function public.record_agentpay_dispute_analysis(uuid, jsonb) to authenticated;

-- Supabase grants EXECUTE on new public functions to anon by default, so
-- `revoke ... from public` alone leaves them reachable without a session. These
-- four already refuse an anonymous caller inside the function body; revoking
-- anon removes the second, quieter way to learn they exist.
revoke execute on function public.open_agentpay_dispute(uuid, text, text) from anon;
revoke execute on function public.withdraw_agentpay_dispute(uuid, text) from anon;
revoke execute on function public.respond_to_agentpay_dispute(uuid, text, text, text) from anon;
revoke execute on function public.record_agentpay_dispute_analysis(uuid, jsonb) from anon;
