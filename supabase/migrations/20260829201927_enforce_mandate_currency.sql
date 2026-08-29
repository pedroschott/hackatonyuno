create or replace function public.evaluate_agentpay_checkout(
  p_mandate_id uuid,
  p_agent_id text,
  p_merchant_id text,
  p_product_id text,
  p_category text,
  p_amount_cents integer,
  p_currency text,
  p_exception_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_mandate public.mandates;
  v_attempt_id uuid := gen_random_uuid();
  v_approval_id uuid;
  v_decision text := 'approved';
  v_reason text;
  v_uses integer := 0;
  v_cumulative bigint := 0;
  v_cart_hash text;
  v_payment_token jsonb;
  v_exception_valid boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_mandate_id::text, 0));
  select * into v_mandate
  from public.mandates
  where id = p_mandate_id and issuer_user_id = v_user_id;

  if v_mandate.id is null then
    return jsonb_build_object('decision', 'refused', 'reason_code', 'MANDATE_NOT_FOUND');
  end if;

  if p_amount_cents <= 0 or char_length(p_currency) <> 3 or p_category = '' then
    raise exception 'Invalid merchant cart';
  end if;

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
    currency, decision, reason_code, exception_id, cart_hash, payment_token, verification
  ) values (
    v_attempt_id, p_mandate_id, v_user_id, p_agent_id, p_merchant_id, p_product_id,
    p_amount_cents, p_currency, v_decision, v_reason,
    case when v_exception_valid then p_exception_id else null end,
    v_cart_hash, v_payment_token,
    jsonb_build_object('agent_signature', true, 'mandate_signature', v_mandate.server_sig is not null,
      'registry_status', v_mandate.status, 'policy_engine', 'postgres-v1')
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
      'merchant_id', p_merchant_id,
      'product_id', p_product_id,
      'amount_cents', p_amount_cents,
      'reason_code', v_reason,
      'approval_id', v_approval_id
    )
  );

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'decision', v_decision,
    'reason_code', v_reason,
    'approval_id', v_approval_id,
    'payment_token', v_payment_token
  );
end;
$$;

revoke all on function public.evaluate_agentpay_checkout(uuid, text, text, text, text, integer, text, uuid) from public;
grant execute on function public.evaluate_agentpay_checkout(uuid, text, text, text, text, integer, text, uuid) to authenticated;
