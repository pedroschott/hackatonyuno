"use client";

import { ArrowRight, Building2, Plus, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { buttonClassName, Card, CardHeader, EmptyState } from "@/components/ui";
import { usd } from "@/lib/format";
import { developerApi } from "./client";
import { DeveloperPageHeader, LoadingPanel, MerchantRow, MetricCard, type MerchantSummary } from "./bits";

export function DeveloperOverview() {
  const [merchants, setMerchants] = useState<MerchantSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void developerApi<{ merchants: MerchantSummary[] }>("/api/developers/merchants")
      .then((result) => setMerchants(result.merchants))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load merchants"));
  }, []);

  const totalProducts = merchants?.reduce((sum, merchant) => sum + merchant.product_count, 0) ?? 0;
  const totalAttempts = merchants?.reduce((sum, merchant) => sum + merchant.attempt_count, 0) ?? 0;
  const volume = merchants?.reduce((sum, merchant) => sum + merchant.approved_volume_cents, 0) ?? 0;

  return (
    <>
      <DeveloperPageHeader
        eyebrow="Merchant console"
        title="Build and test agent payments"
        description="Register a stable merchant identity, publish a catalog, test signed checkout, then verify a live domain when you are ready."
        actions={
          <Link href="/developers/merchants/new" className={buttonClassName({ variant: "primary" })}>
            <Plus className="size-3.5" /> New merchant
          </Link>
        }
      />
      {error && <div className="mb-5 rounded-md bg-danger-soft px-4 py-3 text-[13px] text-danger-ink">{error}</div>}
      {!merchants ? <LoadingPanel /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Merchants" value={merchants.length} detail={`${merchants.filter((merchant) => merchant.agent_ready).length} agent-ready`} />
            <MetricCard label="Catalog products" value={totalProducts} detail="Across owned merchants" />
            <MetricCard label="Checkout attempts" value={totalAttempts} detail="Approved, refused, and escalated" />
            <MetricCard label="Test volume" value={usd(volume)} detail="Mock payment rail" />
          </div>
          <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,.7fr)]">
            <Card>
              <CardHeader title="Recent merchants" description="Your test and live integrations" actions={<Link href="/developers/merchants" className="text-[12px] font-medium text-brand-ink">View all</Link>} />
              {merchants.length ? merchants.slice(0, 5).map((merchant) => <MerchantRow key={merchant.id} merchant={merchant} compact />) : (
                <EmptyState title="Create your first merchant" description="Start with a hosted test store. AgentPay creates the ID, manifest, checkout route, and sample catalog." action={<Link href="/developers/merchants/new" className={buttonClassName({ variant: "primary" })}>Create merchant</Link>} />
              )}
            </Card>
            <div className="space-y-4">
              <Card className="bg-[#0a2540] px-5 py-5 text-white">
                <div className="flex size-9 items-center justify-center rounded-lg bg-white/10"><Building2 className="size-4" /></div>
                <h2 className="mt-4 text-[16px] font-semibold">End-to-end test mode</h2>
                <p className="mt-1 text-[12.5px] leading-5 text-white/65">Create a hosted catalog, give its merchant ID to an agent, approve the mandate, and watch the signed checkout decision appear here.</p>
                <Link href="/docs/quickstart" className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#a9a5ff]">Read the quickstart <ArrowRight className="size-3.5" /></Link>
              </Card>
              <Card className="px-5 py-5">
                <Store className="size-4 text-brand" />
                <h2 className="mt-3 text-[14px] font-semibold">Supported stores</h2>
                <p className="mt-1 text-[12.5px] leading-5 text-muted">Only verified live stores appear publicly. The list is intentionally empty until a real merchant completes verification.</p>
                <Link href="/developers/stores" className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-ink">Open store registry <ArrowRight className="size-3" /></Link>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
