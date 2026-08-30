"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { buttonClassName, Card, EmptyState } from "@/components/ui";
import { DeveloperPageHeader, LoadingPanel, MerchantRow, type MerchantSummary } from "./bits";
import { developerApi } from "./client";

export function MerchantList() {
  const [merchants, setMerchants] = useState<MerchantSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void developerApi<{ merchants: MerchantSummary[] }>("/api/developers/merchants")
      .then((result) => setMerchants(result.merchants))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load merchants"));
  }, []);

  return (
    <>
      <DeveloperPageHeader
        eyebrow="Developers"
        title="Merchants"
        description="Each merchant gets an immutable AgentPay ID and its own catalog, keys, endpoints, and checkout activity."
        actions={<Link href="/developers/merchants/new" className={buttonClassName({ variant: "primary" })}><Plus className="size-3.5" /> New merchant</Link>}
      />
      {error && <div className="mb-5 rounded-md bg-danger-soft px-4 py-3 text-[13px] text-danger-ink">{error}</div>}
      {!merchants ? <LoadingPanel /> : (
        <Card>
          {merchants.length ? merchants.map((merchant) => <MerchantRow key={merchant.id} merchant={merchant} />) : (
            <EmptyState title="No merchants yet" description="A hosted test store is the fastest way to exercise the full integration." action={<Link href="/developers/merchants/new" className={buttonClassName({ variant: "primary" })}>Create merchant</Link>} />
          )}
        </Card>
      )}
    </>
  );
}
