"use client";

import { ExternalLink, Globe2, Store } from "lucide-react";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/docs/CopyButton";
import { Card, EmptyState } from "@/components/ui";
import type { SupportedStore } from "@/lib/merchant-console";
import { DeveloperPageHeader, LoadingPanel } from "./bits";
import { developerApi } from "./client";

export function SupportedStores() {
  const [stores, setStores] = useState<SupportedStore[] | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void developerApi<{ stores: SupportedStore[]; note: string }>("/api/stores")
      .then((result) => { setStores(result.stores); setNote(result.note); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load supported stores"));
  }, []);
  return (
    <>
      <DeveloperPageHeader eyebrow="Public registry" title="Supported stores" description="Verified live stores that agents can research through ordinary search and a store-owned AgentPay discovery URL." />
      <Card className="mb-5 px-5 py-4">
        <div className="flex items-start gap-3 text-[12.5px] text-muted"><Globe2 className="mt-0.5 size-4 shrink-0 text-brand" /><div><span className="font-semibold text-ink">Public API</span><div className="mt-0.5">The machine-readable list is available at <code className="rounded bg-line-2 px-1.5 py-0.5 text-[11px] text-ink">/api/stores</code>. AgentPay still does not ingest merchant catalogs or rank products.</div></div></div>
      </Card>
      {error && <div className="mb-5 rounded-md bg-danger-soft px-4 py-3 text-[13px] text-danger-ink">{error}</div>}
      {!stores ? <LoadingPanel /> : stores.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{stores.map((store) => <Card key={store.id} className="p-5"><div className="flex size-9 items-center justify-center rounded-lg bg-success-soft text-success-ink"><Store className="size-4" /></div><h2 className="mt-4 text-[15px] font-semibold">{store.name}</h2><div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-faint">{store.category}</div><p className="mt-3 text-[12.5px] leading-5 text-muted">{store.description ?? "Verified AgentPay merchant"}</p><div className="mt-4 flex items-center gap-2 border-t border-line pt-3"><a href={store.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-ink">Open store <ExternalLink className="size-3" /></a><CopyButton value={store.discovery_url} className="ml-auto text-muted hover:bg-line-2 hover:text-ink" /></div></Card>)}</div>
      ) : (
        <Card><EmptyState title="No public stores yet" description={note || "No merchant has completed live-domain verification and opted into the public supported-store list."} /></Card>
      )}
    </>
  );
}
