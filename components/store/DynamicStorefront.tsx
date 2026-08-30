"use client";

import { Bot, Box, Code2, ExternalLink, Search, ShieldCheck, ShoppingBag } from "lucide-react";
import { useState } from "react";

import { Mark } from "@/components/Logo";
import { CheckoutModal } from "@/components/store/CheckoutModal";
import { usd } from "@/lib/format";
import type { DeveloperMerchant, DeveloperProduct } from "@/lib/merchant-console";
import type { Product } from "@/lib/types";

export function DynamicStorefront({
  merchant,
  products,
}: {
  merchant: DeveloperMerchant;
  products: DeveloperProduct[];
}) {
  const [selected, setSelected] = useState<Product | null>(null);
  const uiProducts = products.map((product) => ({
    id: product.id,
    merchantId: product.merchant_id,
    name: product.name,
    description: product.description,
    category: product.category,
    priceCents: product.price_cents,
    sku: product.sku,
  } satisfies Product));

  return (
    <div className="min-h-dvh bg-white text-[#17212b]">
      <div className="bg-[#0a2540] px-4 py-2 text-white sm:px-6">
        <div className="mx-auto flex max-w-[1120px] items-center gap-2 text-[12px]">
          <Bot className="size-3.5 text-[#8b85ff]" /> Hosted AgentPay test store
          <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5">Merchant ID: {merchant.id}</span>
        </div>
      </div>
      <header className="border-b border-[#e7ebef]">
        <div className="mx-auto flex max-w-[1120px] items-center gap-5 px-4 py-4 sm:px-6">
          <div className="flex size-9 items-center justify-center rounded-lg bg-brand text-white">
            <ShoppingBag className="size-4.5" />
          </div>
          <div>
            <div className="text-[18px] font-bold tracking-tight">{merchant.name}</div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#697386]">{merchant.category}</div>
          </div>
          <div className="ml-auto hidden h-9 w-64 items-center gap-2 rounded-lg border border-[#dfe3e8] px-3 text-[12.5px] text-[#8792a2] sm:flex">
            <Search className="size-3.5" /> Search this test catalog
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1120px] px-4 py-8 sm:px-6">
        <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Agent-ready products</h1>
            <p className="mt-1 max-w-2xl text-[14px] text-[#697386]">
              {merchant.description ?? "A hosted catalog for testing AgentPay discovery, mandates, and verified checkout."}
            </p>
          </div>
          <a
            href={merchant.discovery_url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand hover:text-brand-hover"
          >
            <Code2 className="size-3.5" /> Discovery manifest <ExternalLink className="size-3" />
          </a>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {uiProducts.map((product) => (
            <article key={product.id} className="flex min-h-[290px] flex-col rounded-xl border border-[#e7ebef] p-5 shadow-[0_1px_2px_rgba(10,37,64,.04)]">
              <div className="flex h-28 items-center justify-center rounded-lg bg-[#f4f7fa] text-[#697386]">
                <Box className="size-12" strokeWidth={1.25} />
              </div>
              <div className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[#8792a2]">{product.category} · {product.sku}</div>
              <h2 className="mt-1 text-[16px] font-semibold">{product.name}</h2>
              <p className="mt-1 line-clamp-2 text-[12.5px] text-[#697386]">{product.description}</p>
              <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                <span className="text-[18px] font-semibold tabular">{usd(product.priceCents)}</span>
                <button
                  onClick={() => setSelected(product)}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-[12.5px] font-semibold text-white hover:bg-brand-hover"
                >
                  <Mark size={15} /> Pay with AgentPay
                </button>
              </div>
            </article>
          ))}
        </div>
        {!uiProducts.length && (
          <div className="rounded-xl border border-dashed border-[#d8dee6] px-6 py-16 text-center text-[13px] text-[#697386]">This test store has no active products yet.</div>
        )}
        <div className="mt-8 flex items-start gap-3 rounded-xl bg-[#f4f7fa] p-4 text-[12.5px] text-[#596579]">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
          Checkout verifies the signed agent request, passkey-authorized mandate, current registry status, nonce, merchant, category, amount, and usage policy before issuing a mock payment token.
        </div>
      </main>
      <CheckoutModal product={selected} open={selected !== null} onClose={() => setSelected(null)} merchantName={merchant.name} />
    </div>
  );
}
