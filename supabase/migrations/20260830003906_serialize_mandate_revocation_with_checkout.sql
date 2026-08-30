-- Revocation and checkout share one per-mandate linearization boundary. If
-- revocation commits first, the checkout's final registry read must observe it
-- and no payment token may be minted. If checkout commits first, the purchase
-- is already part of the audit trail before the mandate becomes revoked.
create or replace function public.revoke_agentpay_mandate(p_mandate_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.mandates;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_mandate_id::text, 0));

  update public.mandates
  set status = 'revoked', revoked_at = coalesce(revoked_at, now()), updated_at = now()
  where id = p_mandate_id
    and issuer_user_id = (select auth.uid())
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Mandate not found';
  end if;

  perform public.append_agentpay_audit(
    'user:' || (select auth.uid())::text,
    'mandate.revoked',
    p_mandate_id::text,
    jsonb_build_object(
      'status', 'revoked',
      'revoked_at', v_row.revoked_at,
      'linearization', 'mandate-checkout-lock-v1'
    )
  );
  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'revoked_at', v_row.revoked_at
  );
end;
$$;

revoke all on function public.revoke_agentpay_mandate(uuid) from public;
grant execute on function public.revoke_agentpay_mandate(uuid) to authenticated;

comment on function public.revoke_agentpay_mandate(uuid) is
  'Revokes a user-owned mandate under the same advisory transaction lock used by checkout settlement.';
