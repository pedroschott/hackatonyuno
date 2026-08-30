"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useStore } from "@/lib/store";
import { effectiveStatus, sameMonth } from "@/lib/engine";
import { brl } from "@/lib/format";
import { Button, Card, CardHeader, EmptyState } from "@/components/ui";
import { PermissionCard } from "@/components/app/PermissionCard";
import { RequestCard } from "@/components/app/RequestCard";
import { ApprovalCard } from "@/components/app/ApprovalCard";
import { PurchaseRow } from "@/components/app/PurchaseRow";

export default function SummaryPage() {
  const mandates = useStore((s) => s.mandates);
  const attempts = useStore((s) => s.attempts);
  const approvals = useStore((s) => s.approvals);
  const [turnedOff, setTurnedOff] = useState(false);

  const requests = mandates.filter((m) => m.status === "draft");
  const active = mandates.filter((m) => effectiveStatus(m) === "active");
  const waiting = approvals.filter((a) => a.status === "pending");
  const recent = attempts.slice(0, 4);

  const spent = useMemo(() => {
    const now = new Date();
    return attempts
      .filter((a) => a.decision === "approved" && sameMonth(a.created_at, now))
      .reduce((sum, a) => sum + a.amount_cents, 0);
  }, [attempts]);

  const allowance = active.reduce((sum, m) => sum + m.limits.cumulative_cents, 0);
  const mandateFor = (merchantId: string) => active.find((m) => m.scope.merchants.includes(merchantId)) ?? active[0];

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-white px-5 py-5 shadow-[var(--shadow-card)] sm:px-6 sm:py-6">
        <div className="text-[13.5px] text-muted">Your agents spent this month</div>
        <div className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.02em] tabular sm:text-[40px]">
          {brl(spent)}
        </div>
        <div className="mt-2 text-[13.5px] text-muted">
          {active.length === 0
            ? "No agent can spend right now."
            : `${brl(Math.max(0, allowance - spent))} still allowed this month.`}
        </div>
      </section>

      {turnedOff && active.length === 0 && (
        <div className="ap-in flex items-start gap-2.5 rounded-lg bg-success-soft px-4 py-3 text-[13.5px] text-success-ink">
          <ShieldCheck className="mt-px size-4 shrink-0" />
          <span>Spending is off. Anything your agent tries from now on will be declined.</span>
        </div>
      )}

      {(requests.length > 0 || waiting.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-[16px] font-semibold">Waiting for you</h2>
          {requests.map((m) => (
            <RequestCard key={m.id} mandate={m} />
          ))}
          {waiting.map((a) => (
            <ApprovalCard key={a.id} approval={a} mandate={mandateFor(a.merchant_id)} />
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-[16px] font-semibold">Who can spend</h2>
        {active.length > 0 ? (
          active.map((m) => <PermissionCard key={m.id} mandate={m} onTurnedOff={() => setTurnedOff(true)} />)
        ) : (
          <Card>
            <EmptyState
              title="Nobody can spend your money"
              description="Connect an agent and ask it to buy something. It will ask you here first, and you decide how much it may spend."
              action={
                <Link href="/connect">
                  <Button variant="primary" size="lg">
                    Connect an agent
                  </Button>
                </Link>
              }
            />
          </Card>
        )}
      </section>

      {attempts.length > 0 && (
        <section>
          <Card>
            <CardHeader
              title="Recent activity"
              actions={
                <Link href="/activity" className="text-[13px] font-medium text-brand-ink hover:underline">
                  See all
                </Link>
              }
            />
            <ul className="divide-y divide-line-2">
              {recent.map((a, i) => (
                <PurchaseRow key={a.id} attempt={a} fresh={i === 0} />
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
