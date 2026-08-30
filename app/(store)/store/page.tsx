import type { Metadata } from "next";

import { AutoPartsStorefront } from "@/components/store/AutoPartsStorefront";
import { AUTOPARTS_CATEGORIES, AUTOPARTS_CURRENCY, AUTOPARTS_MERCHANT, autoPartsProducts } from "@/lib/autoparts";

// Server component: the product list is rendered into the HTML so an agent (or
// a judge with curl) sees every product id and price without executing
// JavaScript. Checkout interactivity lives in the client storefront.
export const metadata: Metadata = {
  title: "AutoParts — Tires & fleet essentials",
  description: "Fleet-grade tire sets and accessories with same-day dispatch. Accepts AgentPay mandates.",
  other: {
    "agentpay:merchant_id": AUTOPARTS_MERCHANT.id,
    "agentpay:manifest": "/.well-known/agentpay.json",
    "agentpay:catalog": "/api/store/catalog",
    "agentpay:categories": AUTOPARTS_CATEGORIES.join(","),
    "agentpay:currency": AUTOPARTS_CURRENCY,
  },
};

export default function StorePage() {
  return <AutoPartsStorefront products={autoPartsProducts} />;
}
