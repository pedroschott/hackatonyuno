"use client";

import { ArrowLeft, Building2, Globe2, Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonClassName, Card, Field, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { DeveloperMerchant } from "@/lib/merchant-console";
import { DeveloperPageHeader } from "./bits";
import { developerApi } from "./client";

export function NewMerchantForm() {
  const router = useRouter();
  const [kind, setKind] = useState<"hosted" | "external">("hosted");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await developerApi<{ merchant: DeveloperMerchant }>("/api/developers/merchants", {
        method: "POST",
        body: JSON.stringify({ kind, name, category, ...(description ? { description } : {}), ...(kind === "external" ? { website_url: websiteUrl } : {}) }),
      });
      router.push(`/developers/merchants/${result.merchant.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create merchant");
      setBusy(false);
    }
  }

  return (
    <>
      <Link href="/developers/merchants" className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> Merchants</Link>
      <DeveloperPageHeader eyebrow="Onboarding" title="Create a merchant" description="Start in a hosted test environment or register an existing HTTPS store for live verification." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-[15px] font-semibold">Integration type</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">The merchant ID is permanent after creation.</p>
          </div>
          <div className="space-y-5 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                { value: "hosted" as const, icon: Store, title: "Hosted test store", text: "AgentPay hosts the catalog, manifest, and checkout so you can test immediately." },
                { value: "external" as const, icon: Globe2, title: "Existing live store", text: "Use your own domain, publish the manifest, then run domain verification." },
              ]).map((option) => (
                <button key={option.value} type="button" onClick={() => setKind(option.value)} className={cn("rounded-lg border p-4 text-left transition-colors", kind === option.value ? "border-brand bg-brand-soft/50 shadow-[var(--shadow-focus)]" : "border-line bg-white hover:border-[#cbd3dc]")}>
                  <option.icon className={cn("size-5", kind === option.value ? "text-brand" : "text-muted")} />
                  <div className="mt-3 text-[13.5px] font-semibold">{option.title}</div>
                  <div className="mt-1 text-[12px] leading-4.5 text-muted">{option.text}</div>
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Store" /></Field>
              <Field label="Primary category" hint="Used as the sample product category."><Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="office-supplies" /></Field>
            </div>
            <Field label="Description" hint="Optional. Shown on the hosted storefront and supported-store listing."><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Agent-ready supplies for distributed teams" /></Field>
            {kind === "external" && <Field label="Store URL" hint="A public HTTPS origin. AgentPay will check /.well-known/agentpay.json."><Input type="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://store.example.com" /></Field>}
            {error && <div className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger-ink">{error}</div>}
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <Link href="/developers/merchants" className={buttonClassName()}>Cancel</Link>
              <Button variant="primary" loading={busy} disabled={!name.trim() || !category.trim() || (kind === "external" && !websiteUrl)} onClick={submit}>Create merchant</Button>
            </div>
          </div>
        </Card>
        <Card className="h-fit px-5 py-5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand"><Building2 className="size-4" /></div>
          <h2 className="mt-4 text-[14px] font-semibold">What AgentPay creates</h2>
          <ul className="mt-3 space-y-2.5 text-[12.5px] leading-4.5 text-muted">
            <li>• Immutable merchant ID for mandate allowlists</li>
            <li>• Discovery and checkout configuration</li>
            <li>• Product catalog and server-side API keys</li>
            <li>• Checkout decisions and mock payment activity</li>
            <li>• Verification state for public store support</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
