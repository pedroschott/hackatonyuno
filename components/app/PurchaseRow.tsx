"use client";

import { Check, X, Clock } from "lucide-react";
import type { Attempt } from "@/lib/types";
import { useStore } from "@/lib/store";
import { brl } from "@/lib/format";
import { outcomeOf, storeName, timeOfDay } from "@/lib/plain";
import { cn } from "@/lib/cn";

const ICON = {
  success: { Icon: Check, cls: "bg-success-soft text-success" },
  danger: { Icon: X, cls: "bg-danger-soft text-danger" },
  warn: { Icon: Clock, cls: "bg-warn-soft text-warn" },
} as const;

/**
 * One line of history: what, where, how much, and what happened — nothing else.
 * `explain` adds the single sentence that says why a purchase did not go through.
 */
export function PurchaseRow({ attempt, fresh, explain }: { attempt: Attempt; fresh?: boolean; explain?: boolean }) {
  const merchants = useStore((s) => s.merchants);
  const outcome = outcomeOf(attempt);
  const { Icon, cls } = ICON[outcome.tone];

  return (
    <li className={cn("flex items-start gap-3 px-4 py-3 sm:px-5", fresh && "ap-in")}>
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", cls)}>
        <Icon className="size-4" strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-ink">{attempt.product_name}</div>
        <div className="truncate text-[13px] text-muted">
          {storeName(merchants, attempt.merchant_id)} · {timeOfDay(attempt.created_at)}
        </div>
        {explain && outcome.tone !== "success" && <div className="mt-0.5 text-[13px] text-muted">{outcome.detail}</div>}
      </div>
      <div className="shrink-0 text-right">
        <div
          className={cn(
            "text-[14px] font-semibold tabular",
            outcome.tone === "success" ? "text-ink" : "text-muted line-through",
          )}
        >
          {brl(attempt.amount_cents)}
        </div>
        <div
          className={cn(
            "text-[12.5px]",
            outcome.tone === "success" && "text-success-ink",
            outcome.tone === "danger" && "text-danger-ink",
            outcome.tone === "warn" && "text-warn-ink",
          )}
        >
          {outcome.label}
        </div>
      </div>
    </li>
  );
}
