"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Plus } from "lucide-react";
import { useStore, selectCurrentMandate } from "@/lib/store";
import { PageHeader } from "@/components/AppShell";
import { Button, Card, CardHeader, EmptyState, Badge, Mono } from "@/components/ui";
import { MandateCard } from "@/components/dashboard/MandateCard";
import { ApprovalCard, DecidedApprovalRow } from "@/components/dashboard/ApprovalCard";
import { AttemptFeed } from "@/components/dashboard/AttemptFeed";
import { AgentPanel } from "@/components/dashboard/AgentPanel";
import { PendingDraftCard, PhoneQrButton } from "@/components/dashboard/PendingDraftCard";
import { timeShort } from "@/lib/format";

export default function DashboardPage() {
  const mandate = useStore(selectCurrentMandate);
  const mandates = useStore((s) => s.mandates);
  const cards = useStore((s) => s.cards);
  const attempts = useStore((s) => s.attempts);
  const approvals = useStore((s) => s.approvals);
  const pending = useMemo(() => approvals.filter((a) => a.status === "pending"), [approvals]);
  const actor = useStore((s) => s.actor);

  const card = mandate ? cards.find((c) => c.id === mandate.payment.vault_card_id) : undefined;
  const decided = approvals.filter((a) => a.status !== "pending").slice(0, 5);
  const drafts = mandates.filter((m) => m.status === "draft");
  const others = mandates.filter((m) => m.id !== mandate?.id && m.status !== "draft");

  return (
    <>
      <PageHeader
        title="Mandates"
        description="What your agent may buy — and the button that stops it."
        actions={
          <>
            <PhoneQrButton />
            <Link href="/contracts/new">
              <Button variant="primary" icon={<Plus className="size-4" />}>New contract</Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-6">
        {/* Left */}
        <div className="space-y-6">
          {drafts.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold">Awaiting your approval</h2>
                <Badge tone="brand">{drafts.length}</Badge>
              </div>
              {drafts.map((m) => (
                <PendingDraftCard key={m.id} mandate={m} />
              ))}
            </section>
          )}
          {mandate ? (
            <MandateCard mandate={mandate} card={card} actor={actor} />
          ) : (
            <Card>
              <EmptyState
                title="No mandate"
                description="Create a contract so FleetBuyer has something to shop with."
                action={
                  <Link href="/contracts/new">
                    <Button variant="primary">Create contract</Button>
                  </Link>
                }
              />
            </Card>
          )}

          {(pending.length > 0 || decided.length > 0) && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold">Pending approvals</h2>
                {pending.length > 0 && <Badge tone="warn">{pending.length}</Badge>}
              </div>
              {pending.map((a) => (
                <ApprovalCard key={a.id} approval={a} mandate={mandate} actor={actor} />
              ))}
              {pending.length === 0 && <p className="text-[13px] text-muted">Nothing waiting on you.</p>}
              {decided.length > 0 && (
                <Card className="divide-y divide-line-2">
                  {decided.map((a) => (
                    <DecidedApprovalRow key={a.id} approval={a} />
                  ))}
                </Card>
              )}
            </section>
          )}

          {others.length > 0 && (
            <Card>
              <CardHeader title="Previous mandates" />
              <ul className="divide-y divide-line-2">
                {others.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]">
                    <Mono>{m.id}</Mono>
                    <span className="text-muted">{m.scope.categories.join(", ")} · {m.scope.merchants.length} merchant</span>
                    <span className="text-muted sm:ml-auto">{timeShort(m.created_at)}</span>
                    {m.status === "revoked" && <Badge tone="danger">revoked</Badge>}
                    {m.status === "active" && <Badge tone="neutral">superseded</Badge>}
                    {m.status === "declined" && <Badge tone="danger">declined</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* Right */}
        <div className="space-y-4">
          <AgentPanel />
          <Card>
            <CardHeader
              title="Live attempts"
              description="Every checkout decision, as the merchant sees it."
              actions={<span className="text-[12px] text-muted tabular">{attempts.length}</span>}
              className="px-4 py-3"
            />
            <div className="max-h-[420px] overflow-y-auto xl:max-h-[calc(100vh-380px)]">
              <AttemptFeed attempts={attempts.slice(0, 60)} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
