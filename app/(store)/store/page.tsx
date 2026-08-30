import type { Metadata } from "next";
import { Disc3, Search, ShieldCheck, ShoppingCart, Truck, Wrench } from "lucide-react";

import { cn } from "@/lib/cn";
import { agentPayBaseUrl } from "@/lib/env";
import { brl } from "@/lib/format";
import { autoPartsProducts as products } from "@/lib/autoparts";

export const metadata: Metadata = {
  title: "AutoParts — Tires & fleet essentials",
  description: "Fleet-grade tires and automotive accessories with same-day dispatch.",
};

export default function StorePage() {
  const origin = agentPayBaseUrl();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "AutoParts fleet catalog",
    url: `${origin}/store`,
    itemListElement: products.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Product",
        "@id": `${origin}/store#product-${product.id}`,
        name: product.name,
        description: product.description,
        sku: product.sku,
        category: product.category,
        offers: {
          "@type": "Offer",
          url: `${origin}/store#product-${product.id}`,
          price: (product.priceCents / 100).toFixed(2),
          priceCurrency: "BRL",
          availability: "https://schema.org/InStock",
        },
        additionalProperty: {
          "@type": "PropertyValue",
          name: "Agent checkout product ID",
          value: product.id,
        },
      },
    })),
  };

  return (
    <div className="min-h-screen bg-white text-[#111]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <div className="border-b border-[#eee] bg-[#111] text-[12px] text-white/80">
        <div className="mx-auto flex max-w-[1100px] items-center gap-4 px-4 py-1.5 sm:px-6">
          <span className="hidden items-center gap-1.5 sm:inline-flex">
            <Truck className="size-3.5" /> Free fleet delivery over R$ 1.000
          </span>
          <span className="sm:ml-auto">Same-day dispatch for fleet orders</span>
        </div>
      </div>

      <header className="border-b border-[#eee]">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6 lg:gap-8">
          <a href="/store" className="text-[20px] font-bold tracking-tight">
            Auto<span className="text-[#e8451c]">Parts</span>
          </a>
          <nav className="hidden gap-5 text-[14px] text-[#444] md:flex">
            <a className="font-medium text-[#111]" href="#product-prd_tire_std">Tires</a>
            <a href="#product-prd_acc_jack">Accessories</a>
            <a href="#agent-purchasing">Fleet</a>
            <a href="#agent-purchasing">B2B</a>
          </nav>
          <button type="button" aria-label="Open cart" className="relative ml-auto rounded-full p-2 hover:bg-[#f4f4f4] md:order-last">
            <ShoppingCart className="size-5" />
          </button>
          <label className="order-last flex h-9 w-full items-center gap-2 rounded-full border border-[#ddd] px-3 text-[13px] text-[#888] md:order-none md:ml-auto md:w-72">
            <Search className="size-4 shrink-0" />
            <span className="sr-only">Search parts and SKUs</span>
            <input className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Search parts, SKUs…" type="search" />
          </label>
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
          {products.map((product) => (
            <article
              id={`product-${product.id}`}
              key={product.id}
              data-product-id={product.id}
              data-merchant-id={product.merchantId}
              className="flex flex-col gap-4 rounded-xl border border-[#eee] p-4 transition-shadow hover:shadow-[0_4px_20px_rgba(0,0,0,.06)] sm:flex-row sm:gap-5 sm:p-5"
            >
              <div
                className={cn(
                  "flex h-32 w-full shrink-0 items-center justify-center rounded-lg sm:size-36",
                  product.category === "tires" ? "bg-[#f3f4f6] text-[#333]" : "bg-[#fff4ef] text-[#e8451c]",
                )}
              >
                {product.category === "tires" ? <Disc3 className="size-16" strokeWidth={1.2} /> : <Wrench className="size-14" strokeWidth={1.2} />}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="text-[11px] font-medium uppercase tracking-wide text-[#888]">{product.category} · {product.sku}</div>
                <h2 className="mt-1 text-[17px] font-semibold leading-tight">{product.name}</h2>
                <p className="mt-1 text-[13px] text-[#666]">{product.description}</p>
                <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-4">
                  <div>
                    <div className="text-[20px] font-bold tabular">{brl(product.priceCents)}</div>
                    <div className="text-[11.5px] text-[#888]">incl. taxes · in stock</div>
                  </div>
                  <button type="button" className="h-9 rounded-md border border-[#ddd] px-4 text-[13px] font-medium hover:bg-[#f7f7f7]">
                    Add to cart
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div id="agent-purchasing" className="mt-10 flex flex-col gap-3 rounded-xl border border-[#eee] bg-[#fafafa] px-4 py-4 text-[13px] text-[#555] sm:flex-row sm:items-center sm:px-5">
          <ShieldCheck className="size-5 shrink-0 text-[#e8451c]" />
          <div>
            <b className="text-[#111]">Agent purchase requests are verified before acceptance.</b> Signed identity, live authorization status, replay protection, and purchase policy are checked for every request.
          </div>
        </div>
      </main>
    </div>
  );
}
