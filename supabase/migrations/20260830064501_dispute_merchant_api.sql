-- Merchant-facing dispute and transaction API, authenticated by merchant API key.
--
-- The console reads the same rows through RLS; these functions exist so a
-- merchant's own systems can reach them without a browser session. They
-- deliberately do not require `agent_ready`: a store must be able to read its
-- history and answer a dispute even after it leaves the agent-ready set.

create or replace function public.authorize_agentpay_merchant_key(p_secret_hash text, p_merchant_id text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_merchant_id text;
begin
  if p_secret_hash is null or p_secret_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;

  select api_key.merchant_id into v_merchant_id
  from public.merchant_api_keys api_key
  where api_key.secret_hash = p_secret_hash
    and api_key.merchant_id = p_merchant_id
    and api_key.revoked_at is null
    and (api_key.expires_at is null or api_key.expires_at > now())
  for update of api_key;

  if v_merchant_id is null then
    return null;
  end if;

  update public.merchant_api_keys set last_used_at = now() where secret_hash = p_secret_hash;
  return v_merchant_id;
end;
$function$;

create or replace function public.list_agentpay_merchant_transactions(
  p_secret_hash text,
  p_merchant_id text,
  p_decision text default null,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_product_id text default null,
  p_disputed boolean default null,
  p_limit integer default 50,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_merchant_id text := public.authorize_agentpay_merchant_key(p_secret_hash, p_merchant_id);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows jsonb;
begin
  if v_merchant_id is null then
    return null;
  end if;
  if p_decision is not null and p_decision not in ('approved', 'refused', 'escalated') then
    raise exception 'Invalid decision filter';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb) into v_rows
  from (
    select
      attempt.id,
      attempt.created_at,
      attempt.product_id,
      attempt.amount_cents,
      attempt.shipping_cents,
      attempt.currency,
      attempt.decision,
      attempt.reason_code,
      attempt.mandate_id,
      attempt.agent_id,
      -- The buyer's own words about why the agent bought this. It is the field
      -- that makes a transaction list reviewable rather than just auditable.
      attempt.purchase_reason,
      attempt.shipping_address_source,
      attempt.shipping_address,
      attempt.fulfillment,
      -- The account is identified by a stable pseudonym, never by the buyer's
      -- auth id: a merchant needs to recognise a repeat customer, not identify
      -- a person.
      encode(extensions.digest(convert_to(attempt.user_id::text || '|' || v_merchant_id, 'UTF8'), 'sha256'), 'hex') as buyer_ref,
      dispute.id as dispute_id,
      dispute.status as dispute_status,
      dispute.reason_code as dispute_reason_code
    from public.attempts attempt
    left join public.disputes dispute on dispute.attempt_id = attempt.id
    where attempt.merchant_id = v_merchant_id
      and (p_decision is null or attempt.decision = p_decision)
      and (p_since is null or attempt.created_at >= p_since)
      and (p_until is null or attempt.created_at <= p_until)
      and (p_before is null or attempt.created_at < p_before)
      and (p_product_id is null or attempt.product_id = p_product_id)
      and (p_disputed is null or (dispute.id is not null) = p_disputed)
    order by attempt.created_at desc
    limit v_limit
  ) t;

  return jsonb_build_object(
    'merchant_id', v_merchant_id,
    'count', jsonb_array_length(v_rows),
    'limit', v_limit,
    'transactions', v_rows
  );
end;
$function$;

create or replace function public.list_agentpay_merchant_disputes(
  p_secret_hash text,
  p_merchant_id text,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_merchant_id text := public.authorize_agentpay_merchant_key(p_secret_hash, p_merchant_id);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows jsonb;
begin
  if v_merchant_id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(row_to_json(d) order by d.created_at desc), '[]'::jsonb) into v_rows
  from (
    select
      dispute.id, dispute.attempt_id, dispute.status, dispute.reason_code,
      dispute.amount_cents, dispute.currency, dispute.buyer_statement,
      dispute.merchant_response, dispute.resolution, dispute.analysis,
      dispute.analyzed_at, dispute.created_at, dispute.updated_at, dispute.resolved_at,
      attempt.product_id, attempt.purchase_reason, attempt.fulfillment,
      encode(extensions.digest(convert_to(dispute.user_id::text || '|' || v_merchant_id, 'UTF8'), 'sha256'), 'hex') as buyer_ref
    from public.disputes dispute
    join public.attempts attempt on attempt.id = dispute.attempt_id
    where dispute.merchant_id = v_merchant_id
      and (p_status is null or dispute.status = p_status)
    order by dispute.created_at desc
    limit v_limit
  ) d;

  return jsonb_build_object('merchant_id', v_merchant_id, 'count', jsonb_array_length(v_rows), 'disputes', v_rows);
end;
$function$;

/**
 * Everything needed to judge one dispute, in one call: the disputed charge, the
 * mandate that allowed it, and every other purchase the same buyer made at this
 * merchant. The history is the point — "I do not recognise this" reads very
 * differently against a first order than against the fourth identical one.
 */
create or replace function public.get_agentpay_merchant_dispute_context(
  p_secret_hash text,
  p_merchant_id text,
  p_dispute_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_merchant_id text := public.authorize_agentpay_merchant_key(p_secret_hash, p_merchant_id);
  v_dispute public.disputes;
  v_attempt public.attempts;
  v_mandate public.mandates;
  v_history jsonb;
  v_prior_disputes jsonb;
  v_buyer_ref text;
begin
  if v_merchant_id is null then
    return null;
  end if;

  select * into v_dispute from public.disputes
  where id = p_dispute_id and merchant_id = v_merchant_id;
  if v_dispute.id is null then
    return null;
  end if;

  select * into v_attempt from public.attempts where id = v_dispute.attempt_id;
  select * into v_mandate from public.mandates where id = v_dispute.mandate_id;
  v_buyer_ref := encode(extensions.digest(convert_to(v_dispute.user_id::text || '|' || v_merchant_id, 'UTF8'), 'sha256'), 'hex');

  select coalesce(jsonb_agg(row_to_json(h) order by h.created_at desc), '[]'::jsonb) into v_history
  from (
    select
      attempt.id, attempt.created_at, attempt.product_id, attempt.amount_cents,
      attempt.shipping_cents, attempt.currency, attempt.decision, attempt.reason_code,
      attempt.purchase_reason, attempt.shipping_address_source,
      attempt.fulfillment->'estimated_delivery'->>'text' as estimated_delivery,
      attempt.fulfillment->>'method' as shipping_method,
      product.name as product_name, product.category as product_category
    from public.attempts attempt
    left join public.products product on product.id = attempt.product_id
    where attempt.merchant_id = v_merchant_id
      and attempt.user_id = v_dispute.user_id
    order by attempt.created_at desc
    limit 100
  ) h;

  select coalesce(jsonb_agg(row_to_json(d) order by d.created_at desc), '[]'::jsonb) into v_prior_disputes
  from (
    select dispute.id, dispute.created_at, dispute.reason_code, dispute.status,
           dispute.amount_cents, dispute.attempt_id
    from public.disputes dispute
    where dispute.merchant_id = v_merchant_id
      and dispute.user_id = v_dispute.user_id
      and dispute.id <> v_dispute.id
    order by dispute.created_at desc
    limit 50
  ) d;

  return jsonb_build_object(
    'merchant_id', v_merchant_id,
    'buyer_ref', v_buyer_ref,
    'dispute', to_jsonb(v_dispute) - 'user_id',
    'disputed_purchase', to_jsonb(v_attempt) - 'user_id' - 'payment_token' - 'cart_hash',
    'mandate', case when v_mandate.id is null then null else jsonb_build_object(
      'id', v_mandate.id,
      'status', v_mandate.status,
      'scope', v_mandate.scope,
      'limits', v_mandate.limits,
      'validity', v_mandate.validity,
      'natural_language_description', v_mandate.natural_language_description,
      'created_at', v_mandate.created_at,
      'revoked_at', v_mandate.revoked_at
    ) end,
    'purchase_history', v_history,
    'prior_disputes', v_prior_disputes
  );
end;
$function$;

create or replace function public.respond_to_agentpay_merchant_dispute(
  p_secret_hash text,
  p_merchant_id text,
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
  v_merchant_id text := public.authorize_agentpay_merchant_key(p_secret_hash, p_merchant_id);
  v_dispute public.disputes;
begin
  if v_merchant_id is null then
    return null;
  end if;
  if p_status not in ('under_review', 'evidence_requested', 'resolved_refunded', 'resolved_upheld') then
    raise exception 'Invalid dispute status';
  end if;

  update public.disputes
  set status = p_status,
      merchant_response = nullif(btrim(coalesce(p_merchant_response, '')), ''),
      resolution = case when p_status like 'resolved_%'
        then nullif(btrim(coalesce(p_resolution, p_merchant_response, '')), '') else resolution end,
      resolved_at = case when p_status like 'resolved_%' then now() else resolved_at end,
      updated_at = now()
  where id = p_dispute_id
    and merchant_id = v_merchant_id
    and status not in ('withdrawn', 'resolved_refunded', 'resolved_upheld')
  returning * into v_dispute;

  if v_dispute.id is null then
    raise exception 'No open dispute with that id at this merchant';
  end if;

  insert into public.dispute_events (dispute_id, actor, action, detail, payload)
  values (v_dispute.id, 'merchant', p_status, v_dispute.merchant_response, jsonb_build_object('via', 'api'));

  return to_jsonb(v_dispute);
end;
$function$;

create or replace function public.record_agentpay_merchant_dispute_analysis(
  p_secret_hash text,
  p_merchant_id text,
  p_dispute_id uuid,
  p_analysis jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_merchant_id text := public.authorize_agentpay_merchant_key(p_secret_hash, p_merchant_id);
  v_dispute public.disputes;
begin
  if v_merchant_id is null then
    return null;
  end if;

  update public.disputes
  set analysis = p_analysis, analyzed_at = now(), updated_at = now()
  where id = p_dispute_id and merchant_id = v_merchant_id
  returning * into v_dispute;

  if v_dispute.id is null then
    raise exception 'Dispute not found at this merchant';
  end if;

  insert into public.dispute_events (dispute_id, actor, action, detail, payload)
  values (
    v_dispute.id, 'analysis', 'analyzed', p_analysis->>'summary',
    jsonb_build_object(
      'likely_cause', p_analysis->>'likely_cause',
      'confidence', p_analysis->>'confidence',
      'recommendation', p_analysis->>'recommendation',
      'model', p_analysis->>'model',
      'via', 'api'
    )
  );

  return to_jsonb(v_dispute);
end;
$function$;

-- The key check itself is internal: only the wrappers below may call it.
revoke all on function public.authorize_agentpay_merchant_key(text, text) from public, anon, authenticated;
revoke all on function public.list_agentpay_merchant_transactions(text, text, text, timestamptz, timestamptz, text, boolean, integer, timestamptz) from public;
grant execute on function public.list_agentpay_merchant_transactions(text, text, text, timestamptz, timestamptz, text, boolean, integer, timestamptz) to anon, authenticated;
revoke all on function public.list_agentpay_merchant_disputes(text, text, text, integer) from public;
grant execute on function public.list_agentpay_merchant_disputes(text, text, text, integer) to anon, authenticated;
revoke all on function public.get_agentpay_merchant_dispute_context(text, text, uuid) from public;
grant execute on function public.get_agentpay_merchant_dispute_context(text, text, uuid) to anon, authenticated;
revoke all on function public.respond_to_agentpay_merchant_dispute(text, text, uuid, text, text, text) from public;
grant execute on function public.respond_to_agentpay_merchant_dispute(text, text, uuid, text, text, text) to anon, authenticated;
revoke all on function public.record_agentpay_merchant_dispute_analysis(text, text, uuid, jsonb) from public;
grant execute on function public.record_agentpay_merchant_dispute_analysis(text, text, uuid, jsonb) to anon, authenticated;
