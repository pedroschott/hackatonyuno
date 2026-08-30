"use client";

import { Check, X, Minus } from "lucide-react";
import type { Check as CheckT } from "@/lib/types";
import { cn } from "@/lib/cn";

/**
 * The merchant-side view of the four checks. This is the one place that still speaks
 * protocol: the store integrator is the audience, not the account holder.
 */
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
