import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutoPartsProductView } from "@/components/store/AutoPartsStorefront";
import { AUTOPARTS_CURRENCY, AUTOPARTS_MERCHANT, autoPartsProductUrl, autoPartsProducts } from "@/lib/autoparts";
import { agentPayBaseUrl } from "@/lib/env";

// One canonical URL per product, with the exact ids an agent needs in <meta>
// tags and JSON-LD. A crawler, an agent reading HTML, and find_products all
// see the same product_id, merchant_id, category and price.

export function generateStaticParams() {
  return autoPartsProducts.map((product) => ({ id: product.id }));
}

function findProduct(id: string) {
  return autoPartsProducts.find((product) => product.id === id) ?? null;
}

export async function generateMetadata({ params }: PageProps<"/store/products/[id]">): Promise<Metadata> {
  const { id } = await params;
  const product = findProduct(id);
  if (!product) return { title: "Product not found — AutoParts" };
  return {
    title: `${product.name} (${product.sku}) — AutoParts`,
    description: product.description,
    other: {
      "agentpay:merchant_id": AUTOPARTS_MERCHANT.id,
      "agentpay:product_id": product.id,
      "agentpay:category": product.category,
      "agentpay:price_cents": String(product.priceCents),
      "agentpay:currency": AUTOPARTS_CURRENCY,
      "agentpay:manifest": "/.well-known/agentpay.json",
    },
  };
}

export default async function ProductPage({ params }: PageProps<"/store/products/[id]">) {
  const { id } = await params;
  const product = findProduct(id);
  if (!product) notFound();
  const url = autoPartsProductUrl(agentPayBaseUrl(), product.id);
  const related = autoPartsProducts.filter((item) => item.category === product.category && item.id !== product.id);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    productID: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    url,
    offers: {
      "@type": "Offer",
      url,
      price: (product.priceCents / 100).toFixed(2),
      priceCurrency: AUTOPARTS_CURRENCY,
      availability: "https://schema.org/InStock",
      seller: { "@type": "Organization", name: AUTOPARTS_MERCHANT.name, identifier: AUTOPARTS_MERCHANT.id },
    },
    additionalProperty: [
      { "@type": "PropertyValue", name: "agentpay:merchant_id", value: AUTOPARTS_MERCHANT.id },
      { "@type": "PropertyValue", name: "agentpay:product_id", value: product.id },
      { "@type": "PropertyValue", name: "agentpay:category", value: product.category },
      { "@type": "PropertyValue", name: "agentpay:price_cents", value: product.priceCents },
    ],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <AutoPartsProductView product={product} related={related} />
    </>
  );
}
