"use client";

import { useMemo, useState } from "react";
import { ShieldCheck, ShieldAlert, Link2, Download, ChevronRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { verifyChain } from "@/lib/seed";
import { timeShort } from "@/lib/format";
import { PageHeader } from "@/components/AppShell";
import { Badge, Button, Card, Mono, Select, EmptyState } from "@/components/ui";
import { cn } from "@/lib/cn";

const ACTOR_TONE = (actor: string): "brand" | "success" | "warn" | "neutral" | "danger" =>
  actor.startsWith("user") ? "brand" : actor.startsWith("merchant") ? "success" : actor === "judge" ? "warn" : actor.startsWith("agent") ? "danger" : "neutral";

const ACTION_TONE = (action: string): "success" | "danger" | "warn" | "neutral" | "brand" =>
  action.endsWith(".approved") || action.endsWith(".activated") || action.endsWith("token_minted")
    ? "success"
    : action.endsWith(".refused") || action.endsWith(".revoked") || action.endsWith(".denied")
      ? "danger"
      : action.endsWith(".escalated") || action.endsWith(".requested") || action.endsWith("limits_updated")
        ? "warn"
        : "neutral";

export default function AuditPage() {
  const audit = useStore((s) => s.audit);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<number | null>(null);
  const [verified, setVerified] = useState<{ ok: boolean; brokenAt?: number } | null>(null);

  const actors = useMemo(() => Array.from(new Set(audit.map((e) => e.actor))), [audit]);
  const rows = useMemo(() => [...audit].reverse().filter((e) => filter === "all" || e.actor === filter), [audit, filter]);
  const chain = useMemo(() => verifyChain(audit), [audit]);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Hash-chained. Every decision is a signed record that human, merchant and auditor read the same way."
        actions={
          <>
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-44">
              <option value="all">All actors</option>
              {actors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
            <Button
              icon={<Link2 className="size-3.5" />}
              onClick={() => {
                setVerified(verifyChain(audit));
                setTimeout(() => setVerified(null), 2500);
              }}
            >
              Verify chain
            </Button>
            <Button
              icon={<Download className="size-3.5" />}
              onClick={() => {
                const blob = new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "agentpay-audit.json";
                a.click();
              }}
            >
              Export
            </Button>
          </>
        }
      />

      <div className={cn("mb-4 flex items-center gap-2 rounded-md px-4 py-2.5 text-[13px]", chain.ok ? "bg-success-soft text-success-ink" : "bg-danger-soft text-danger-ink", verified && "ap-in")}>
        {chain.ok ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
        {chain.ok ? (
          <>
            Chain intact · {audit.length} entries · head <Mono className="bg-white/60 text-success-ink">{audit[audit.length - 1]?.hash.slice(0, 16)}…</Mono>
          </>
        ) : (
          <>Chain broken at seq {chain.brokenAt}</>
        )}
        {verified && <span className="ml-auto font-medium">{verified.ok ? "Re-verified just now ✓" : "Verification failed"}</span>}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No entries" />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] font-medium uppercase tracking-wide text-faint">
                <th className="w-12 px-4 py-2.5">#</th>
                <th className="w-24 px-2 py-2.5">Time</th>
                <th className="w-40 px-2 py-2.5">Actor</th>
                <th className="px-2 py-2.5">Action</th>
                <th className="w-32 px-2 py-2.5">Entity</th>
                <th className="w-60 px-2 py-2.5">Hash</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {rows.map((e) => (
                <Row key={e.seq} entry={e} open={open === e.seq} onToggle={() => setOpen(open === e.seq ? null : e.seq)} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function Row({ entry: e, open, onToggle }: { entry: ReturnType<typeof useStore.getState>["audit"][number]; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-canvas">
        <td className="px-4 py-2.5 text-muted tabular">{e.seq}</td>
        <td className="px-2 py-2.5 text-muted tabular">{timeShort(e.ts)}</td>
        <td className="px-2 py-2.5">
          <Badge tone={ACTOR_TONE(e.actor)}>{e.actor}</Badge>
        </td>
        <td className="px-2 py-2.5">
          <Badge tone={ACTION_TONE(e.action)} className="font-mono">
            {e.action}
          </Badge>
        </td>
        <td className="px-2 py-2.5">
          <Mono>{e.entity}</Mono>
        </td>
        <td className="px-2 py-2.5">
          <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-muted">
            <span className="text-faint">{e.prev_hash.slice(0, 6)}</span>
            <Link2 className="size-3 text-faint" />
            <span className="text-ink-2">{e.hash.slice(0, 12)}</span>
          </span>
        </td>
        <td className="pr-3">
          <ChevronRight className={cn("size-3.5 text-faint transition-transform", open && "rotate-90")} />
        </td>
      </tr>
      {open && (
        <tr className="bg-canvas">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid grid-cols-[1fr_260px] gap-4">
              <pre className="overflow-auto rounded bg-white p-3 font-mono text-[11.5px] leading-relaxed text-ink-2 shadow-[var(--shadow-card)]">{JSON.stringify(e.payload, null, 2)}</pre>
              <div className="space-y-2 text-[11.5px] text-muted">
                <div>
                  <div className="text-faint">prev_hash</div>
                  <div className="break-all font-mono text-ink-2">{e.prev_hash}</div>
                </div>
                <div>
                  <div className="text-faint">hash = sha256(prev_hash ‖ canonical_json(entry))</div>
                  <div className="break-all font-mono text-ink-2">{e.hash}</div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
