"use client";

import { useState } from "react";
import { Check, X, PauseCircle, ChevronRight, Minus } from "lucide-react";
import type { Attempt, Check as CheckT } from "@/lib/types";
import { brl, timeShort } from "@/lib/format";
import { REASON_RULE } from "@/lib/policy";
import { Badge, Mono, EmptyState } from "../ui";
import { cn } from "@/lib/cn";

export function AttemptFeed({ attempts }: { attempts: Attempt[] }) {
  if (attempts.length === 0)
    return <EmptyState title="No attempts yet" description="Start the agent heartbeat or trigger one manually. Every decision shows up here in real time." />;
  return (
    <ul className="divide-y divide-line">
      {attempts.map((a, i) => (
        <AttemptRow key={a.id} attempt={a} fresh={i === 0} />
      ))}
    </ul>
  );
}

const ICON = {
  approved: { Icon: Check, cls: "bg-success-soft text-success" },
  refused: { Icon: X, cls: "bg-danger-soft text-danger" },
  escalated: { Icon: PauseCircle, cls: "bg-warn-soft text-warn" },
} as const;

export function AttemptRow({ attempt, fresh, compact }: { attempt: Attempt; fresh?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { Icon, cls } = ICON[attempt.decision];
  const source = attempt.request.scenario.split(":")[0];

  return (
    <li className={cn(fresh && "ap-in")}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-canvas">
        <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", cls)}>
          <Icon className="size-3.5" strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium">{attempt.product_name}</span>
            <span className="ml-auto shrink-0 text-[13px] tabular text-ink-2">{brl(attempt.amount_cents)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            {attempt.decision === "approved" && (
              <>
                <Badge tone="success">APPROVED</Badge>
                {attempt.exception_id && <Badge tone="warn">exception: true</Badge>}
                {attempt.payment_token && <Mono>{attempt.payment_token.token}</Mono>}
              </>
            )}
            {attempt.decision === "refused" && attempt.reason_code && (
              <Badge tone="danger">
                <span className="opacity-60">#{REASON_RULE[attempt.reason_code]}</span> {attempt.reason_code}
              </Badge>
            )}
            {attempt.decision === "escalated" && <Badge tone="warn">ESCALATED · awaiting human</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-faint">
            {!compact && <span>{source}</span>}
            <span className="ml-auto tabular">{timeShort(attempt.created_at)}</span>
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </div>
        </div>
      </button>
      {open && (
        <div className="ap-in border-t border-line-2 bg-canvas px-4 py-3">
          <ChecksList checks={attempt.checks} />
          <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[11.5px] text-muted sm:grid-cols-2">
            <span>attempt <Mono>{attempt.id}</Mono></span>
            <span>mandate <Mono>{attempt.mandate_id ?? "—"}</Mono></span>
            <span>nonce <Mono>{attempt.request.nonce}</Mono></span>
            <span>signed <Mono>{String(attempt.request.signed)}</Mono></span>
          </div>
          {attempt.payment_token && (
            <pre className="mt-2 overflow-auto rounded bg-white p-2 font-mono text-[11px] leading-relaxed text-ink-2 shadow-[var(--shadow-card)]">
              {JSON.stringify(attempt.payment_token, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

export function ChecksList({ checks, animateUpTo }: { checks: CheckT[]; animateUpTo?: number }) {
  return (
    <ol className="space-y-1">
      {checks.map((c, i) => {
        const shown = animateUpTo === undefined || i < animateUpTo;
        const pending = animateUpTo !== undefined && i === animateUpTo;
        return (
          <li key={c.id} className={cn("flex items-start gap-2 text-[12.5px]", !shown && !pending && "opacity-30")}>
            <span
              className={cn(
                "mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full",
                !shown && "bg-line",
                shown && c.status === "pass" && "bg-success text-white",
                shown && c.status === "fail" && "bg-danger text-white",
                shown && c.status === "skip" && "bg-line text-muted",
                pending && "animate-pulse bg-brand",
              )}
            >
              {shown && c.status === "pass" && <Check className="size-2.5" strokeWidth={3} />}
              {shown && c.status === "fail" && <X className="size-2.5" strokeWidth={3} />}
              {shown && c.status === "skip" && <Minus className="size-2.5" strokeWidth={3} />}
            </span>
            <span className={cn("font-medium", shown && c.status === "fail" ? "text-danger-ink" : "text-ink")}>{c.label}</span>
            {shown && c.detail && <span className="text-muted">— {c.detail}</span>}
            {shown && c.status === "skip" && <span className="text-faint">skipped</span>}
          </li>
        );
      })}
    </ol>
  );
}
