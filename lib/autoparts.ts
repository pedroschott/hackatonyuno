// The AutoParts demo merchant that ships with this repository. It is a store
// fixture, not account data: everything here is public catalog metadata.
import type { AgentPayCatalogProduct } from "@/lib/domain";
import { seedProducts } from "@/lib/seed";
import type { Product } from "@/lib/types";

export const AUTOPARTS_MERCHANT = { id: "mrc_autoparts", name: "AutoParts" } as const;
export const AUTOPARTS_CURRENCY = "BRL";

export const autoPartsProducts: Product[] = seedProducts.filter(
  (product) => product.merchantId === AUTOPARTS_MERCHANT.id,
);

export const AUTOPARTS_CATEGORIES = Array.from(new Set(autoPartsProducts.map((product) => product.category))).sort();

export function autoPartsProductUrl(origin: string, productId: string): string {
  return new URL(`/store/products/${encodeURIComponent(productId)}`, origin).toString();
}

export function autoPartsCatalogProducts(origin: string): AgentPayCatalogProduct[] {
  return autoPartsProducts.map((product) => ({
    product_id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    price_cents: product.priceCents,
    currency: AUTOPARTS_CURRENCY,
    sku: product.sku,
    availability: "in_stock",
    url: autoPartsProductUrl(origin, product.id),
  }));
}
