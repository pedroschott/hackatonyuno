begin;

-- Approved attempts are inserted by an authenticated user through the
-- security-invoker checkout RPC. Its defense-in-depth trigger only needs to
-- read the rollout latch; keep every other private object inaccessible.
grant usage on schema agentpay_private to authenticated;
grant select on agentpay_private.didit_verification_config to authenticated;

create policy "Authenticated checkout may read the Didit gate latch"
on agentpay_private.didit_verification_config
for select
to authenticated
using (singleton = true);

commit;
