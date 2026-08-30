-- Use one explicit, stored digest input across PostgreSQL and the browser.
-- The first schema hashed PostgreSQL text but the browser reconstructed a
-- different JSON document, so valid production rows could fail verification.

alter table public.audit_log
  add column hash_version smallint,
  add column hash_material text;

create or replace function public.agentpay_audit_material(
  p_ts timestamptz,
  p_actor text,
  p_action text,
  p_entity text,
  p_payload jsonb
) returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'ts', pg_catalog.to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor', p_actor,
    'action', p_action,
    'entity', coalesce(p_entity, ''),
    'payload', coalesce(p_payload, '{}'::jsonb)
  )::text;
$$;

-- This is a one-time repair of the original cross-runtime digest contract.
-- Event content, ordering and timestamps remain unchanged; only the derived
-- chain fields are recomputed using the version 2 material above.
do $$
declare
  v_row record;
  v_user_id uuid;
  v_prev text := repeat('0', 64);
  v_material text;
  v_hash text;
begin
  for v_row in
    select seq, user_id, ts, actor, action, entity, payload
    from public.audit_log
    order by user_id, seq
  loop
    if v_user_id is distinct from v_row.user_id then
      v_user_id := v_row.user_id;
      v_prev := repeat('0', 64);
    end if;

    v_material := public.agentpay_audit_material(
      v_row.ts,
      v_row.actor,
      v_row.action,
      v_row.entity,
      v_row.payload
    );
    v_hash := encode(
      extensions.digest(convert_to(v_prev || v_material, 'UTF8'), 'sha256'),
      'hex'
    );

    update public.audit_log
    set prev_hash = v_prev,
        hash = v_hash,
        hash_version = 2,
        hash_material = v_material
    where seq = v_row.seq;

    v_prev := v_hash;
  end loop;
end;
$$;

alter table public.audit_log
  alter column hash_version set default 2,
  alter column hash_version set not null,
  alter column hash_material set not null,
  add constraint audit_log_hash_version_check check (hash_version = 2),
  add constraint audit_log_hash_material_not_empty check (hash_material <> '');

create or replace function public.append_agentpay_audit(
  p_actor text,
  p_action text,
  p_entity text default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_prev text;
  v_hash text;
  v_material text;
  v_ts timestamptz := clock_timestamp();
  v_seq bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  select a.hash into v_prev
  from public.audit_log a
  where a.user_id = v_user_id
  order by a.seq desc
  limit 1;

  v_prev := coalesce(v_prev, repeat('0', 64));
  v_material := public.agentpay_audit_material(v_ts, p_actor, p_action, p_entity, p_payload);
  v_hash := encode(
    extensions.digest(convert_to(v_prev || v_material, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.audit_log (
    user_id,
    ts,
    actor,
    action,
    entity,
    payload,
    prev_hash,
    hash,
    hash_version,
    hash_material
  ) values (
    v_user_id,
    v_ts,
    p_actor,
    p_action,
    p_entity,
    p_payload,
    v_prev,
    v_hash,
    2,
    v_material
  )
  returning seq into v_seq;

  return jsonb_build_object(
    'seq', v_seq,
    'hash', v_hash,
    'prev_hash', v_prev,
    'hash_version', 2
  );
end;
$$;

revoke all on function public.agentpay_audit_material(timestamptz, text, text, text, jsonb) from public;
grant execute on function public.agentpay_audit_material(timestamptz, text, text, text, jsonb) to authenticated;
revoke all on function public.append_agentpay_audit(text, text, text, jsonb) from public;
grant execute on function public.append_agentpay_audit(text, text, text, jsonb) to authenticated;
