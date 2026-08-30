import Link from "next/link";
import type { ReactNode } from "react";

import { Badge, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { merchantTone, type DeveloperMerchant } from "@/lib/merchant-console";

export type MerchantSummary = DeveloperMerchant & {
  product_count: number;
  attempt_count: number;
  approved_volume_cents: number;
};

export function DeveloperPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-ink">{eyebrow}</div>}
        <h1 className="text-[25px] font-semibold tracking-[-0.02em] text-[#0a2540] sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] leading-5 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function MetricCard({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="mt-1 text-[25px] font-semibold tracking-[-0.02em] text-[#0a2540] tabular">{value}</div>
      {detail && <div className="mt-0.5 text-[11.5px] text-muted">{detail}</div>}
    </Card>
  );
}

export function MerchantRow({ merchant, compact = false }: { merchant: MerchantSummary; compact?: boolean }) {
  return (
    <Link
      href={`/developers/merchants/${merchant.id}`}
      className={cn(
        "grid items-center gap-3 border-b border-line px-5 py-4 last:border-b-0 hover:bg-[#fafbfc]",
        compact ? "sm:grid-cols-[1fr_auto]" : "sm:grid-cols-[minmax(0,1.5fr)_110px_90px_90px]",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-[#0a2540]">{merchant.name}</span>
          <Badge tone={merchantTone(merchant.verification_status)} dot>{merchant.verification_status}</Badge>
          <Badge tone={merchant.environment === "test" ? "brand" : "neutral"}>{merchant.environment}</Badge>
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-faint">{merchant.id}</div>
      </div>
      {!compact && (
        <>
          <div className="text-[12.5px] text-muted"><span className="font-semibold text-ink">{merchant.product_count}</span> products</div>
          <div className="text-[12.5px] text-muted"><span className="font-semibold text-ink">{merchant.attempt_count}</span> attempts</div>
          <div className="text-right text-[12px] font-medium text-brand-ink">Open →</div>
        </>
      )}
      {compact && <span className="text-[12px] font-medium text-brand-ink">Open →</span>}
    </Link>
  );
}

export function LoadingPanel() {
  return <div className="h-48 animate-pulse rounded-lg bg-white shadow-[var(--shadow-card)]" />;
}
