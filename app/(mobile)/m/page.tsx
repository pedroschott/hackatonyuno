"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { effectiveStatus } from "@/lib/engine";
import { brl } from "@/lib/format";
import { Badge } from "@/components/ui";
import { PermissionCard } from "@/components/app/PermissionCard";
import { PurchaseRow } from "@/components/app/PurchaseRow";
import { agentLabel } from "@/components/app/agent-label";
import { storeName } from "@/lib/plain";

export default function MobileInbox() {
  const mandates = useStore((s) => s.mandates);
  const approvals = useStore((s) => s.approvals);
  const attempts = useStore((s) => s.attempts);
  const agents = useStore((s) => s.agents);
  const merchants = useStore((s) => s.merchants);

  const requests = mandates.filter((m) => m.status === "draft");
  const active = mandates.filter((m) => effectiveStatus(m) === "active");
  const waiting = approvals.filter((a) => a.status === "pending");
  const needs = requests.length + waiting.length;

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h1 className="text-[18px] font-semibold">Waiting for you</h1>
          {needs > 0 && <Badge tone="warn">{needs}</Badge>}
        </div>
        {needs === 0 && (
          <div className="rounded-lg bg-white px-4 py-5 text-center text-[13.5px] text-muted shadow-[var(--shadow-card)]">
            Nothing to decide right now.
          </div>
        )}
        <div className="space-y-2">
          {requests.map((m) => (
            <Link
              key={m.id}
              href={`/m/mandates/${m.id}`}
              className="ap-in flex items-center gap-3 rounded-lg border-l-[3px] border-l-brand bg-white px-4 py-3 shadow-[var(--shadow-card)] active:bg-canvas"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-semibold">{agentLabel(m, agents)} is asking to pay for you</div>
                <div className="truncate text-[13px] text-muted">Up to {brl(m.limits.per_purchase_cents)} per purchase</div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-faint" />
            </Link>
          ))}
          {waiting.map((a) => (
            <Link
              key={a.id}
              href={`/m/approvals/${a.id}`}
              className="ap-in flex items-center gap-3 rounded-lg border-l-[3px] border-l-warn bg-white px-4 py-3 shadow-[var(--shadow-card)] active:bg-canvas"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-semibold">Approve this purchase?</div>
                <div className="truncate text-[13px] text-muted">
                  {a.product_name} · {brl(a.amount_cents)} at {storeName(merchants, a.merchant_id)}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-faint" />
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[15px] font-semibold">Who can spend</h2>
        {active.length > 0 ? (
          active.map((m) => <PermissionCard key={m.id} mandate={m} />)
        ) : (
          <div className="rounded-lg bg-white px-4 py-5 text-center text-[13.5px] text-muted shadow-[var(--shadow-card)]">
            Nobody can spend your money right now.
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold">Recent activity</h2>
        <div className="rounded-lg bg-white shadow-[var(--shadow-card)]">
          {attempts.length === 0 ? (
            <div className="px-4 py-5 text-center text-[13.5px] text-muted">No purchases yet.</div>
          ) : (
            <ul className="divide-y divide-line-2">
              {attempts.slice(0, 8).map((a) => (
                <PurchaseRow key={a.id} attempt={a} explain />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
