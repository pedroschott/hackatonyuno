import type { AgentPayMerchantCatalog } from "@/lib/domain";
import { seedProducts } from "@/lib/seed";

export const AUTO_PARTS_MERCHANT = {
  id: "mrc_autoparts",
  name: "AutoParts",
} as const;

export const autoPartsProducts = seedProducts.filter(
  (product) => product.merchantId === AUTO_PARTS_MERCHANT.id,
);

export function buildAutoPartsCatalog(origin: string): AgentPayMerchantCatalog {
  return {
    protocol: "agentpay-catalog/1.0",
    merchant: AUTO_PARTS_MERCHANT,
    products: autoPartsProducts.map((product) => ({
      product_id: product.id,
      merchant_id: product.merchantId,
      sku: product.sku,
      name: product.name,
      description: product.description,
      category: product.category,
      price_cents: product.priceCents,
      currency: "BRL",
      availability: "in_stock",
      product_url: `${origin}/store#product-${encodeURIComponent(product.id)}`,
    })),
  };
}

export function resolveAutoPartsProduct(productId: string) {
  const product = autoPartsProducts.find((candidate) => candidate.id === productId);
  if (!product) return null;
  return {
    id: product.id,
    merchant_id: product.merchantId,
    name: product.name,
    category: product.category,
    price_cents: product.priceCents,
    currency: "BRL",
  };
}
