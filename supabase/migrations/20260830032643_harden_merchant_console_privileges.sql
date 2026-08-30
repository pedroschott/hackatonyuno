begin;

-- Supabase projects can carry default public-schema grants. Make the merchant
-- console boundary explicit instead of depending on project-wide defaults.
revoke all on public.merchants from anon, authenticated;
revoke all on public.merchant_memberships from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.merchant_api_keys from anon, authenticated;

grant select on public.merchants to anon, authenticated;
grant update (name, category, description, website_url, discovery_url, publicly_listed, updated_at)
  on public.merchants to authenticated;
grant select on public.merchant_memberships to authenticated;
grant select on public.products to anon;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update on public.merchant_api_keys to authenticated;

revoke all on function public.reset_agentpay_merchant_verification() from public, anon, authenticated;
revoke all on function public.create_agentpay_merchant(text, text, text, text, text, text, text, boolean, text)
  from public, anon, authenticated;
revoke all on function public.create_agentpay_merchant_product(text, text, text, text, text, text, text, integer, text)
  from public, anon, authenticated;

grant execute on function public.create_agentpay_merchant(text, text, text, text, text, text, text, boolean, text)
  to authenticated;
grant execute on function public.create_agentpay_merchant_product(text, text, text, text, text, text, text, integer, text)
  to anon, authenticated;

commit;
