import { AUTOPARTS_CATEGORIES, AUTOPARTS_CURRENCY, AUTOPARTS_MERCHANT } from "@/lib/autoparts";
import { agentPayBaseUrl } from "@/lib/env";
import { merchantManifest } from "@/sdk";

export async function GET(request: Request) {
  const origin = agentPayBaseUrl(request.url);
  return Response.json(
    merchantManifest({
      origin,
      merchantId: AUTOPARTS_MERCHANT.id,
      merchantName: AUTOPARTS_MERCHANT.name,
      catalogPath: "/api/store/catalog",
      categories: AUTOPARTS_CATEGORIES,
      currency: AUTOPARTS_CURRENCY,
      productUrlTemplate: "/store/products/{id}",
      documentationUrl: `${origin}/docs/agents`,
      registryUrl: origin,
    }),
    {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=300",
      },
    },
  );
}
