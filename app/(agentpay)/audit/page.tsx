"use client";

import { useMemo, useState } from "react";
import { ShieldCheck, ShieldAlert, Download, ChevronRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { verifyChain } from "@/lib/seed";
import { auditSentence, dayLabel, timeOfDay } from "@/lib/plain";
import { PageHeader } from "@/components/AppShell";
import { Button, Card, EmptyState } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AuditEntry } from "@/lib/types";

/**
 * Everything that ever happened on the account, newest first. The plain sentence is
 * for the account holder; the technical record underneath is for anyone who wants to
 * check that the history has not been edited.
 */
export default function SecurityLogPage() {
  const audit = useStore((s) => s.audit);
  const [open, setOpen] = useState<number | null>(null);
  const [rechecked, setRechecked] = useState<{ ok: boolean } | null>(null);

  const chain = useMemo(() => verifyChain(audit), [audit]);
  const rows = useMemo(() => [...audit].reverse(), [audit]);

  return (
    <>
      <PageHeader
        title="Security log"
        description="Every decision on your account, in order, in a record that cannot be edited after the fact."
        actions={
          <>
            <Button
              onClick={() => {
                setRechecked(verifyChain(audit));
                setTimeout(() => setRechecked(null), 2500);
              }}
            >
              Check for tampering
            </Button>
            <Button
              icon={<Download className="size-3.5" />}
              onClick={() => {
                const blob = new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "agentpay-security-log.json";
                a.click();
              }}
            >
              Download
            </Button>
          </>
        }
      />

      <div
        className={cn(
          "mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-4 py-2.5 text-[13.5px]",
          chain.ok ? "bg-success-soft text-success-ink" : "bg-danger-soft text-danger-ink",
          rechecked && "ap-in",
        )}
      >
        {chain.ok ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
        {chain.ok ? `Nothing has been changed. ${audit.length} events.` : `Something was changed at event ${chain.brokenAt}.`}
        {rechecked && <span className="font-medium sm:ml-auto">{rechecked.ok ? "Checked just now ✓" : "Check failed"}</span>}
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="Nothing yet" description="Requests, approvals and purchases all show up here." />
        ) : (
          <ul className="divide-y divide-line-2">
            {rows.map((entry) => (
              <Row key={entry.seq} entry={entry} open={open === entry.seq} onToggle={() => setOpen(open === entry.seq ? null : entry.seq)} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Row({ entry, open, onToggle }: { entry: AuditEntry; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] text-ink">{auditSentence(entry.action)}</div>
          <div className="text-[12.5px] text-muted">
            {dayLabel(entry.ts)} at {timeOfDay(entry.ts)}
          </div>
        </div>
        <ChevronRight className={cn("size-4 shrink-0 text-faint transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="ap-in border-t border-line-2 bg-canvas px-4 py-3 sm:px-5">
          <pre className="overflow-auto rounded bg-white p-3 font-mono text-[11.5px] leading-relaxed text-ink-2 shadow-[var(--shadow-card)]">
            {JSON.stringify({ seq: entry.seq, actor: entry.actor, action: entry.action, entity: entry.entity, payload: entry.payload }, null, 2)}
          </pre>
          <div className="mt-2 break-all font-mono text-[11px] text-faint">
            {entry.prev_hash.slice(0, 12)}… → {entry.hash.slice(0, 12)}…
          </div>
        </div>
      )}
    </li>
  );
}
