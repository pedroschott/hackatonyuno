"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Ban, PauseCircle, FileSignature } from "lucide-react";
import { useStore, selectCurrentMandate, usageFor } from "@/lib/store";
import { effectiveStatus } from "@/lib/engine";
import { brl, relative, untilText } from "@/lib/format";
import { Badge, Button, Meter, Mono } from "@/components/ui";
import { AttemptRow } from "@/components/dashboard/AttemptFeed";
import { cn } from "@/lib/cn";

export default function MobileInbox() {
  const mandates = useStore((s) => s.mandates);
  const approvals = useStore((s) => s.approvals);
  const attempts = useStore((s) => s.attempts);
  const current = useStore(selectCurrentMandate);
  const revoke = useStore((s) => s.revokeMandate);
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const drafts = mandates.filter((m) => m.status === "draft");
  const pending = approvals.filter((a) => a.status === "pending");
  const needs = drafts.length + pending.length;
  const status = current ? effectiveStatus(current) : null;
  const usage = current ? usageFor({ attempts }, current.id) : null;

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h1 className="text-[18px] font-semibold">Needs you</h1>
          {needs > 0 && <Badge tone="warn">{needs}</Badge>}
        </div>
        {needs === 0 && <div className="rounded-lg bg-white px-4 py-5 text-center text-[13px] text-muted shadow-[var(--shadow-card)]">Nothing waiting. Your agent is inside its mandate.</div>}
        <div className="space-y-2">
          {drafts.map((m) => (
            <Link key={m.id} href={`/m/mandates/${m.id}`} className="ap-in flex items-center gap-3 rounded-lg border-l-[3px] border-l-brand bg-white px-4 py-3 shadow-[var(--shadow-card)] active:bg-canvas">
              <FileSignature className="size-5 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">Mandate request</div>
                <div className="truncate text-[12.5px] text-muted">
                  {m.origin?.requested_by ?? "Agent"} · up to {brl(m.limits.per_purchase_cents)} · {relative(m.created_at)}
                </div>
              </div>
              <ChevronRight className="size-4 text-faint" />
            </Link>
          ))}
          {pending.map((a) => (
            <Link key={a.id} href={`/m/approvals/${a.id}`} className="ap-in flex items-center gap-3 rounded-lg border-l-[3px] border-l-warn bg-white px-4 py-3 shadow-[var(--shadow-card)] active:bg-canvas">
              <PauseCircle className="size-5 shrink-0 text-warn" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">Over limit — approve?</div>
                <div className="truncate text-[12.5px] text-muted">
                  {a.product_name} · {brl(a.amount_cents)} · {relative(a.created_at)}
                </div>
              </div>
              <ChevronRight className="size-4 text-faint" />
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold">Active mandate</h2>
        {current && status && usage ? (
          <div className={cn("rounded-lg bg-white shadow-[var(--shadow-card)]", status === "revoked" && "shadow-[0_0_0_1px_var(--color-danger)]")}>
            <div className="flex items-center gap-2 px-4 py-3">
              <div className="flex size-8 items-center justify-center rounded-md bg-brand-soft text-[13px] font-semibold text-brand-ink">F</div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">FleetBuyer</div>
                <Mono>{current.id}</Mono>
              </div>
              {status === "active" && <Badge tone="success" dot>Active</Badge>}
              {status === "revoked" && <Badge tone="danger" dot>Revoked</Badge>}
              {status === "expired" && <Badge tone="warn" dot>Expired</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-line px-4 py-3 text-[13px]">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-faint">This month</div>
                <div className="font-semibold tabular">{brl(usage.spent)} <span className="font-normal text-muted">/ {brl(current.limits.cumulative_cents)}</span></div>
                <Meter value={usage.spent} max={current.limits.cumulative_cents} />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-faint">Uses</div>
                <div className="font-semibold tabular">{usage.uses} <span className="font-normal text-muted">/ {current.limits.max_uses}</span></div>
                <div className="text-[12px] text-muted">{untilText(current.validity.expires_at)}</div>
              </div>
            </div>
            <div className="border-t border-line px-4 py-3">
              {status === "active" && !confirming && (
                <Button variant="dangerSolid" size="lg" className="w-full" icon={<Ban className="size-4" />} onClick={() => setConfirming(true)}>
                  Revoke mandate
                </Button>
              )}
              {status === "active" && confirming && (
                <div className="ap-in space-y-2">
                  <p className="text-[13px] text-danger-ink">Every later purchase fails. This can’t be undone.</p>
                  <div className="flex gap-2">
                    <Button size="lg" className="flex-1" onClick={() => setConfirming(false)}>Cancel</Button>
                    <Button
                      size="lg"
                      variant="dangerSolid"
                      className="flex-1"
                      loading={revoking}
                      onClick={async () => {
                        setRevoking(true);
                        setRevokeError(null);
                        try {
                          await revoke(current.id, "user:cfo");
                          setConfirming(false);
                        } catch (cause) {
                          setRevokeError(cause instanceof Error ? cause.message : "Revocation failed");
                        } finally {
                          setRevoking(false);
                        }
                      }}
                    >
                      Revoke now
                    </Button>
                  </div>
                  {revokeError && <p className="text-[12px] text-danger-ink">{revokeError}</p>}
                </div>
              )}
              {status !== "active" && <p className="text-[13px] text-muted">No active mandate. Your agent can’t buy anything until you approve a new one.</p>}
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-white px-4 py-5 text-center text-[13px] text-muted shadow-[var(--shadow-card)]">No mandate yet.</div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold">Recent activity</h2>
        <div className="rounded-lg bg-white shadow-[var(--shadow-card)]">
          {attempts.length === 0 ? (
            <div className="px-4 py-5 text-center text-[13px] text-muted">No purchases yet.</div>
          ) : (
            <ul className="divide-y divide-line">
              {attempts.slice(0, 8).map((a) => (
                <AttemptRow key={a.id} attempt={a} compact />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
