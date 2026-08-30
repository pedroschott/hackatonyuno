begin;

create index merchant_api_keys_created_by_idx
  on public.merchant_api_keys (created_by);

drop policy "Merchant metadata is public" on public.merchants;
drop policy "Developers read their merchants" on public.merchants;

create policy "Agent-ready merchant metadata is public"
  on public.merchants for select to anon
  using (agent_ready = true);

create policy "Developers read public and owned merchants"
  on public.merchants for select to authenticated
  using (
    agent_ready = true or exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = merchants.id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

drop policy "Agent-ready product catalog is public" on public.products;
drop policy "Developers read their products" on public.products;

create policy "Agent-ready product catalog is public"
  on public.products for select to anon
  using (
    active = true and exists (
      select 1
      from public.merchants merchant
      where merchant.id = products.merchant_id
        and merchant.agent_ready = true
    )
  );

create policy "Developers read public and owned products"
  on public.products for select to authenticated
  using (
    (
      active = true and exists (
        select 1
        from public.merchants merchant
        where merchant.id = products.merchant_id
          and merchant.agent_ready = true
      )
    ) or exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = products.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

drop policy "Users read their attempts" on public.attempts;
drop policy "Developers read merchant attempts" on public.attempts;

create policy "Users and developers read relevant attempts"
  on public.attempts for select to authenticated
  using (
    (select auth.uid()) = user_id or exists (
      select 1
      from public.merchant_memberships membership
      where membership.merchant_id = attempts.merchant_id
        and membership.user_id = (select auth.uid())
        and membership.role = 'owner'
    )
  );

revoke execute on function public.create_agentpay_merchant_product(text, text, text, text, text, text, text, integer, text)
  from authenticated;

commit;
