"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useStore } from "@/lib/store";
import { effectiveStatus, sameMonth } from "@/lib/engine";
import { usd } from "@/lib/format";
import { Button, Card, CardHeader, EmptyState } from "@/components/ui";
import { MandateCard } from "@/components/app/MandateCard";
import { RequestCard } from "@/components/app/RequestCard";
import { ApprovalCard } from "@/components/app/ApprovalCard";
import { PurchaseRow } from "@/components/app/PurchaseRow";

export default function SummaryPage() {
  const mandates = useStore((s) => s.mandates);
  const attempts = useStore((s) => s.attempts);
  const approvals = useStore((s) => s.approvals);
  const [revoked, setRevoked] = useState(false);

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
        <div className="text-[13.5px] text-muted">Charged under your mandates this month</div>
        <div className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.02em] tabular sm:text-[40px]">
          {usd(spent)}
        </div>
        <div className="mt-2 text-[13.5px] text-muted">
          {active.length === 0
            ? "No active mandate. Nothing can be charged to your cards."
            : `${usd(Math.max(0, allowance - spent))} left across ${active.length} active ${
                active.length === 1 ? "mandate" : "mandates"
              }.`}
        </div>
      </section>

      {revoked && active.length === 0 && (
        <div className="ap-in flex items-start gap-2.5 rounded-lg bg-success-soft px-4 py-3 text-[13.5px] text-success-ink">
          <ShieldCheck className="mt-px size-4 shrink-0" />
          <span>
            No mandate is active. Every checkout presented from now on is refused at the registry.
          </span>
        </div>
      )}

      {(requests.length > 0 || waiting.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-[16px] font-semibold">Waiting for your signature</h2>
          {requests.map((m) => (
            <RequestCard key={m.id} mandate={m} />
          ))}
          {waiting.map((a) => (
            <ApprovalCard key={a.id} approval={a} mandate={mandateFor(a.merchant_id)} />
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-[16px] font-semibold">Active mandates</h2>
        {active.length > 0 ? (
          active.map((m) => <MandateCard key={m.id} mandate={m} onRevoked={() => setRevoked(true)} />)
        ) : (
          <Card>
            <EmptyState
              title="No active mandates"
              description="A mandate is a signed authorization on your own card: a scope, limits and an expiry an agent has to stay inside. Connect an agent and ask it to buy something — it requests a mandate here, and nothing can be charged until you sign it."
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
