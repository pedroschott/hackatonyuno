"use client";

import { useMemo, useState } from "react";
import { Search, ShoppingCart, Truck, ShieldCheck, Disc3, Wrench } from "lucide-react";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/components/StoreProvider";
import type { Product } from "@/lib/types";
import { usd } from "@/lib/format";
import { Mark } from "@/components/Logo";
import { CheckoutModal } from "@/components/store/CheckoutModal";
import { cn } from "@/lib/cn";

export default function StorePage() {
  const hydrated = useHydrated();
  const allProducts = useStore((s) => s.products);
  const products = useMemo(() => allProducts.filter((p) => p.merchantId === "mrc_autoparts"), [allProducts]);
  const [selected, setSelected] = useState<Product | null>(null);

  return (
    <div className="min-h-screen bg-white text-[#111]">
      {/* Merchant header */}
      <div className="border-b border-[#eee] bg-[#111] text-[12px] text-white/80">
        <div className="mx-auto flex max-w-[1100px] items-center gap-4 px-4 py-1.5 sm:px-6">
          <span className="hidden items-center gap-1.5 sm:inline-flex"><Truck className="size-3.5" /> Free fleet delivery over $1,000</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 sm:ml-auto">
            <Mark size={14} /> Agent-ready · accepts AgentPay mandates
          </span>
        </div>
      </div>
      <header className="border-b border-[#eee]">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6 lg:gap-8">
          <a href="/store" className="text-[20px] font-bold tracking-tight">
            Auto<span className="text-[#e8451c]">Parts</span>
          </a>
          <nav className="hidden gap-5 text-[14px] text-[#444] md:flex">
            <a className="text-[#111] font-medium" href="#">Tires</a>
            <a href="#">Accessories</a>
            <a href="#">Fleet</a>
            <a href="#">B2B</a>
          </nav>
          <button className="relative ml-auto rounded-full p-2 hover:bg-[#f4f4f4] md:order-last">
            <ShoppingCart className="size-5" />
          </button>
          <div className="order-last flex h-9 w-full items-center gap-2 rounded-full border border-[#ddd] px-3 text-[13px] text-[#888] md:order-none md:ml-auto md:w-72">
            <Search className="size-4 shrink-0" /> Search parts, SKUs…
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight sm:text-[26px]">Tires &amp; fleet essentials</h1>
            <p className="mt-1 text-[14px] text-[#666]">Fleet-grade sets with same-day dispatch. Procurement agents welcome.</p>
          </div>
          <div className="text-[13px] text-[#666]">{products.length} products</div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
          {hydrated &&
            products.map((p) => (
              <article key={p.id} className="flex flex-col gap-4 rounded-xl border border-[#eee] p-4 transition-shadow hover:shadow-[0_4px_20px_rgba(0,0,0,.06)] sm:flex-row sm:gap-5 sm:p-5">
                <div
                  className={cn(
                    "flex h-32 w-full shrink-0 items-center justify-center rounded-lg sm:size-36",
                    p.category === "tires" ? "bg-[#f3f4f6] text-[#333]" : "bg-[#fff4ef] text-[#e8451c]",
                  )}
                >
                  {p.category === "tires" ? <Disc3 className="size-16" strokeWidth={1.2} /> : <Wrench className="size-14" strokeWidth={1.2} />}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[#888]">{p.category} · {p.sku}</div>
                  <h2 className="mt-1 text-[17px] font-semibold leading-tight">{p.name}</h2>
                  <p className="mt-1 text-[13px] text-[#666]">{p.description}</p>
                  <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-4">
                    <div>
                      <div className="text-[20px] font-bold tabular">{usd(p.priceCents)}</div>
                      <div className="text-[11.5px] text-[#888]">incl. taxes · in stock</div>
                    </div>
                    <div className="flex flex-col items-stretch gap-2 sm:items-end">
                      <button className="h-9 rounded-md border border-[#ddd] px-4 text-[13px] font-medium hover:bg-[#f7f7f7]">Add to cart</button>
                      <button
                        onClick={() => setSelected(p)}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-brand px-4 text-[13px] font-medium text-white shadow-[0_1px_1px_rgba(0,0,0,.1)] transition-colors hover:bg-brand-hover"
                      >
                        <Mark size={16} className="rounded-[4px] ring-1 ring-white/30" />
                        Pay with AgentPay
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 rounded-xl border border-[#eee] bg-[#fafafa] px-4 py-4 text-[13px] text-[#555] sm:flex-row sm:items-center sm:px-5">
          <ShieldCheck className="size-5 shrink-0 text-brand" />
          <div>
            <b className="text-[#111]">Agent purchases are verified before we accept them.</b> Signed agent identity, a passkey-authorized mandate, and a live status check — every time. Refused attempts are logged for you and the buyer.
          </div>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-[#888] sm:ml-auto">
            Powered by <Mark size={14} /> AgentPay
          </span>
        </div>
      </main>

      <CheckoutModal product={selected} open={selected !== null} onClose={() => setSelected(null)} />
    </div>
  );
}
