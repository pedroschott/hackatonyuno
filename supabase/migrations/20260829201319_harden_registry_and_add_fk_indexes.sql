drop policy "Public agent keys are readable" on public.agents;

create policy "Users read their own agent"
  on public.agents for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke select on public.agents from anon;

create or replace function public.get_agent_registry(p_agent_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', a.id, 'public_key', a.public_key)
  from public.agents a
  where a.id = p_agent_id;
$$;

comment on function public.get_agent_registry(text) is
  'Intentional public verifier endpoint. Returns one agent public key by unguessable ID; never lists agents or exposes owners.';
revoke all on function public.get_agent_registry(text) from public;
grant execute on function public.get_agent_registry(text) to anon, authenticated;

create index products_merchant_id_idx on public.products (merchant_id);
create index vault_cards_user_id_idx on public.vault_cards (user_id);
create index webauthn_credentials_user_id_idx on public.webauthn_credentials (user_id);
create index webauthn_challenges_user_id_idx on public.webauthn_challenges (user_id);
create index mandates_agent_id_idx on public.mandates (agent_id);
create index attempts_user_id_idx on public.attempts (user_id);
create index attempts_exception_id_idx on public.attempts (exception_id) where exception_id is not null;
create index approvals_mandate_id_idx on public.approvals (mandate_id);
create index approvals_attempt_id_idx on public.approvals (attempt_id);
