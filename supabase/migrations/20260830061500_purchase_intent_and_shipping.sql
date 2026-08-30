-- Purchase intent and delivery on every agentic attempt.
--
-- Two things were missing from the record of an autonomous purchase. First, why
-- it happened: an attempt row said what was bought and under which mandate, but
-- nothing about the request behind it, which is exactly what a buyer needs
-- months later when they no longer recognise a charge. Second, where it went:
-- the registered address was implied and a one-off delivery address could not be
-- expressed at all.
--
-- Both are now columns on the attempt and both are inside the hash-chained audit
-- payload, so they are part of the tamper-evident record rather than metadata
-- sitting beside it. `purchase_reason` is required: an attempt that cannot say
-- why it is being made is refused before it is written.

alter table public.attempts
  add column if not exists purchase_reason text,
  add column if not exists shipping_address jsonb,
  add column if not exists shipping_address_source text,
  add column if not exists shipping_cents integer not null default 0,
  add column if not exists fulfillment jsonb;

alter table public.attempts
  drop constraint if exists attempts_purchase_reason_length,
  add constraint attempts_purchase_reason_length
    check (purchase_reason is null or char_length(purchase_reason) between 1 and 500);

alter table public.attempts
  drop constraint if exists attempts_shipping_source_valid,
  add constraint attempts_shipping_source_valid
    check (shipping_address_source is null or shipping_address_source in ('registered', 'custom'));

alter table public.attempts
  drop constraint if exists attempts_shipping_cents_nonnegative,
  add constraint attempts_shipping_cents_nonnegative check (shipping_cents >= 0);

comment on column public.attempts.purchase_reason is
  'Why the agent made this purchase, in the buyer''s own words. Recorded verbatim, never scored by the policy engine.';
comment on column public.attempts.shipping_address is
  'Delivery address for this order only. Equals the account''s registered address unless shipping_address_source is ''custom''.';
comment on column public.attempts.shipping_cents is
  'Delivery quoted by the merchant, already included in amount_cents.';

