import { AUTOPARTS_CATEGORIES, AUTOPARTS_CURRENCY, AUTOPARTS_MERCHANT, autoPartsCatalogProducts } from "@/lib/autoparts";
import { agentPayBaseUrl } from "@/lib/env";
import { createAgentPayCatalogHandler } from "@/sdk";

export const dynamic = "force-dynamic";

// Store-owned catalog for the AutoParts demo, advertised as `catalog_endpoint`
// in /.well-known/agentpay.json. Filtering runs here, on the merchant side, so
// an agent asks one question and gets exact product ids, categories and prices.
export async function GET(request: Request) {
  const origin = agentPayBaseUrl(request.url);
  const handler = createAgentPayCatalogHandler({
    merchantId: AUTOPARTS_MERCHANT.id,
    merchantName: AUTOPARTS_MERCHANT.name,
    currency: AUTOPARTS_CURRENCY,
    categories: AUTOPARTS_CATEGORIES,
    products: () => autoPartsCatalogProducts(origin),
    maxAgeSeconds: 300,
  });
  return handler(request);
}
