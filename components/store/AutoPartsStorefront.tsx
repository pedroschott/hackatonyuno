"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Disc3, Search, ShieldCheck, ShoppingCart, Truck, Wrench } from "lucide-react";

import { Mark } from "@/components/Logo";
import { CheckoutModal } from "@/components/store/CheckoutModal";
import { cn } from "@/lib/cn";
import { usd } from "@/lib/format";
import type { Product } from "@/lib/types";

/**
 * The AutoParts demo storefront. Products arrive as props from a server
 * component, so the HTML an agent fetches already contains every name, price
 * and product id — nothing waits for a client-side state poll.
 */
export function AutoPartsStorefront({ products }: { products: Product[] }) {
  const [selected, setSelected] = useState<Product | null>(null);
  return (
    <StoreChrome>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight sm:text-[26px]">Tires &amp; fleet essentials</h1>
          <p className="mt-1 text-[14px] text-[#666]">Fleet-grade sets with same-day dispatch. Procurement agents welcome.</p>
        </div>
        <div className="text-[13px] text-[#666]">{products.length} products</div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} onPay={() => setSelected(product)} />
        ))}
      </div>

      <AgentNotice />
      <CheckoutModal product={selected} open={selected !== null} onClose={() => setSelected(null)} />
    </StoreChrome>
  );
}

export function AutoPartsProductView({ product, related }: { product: Product; related: Product[] }) {
  const [paying, setPaying] = useState(false);
  return (
    <StoreChrome>
      <Link href="/store" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-[#666] hover:text-[#111]">
        <ArrowLeft className="size-3.5" /> All products
      </Link>
      <article
        id={`product-${product.id}`}
        className="flex flex-col gap-6 rounded-xl border border-[#eee] p-5 sm:flex-row sm:gap-8 sm:p-7"
        data-agentpay-product-id={product.id}
        data-agentpay-merchant-id={product.merchantId}
      >
        <ProductArt category={product.category} large />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#888]">
            {product.category} · {product.sku}
          </div>
          <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-tight">{product.name}</h1>
          <p className="mt-2 text-[14px] text-[#555]">{product.description}</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] text-[#666]">
            <dt>Product id</dt>
            <dd className="font-mono text-[#111]">{product.id}</dd>
            <dt>Merchant id</dt>
            <dd className="font-mono text-[#111]">{product.merchantId}</dd>
            <dt>Mandate category</dt>
            <dd className="font-mono text-[#111]">{product.category}</dd>
            <dt>Availability</dt>
            <dd className="text-[#111]">In stock</dd>
          </dl>
          <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-6">
            <div>
              <div className="text-[26px] font-bold tabular">{usd(product.priceCents)}</div>
              <div className="text-[11.5px] text-[#888]">incl. taxes · {product.priceCents} USD cents</div>
            </div>
            <PayButton onClick={() => setPaying(true)} />
          </div>
        </div>
      </article>

      {related.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[16px] font-semibold">More {product.category}</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      )}

      <AgentNotice />
      <CheckoutModal product={paying ? product : null} open={paying} onClose={() => setPaying(false)} />
    </StoreChrome>
  );
}

function StoreChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-[#111]">
      <div className="border-b border-[#eee] bg-[#111] text-[12px] text-white/80">
        <div className="mx-auto flex max-w-[1100px] items-center gap-4 px-4 py-1.5 sm:px-6">
          <span className="hidden items-center gap-1.5 sm:inline-flex">
            <Truck className="size-3.5" /> Free fleet delivery over $1,000
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 sm:ml-auto">
            <Mark size={14} /> Agent-ready · accepts AgentPay mandates
          </span>
        </div>
      </div>
      <header className="border-b border-[#eee]">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6 lg:gap-8">
          <Link href="/store" className="text-[20px] font-bold tracking-tight">
            Auto<span className="text-[#e8451c]">Parts</span>
          </Link>
          <nav className="hidden gap-5 text-[14px] text-[#444] md:flex">
            <Link className="font-medium text-[#111]" href="/store">
              Tires
            </Link>
            <Link href="/store">Accessories</Link>
            <a href="/.well-known/agentpay.json">Agents</a>
            <a href="/api/store/catalog">Catalog API</a>
          </nav>
          <button className="relative ml-auto rounded-full p-2 hover:bg-[#f4f4f4] md:order-last" aria-label="Cart">
            <ShoppingCart className="size-5" />
          </button>
          <div className="order-last flex h-9 w-full items-center gap-2 rounded-full border border-[#ddd] px-3 text-[13px] text-[#888] md:order-none md:ml-auto md:w-72">
            <Search className="size-4 shrink-0" /> Search parts, SKUs…
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

function ProductCard({ product, onPay }: { product: Product; onPay?: () => void }) {
  return (
    <article
      id={`product-${product.id}`}
      className="flex flex-col gap-4 rounded-xl border border-[#eee] p-4 transition-shadow hover:shadow-[0_4px_20px_rgba(0,0,0,.06)] sm:flex-row sm:gap-5 sm:p-5"
      data-agentpay-product-id={product.id}
    >
      <ProductArt category={product.category} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="text-[11px] font-medium uppercase tracking-wide text-[#888]">
          {product.category} · {product.sku}
        </div>
        <h2 className="mt-1 text-[17px] font-semibold leading-tight">
          <Link href={`/store/products/${product.id}`} className="hover:underline">
            {product.name}
          </Link>
        </h2>
        <p className="mt-1 text-[13px] text-[#666]">{product.description}</p>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-4">
          <div>
            <div className="text-[20px] font-bold tabular">{usd(product.priceCents)}</div>
            <div className="text-[11.5px] text-[#888]">incl. taxes · in stock</div>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <Link
              href={`/store/products/${product.id}`}
              className="inline-flex h-9 items-center justify-center rounded-md border border-[#ddd] px-4 text-[13px] font-medium hover:bg-[#f7f7f7]"
            >
              Details
            </Link>
            {onPay && <PayButton onClick={onPay} />}
          </div>
        </div>
      </div>
    </article>
  );
}

function PayButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-brand px-4 text-[13px] font-medium text-white shadow-[0_1px_1px_rgba(0,0,0,.1)] transition-colors hover:bg-brand-hover"
    >
      <Mark size={16} className="rounded-[4px] ring-1 ring-white/30" />
      Pay with AgentPay
    </button>
  );
}

function ProductArt({ category, large }: { category: string; large?: boolean }) {
  const tires = category === "tires";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        large ? "h-44 w-full sm:size-56" : "h-32 w-full sm:size-36",
        tires ? "bg-[#f3f4f6] text-[#333]" : "bg-[#fff4ef] text-[#e8451c]",
      )}
    >
      {tires ? (
        <Disc3 className={large ? "size-24" : "size-16"} strokeWidth={1.2} />
      ) : (
        <Wrench className={large ? "size-20" : "size-14"} strokeWidth={1.2} />
      )}
    </div>
  );
}

function AgentNotice() {
  return (
    <div className="mt-10 flex flex-col gap-3 rounded-xl border border-[#eee] bg-[#fafafa] px-4 py-4 text-[13px] text-[#555] sm:flex-row sm:items-center sm:px-5">
      <ShieldCheck className="size-5 shrink-0 text-brand" />
      <div>
        <b className="text-[#111]">Agent purchases are verified before we accept them.</b> Signed agent identity, a
        passkey-authorized mandate, and a live status check — every time. Refused attempts are logged for you and the
        buyer.
      </div>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-[#888] sm:ml-auto">
        Powered by <Mark size={14} /> AgentPay
      </span>
    </div>
  );
}
