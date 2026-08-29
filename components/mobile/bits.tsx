"use client";

import { cn } from "@/lib/cn";

export function KV({ rows, className }: { rows: { k: string; v: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line rounded-lg bg-white shadow-[var(--shadow-card)]", className)}>
      {rows.map((r) => (
        <div key={r.k} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-[14px]">
          <dt className="shrink-0 text-muted">{r.k}</dt>
          <dd className="text-right font-medium text-ink">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StickyActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-4 mt-auto border-t border-line bg-white/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export function Status({ tone, title, body }: { tone: "success" | "danger" | "warn" | "neutral"; title: string; body?: React.ReactNode }) {
  const cls = { success: "bg-success-soft text-success-ink", danger: "bg-danger-soft text-danger-ink", warn: "bg-warn-soft text-warn-ink", neutral: "bg-line-2 text-ink-2" }[tone];
  return (
    <div className={cn("ap-in rounded-lg px-4 py-3", cls)}>
      <div className="text-[15px] font-semibold">{title}</div>
      {body && <div className="mt-0.5 text-[13px] opacity-90">{body}</div>}
    </div>
  );
}