create or replace function public.evaluate_agentpay_checkout(
  p_mandate_id uuid,
  p_agent_id text,
  p_merchant_id text,
  p_product_id text,
  p_category text,
  p_amount_cents integer,
  p_currency text,
  p_exception_id uuid default null,
  p_purchase_reason text default null,
  p_shipping_address jsonb default null,
  p_shipping_source text default null,
  p_shipping_cents integer default 0,
  p_fulfillment jsonb default null
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_mandate public.mandates;
  v_payment_method_id uuid;
  v_attempt_id uuid := gen_random_uuid();
  v_approval_id uuid;
  v_decision text := 'approved';
  v_reason text;
  v_uses integer := 0;
  v_cumulative bigint := 0;
  v_cart_hash text;
  v_payment_token jsonb;
  v_exception_valid boolean := false;
  v_purchase_reason text := nullif(btrim(coalesce(p_purchase_reason, '')), '');
  v_shipping_cents integer := greatest(coalesce(p_shipping_cents, 0), 0);
  v_shipping_source text := nullif(btrim(coalesce(p_shipping_source, '')), '');
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- An autonomous purchase with no stated motivation cannot be reviewed later,
  -- so it is not recorded at all. This is the one field the buyer, not the
  -- policy, needs when a charge is disputed.
  if v_purchase_reason is null then
    raise exception 'Purchase reason is required';
  end if;
  if char_length(v_purchase_reason) > 500 then
    v_purchase_reason := left(v_purchase_reason, 500);
  end if;
  if v_shipping_source is not null and v_shipping_source not in ('registered', 'custom') then
    raise exception 'Invalid shipping address source';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_mandate_id::text, 0));
  select * into v_mandate
  from public.mandates
  where id = p_mandate_id and issuer_user_id = v_user_id;

  if v_mandate.id is null then
    return jsonb_build_object('decision', 'refused', 'reason_code', 'MANDATE_NOT_FOUND');
  end if;

  begin
    v_payment_method_id := (v_mandate.payment->>'vault_card_id')::uuid;
  exception when invalid_text_representation then
    v_payment_method_id := null;
  end;

  if p_amount_cents <= 0 or char_length(p_currency) <> 3 or p_category = '' then
    raise exception 'Invalid merchant cart';
  end if;

  -- The hash binds an approval to one exact charge. Delivery is inside
  -- p_amount_cents, so approving a $180 order shipped to the depot does not
  -- silently authorise the same part shipped somewhere that costs more.
  v_cart_hash := encode(
    extensions.digest(
      convert_to(p_mandate_id::text || '|' || p_merchant_id || '|' || p_product_id || '|' || p_amount_cents::text || '|' || p_currency, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select
    count(*) filter (where decision = 'approved'),
    coalesce(sum(amount_cents) filter (where decision = 'approved'), 0)
  into v_uses, v_cumulative
  from public.attempts
  where mandate_id = p_mandate_id
    and created_at >= date_trunc('month', now());

  if p_exception_id is not null then
    select exists(
      select 1 from public.approvals ap
      where ap.id = p_exception_id
        and ap.user_id = v_user_id
        and ap.mandate_id = p_mandate_id
        and ap.cart_hash = v_cart_hash
        and ap.status = 'approved'
        and ap.consumed_at is null
    ) into v_exception_valid;
  end if;

  if p_agent_id <> v_mandate.agent_id then
    v_decision := 'refused'; v_reason := 'AGENT_SIGNATURE_INVALID';
  elsif v_mandate.status = 'revoked' then
    v_decision := 'refused'; v_reason := 'MANDATE_REVOKED';
  elsif v_mandate.status <> 'active'
    or now() < (v_mandate.validity->>'not_before')::timestamptz
    or now() > (v_mandate.validity->>'expires_at')::timestamptz then
    v_decision := 'refused'; v_reason := 'MANDATE_EXPIRED';
  elsif v_payment_method_id is null or not exists (
    select 1 from public.vault_cards
    where id = v_payment_method_id and user_id = v_user_id
  ) then
    v_decision := 'refused'; v_reason := 'PAYMENT_METHOD_UNAVAILABLE';
  elsif not ((v_mandate.scope->'merchants') ? p_merchant_id) then
    v_decision := 'refused'; v_reason := 'MERCHANT_NOT_IN_SCOPE';
  elsif not ((v_mandate.scope->'categories') ? p_category) then
    v_decision := 'refused'; v_reason := 'CATEGORY_NOT_IN_SCOPE';
  elsif p_currency <> (v_mandate.limits->>'currency') then
    v_decision := 'refused'; v_reason := 'CURRENCY_MISMATCH';
  elsif v_uses >= (v_mandate.limits->>'max_uses')::integer then
    v_decision := 'refused'; v_reason := 'USES_EXCEEDED';
  elsif v_cumulative + p_amount_cents > (v_mandate.limits->>'cumulative_cents')::bigint then
    v_decision := 'refused'; v_reason := 'CUMULATIVE_EXCEEDED';
  elsif p_amount_cents > (v_mandate.limits->>'per_purchase_cents')::integer
    and not v_exception_valid then
    v_decision := 'escalated'; v_reason := 'AMOUNT_EXCEEDS_LIMIT';
  end if;

  if v_decision = 'approved' then
    v_payment_token := jsonb_build_object(
      'token', 'vt_mock_' || replace(gen_random_uuid()::text, '-', ''),
      'payment_method_id', v_payment_method_id,
      'allowance', jsonb_build_object(
        'reason', case when v_exception_valid then 'approved_exception' else 'one_time' end,
        'max_amount_cents', p_amount_cents,
        'currency', p_currency,
        'merchant_id', p_merchant_id,
        'attempt_id', v_attempt_id,
        'expires_at', now() + interval '5 minutes'
      )
    );
  end if;

  insert into public.attempts (
    id, mandate_id, user_id, agent_id, merchant_id, product_id, amount_cents,
    currency, decision, reason_code, exception_id, cart_hash, payment_token, verification,
    purchase_reason, shipping_address, shipping_address_source, shipping_cents, fulfillment
  ) values (
    v_attempt_id, p_mandate_id, v_user_id, p_agent_id, p_merchant_id, p_product_id,
    p_amount_cents, p_currency, v_decision, v_reason,
    case when v_exception_valid then p_exception_id else null end,
    v_cart_hash, v_payment_token,
    jsonb_build_object(
      'agent_signature', true,
      'mandate_signature', v_mandate.server_sig is not null,
      'registry_status', v_mandate.status,
      'policy_engine', 'postgres-v1',
      'payment_method_id', v_payment_method_id
    ),
    v_purchase_reason,
    p_shipping_address,
    coalesce(v_shipping_source, case when p_shipping_address is null then null else 'registered' end),
    v_shipping_cents,
    p_fulfillment
  );

  if v_exception_valid then
    update public.approvals set consumed_at = now() where id = p_exception_id;
  elsif v_decision = 'escalated' then
    insert into public.approvals (user_id, mandate_id, attempt_id, cart_hash)
    values (v_user_id, p_mandate_id, v_attempt_id, v_cart_hash)
    returning id into v_approval_id;
  end if;

  perform public.append_agentpay_audit(
    'agent:' || p_agent_id,
    'attempt.' || v_decision,
    v_attempt_id::text,
    jsonb_build_object(
      'mandate_id', p_mandate_id,
      'payment_method_id', v_payment_method_id,
      'merchant_id', p_merchant_id,
      'product_id', p_product_id,
      'amount_cents', p_amount_cents,
      'shipping_cents', v_shipping_cents,
      'reason_code', v_reason,
      'approval_id', v_approval_id,
      'purchase_reason', v_purchase_reason,
      'shipping_address_source', coalesce(v_shipping_source, 'registered'),
      'ships_to_city', p_shipping_address->>'city',
      'estimated_delivery', p_fulfillment->'estimated_delivery'->>'text'
    )
  );

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'decision', v_decision,
    'reason_code', v_reason,
    'approval_id', v_approval_id,
    'payment_method_id', v_payment_method_id,
    'payment_token', v_payment_token,
    'purchase_reason', v_purchase_reason,
    'shipping_cents', v_shipping_cents,
    'fulfillment', p_fulfillment
  );
end;
$function$;

-- The old eight-argument overload would otherwise stay resolvable and let a
-- caller record an attempt with no stated reason.
drop function if exists public.evaluate_agentpay_checkout(uuid, text, text, text, text, integer, text, uuid);

revoke all on function public.evaluate_agentpay_checkout(uuid, text, text, text, text, integer, text, uuid, text, jsonb, text, integer, jsonb) from public;
grant execute on function public.evaluate_agentpay_checkout(uuid, text, text, text, text, integer, text, uuid, text, jsonb, text, integer, jsonb) to authenticated;
