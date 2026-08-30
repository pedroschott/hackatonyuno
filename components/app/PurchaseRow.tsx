"use client";

import { Check, X, Clock, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { Attempt } from "@/lib/types";
import { useStore } from "@/lib/store";
import { usd } from "@/lib/format";
import { DISPUTE_STATUS_LABELS, disputeTone } from "@/lib/disputes";
import { outcomeOf, storeName, timeOfDay } from "@/lib/plain";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui";
import { PurchaseTrail } from "./PurchaseTrail";

const ICON = {
  success: { Icon: Check, cls: "bg-success-soft text-success" },
  danger: { Icon: X, cls: "bg-danger-soft text-danger" },
  warn: { Icon: Clock, cls: "bg-warn-soft text-warn" },
} as const;

/**
 * One line of history: what, where, how much, and what happened — nothing else.
 * `explain` adds the single sentence that says why a purchase did not go through.
 *
 * The whole row is a button, because the summary is never the whole answer: the
 * trail behind it holds the verifications, the mandate, the delivery and the
 * hash-chained log entries for this one charge.
 */
export function PurchaseRow({ attempt, fresh, explain }: { attempt: Attempt; fresh?: boolean; explain?: boolean }) {
  const merchants = useStore((s) => s.merchants);
  const dispute = useStore((s) => s.disputes.find((candidate) => candidate.attempt_id === attempt.id));
  const [open, setOpen] = useState(false);
  const outcome = outcomeOf(attempt);
  const { Icon, cls } = ICON[outcome.tone];

  return (
    <li className={cn(fresh && "ap-in")}>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Open the purchase trail for ${attempt.product_name}`}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas sm:px-5"
      >
        <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", cls)}>
          <Icon className="size-4" strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-ink">{attempt.product_name}</div>
          <div className="truncate text-[13px] text-muted">
            {storeName(merchants, attempt.merchant_id)} · {timeOfDay(attempt.created_at)}
          </div>
          {explain && outcome.tone !== "success" && <div className="mt-0.5 text-[13px] text-muted">{outcome.detail}</div>}
          {dispute && (
            <div className="mt-1">
              <Badge tone={disputeTone(dispute.status)} dot>
                {DISPUTE_STATUS_LABELS[dispute.status]}
              </Badge>
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div
            className={cn(
              "text-[14px] font-semibold tabular",
              outcome.tone === "success" ? "text-ink" : "text-muted line-through",
            )}
          >
            {usd(attempt.amount_cents)}
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
        <ChevronRight className="mt-2 size-4 shrink-0 text-faint" />
      </button>
      {open && <PurchaseTrail attempt={attempt} onClose={() => setOpen(false)} />}
    </li>
  );
}
