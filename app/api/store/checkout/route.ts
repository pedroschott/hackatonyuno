import { resolveAutoPartsProduct } from "@/lib/autoparts";
import { createAgentPayCheckoutHandler } from "@/sdk";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const handler = createAgentPayCheckoutHandler({
    merchantId: "mrc_autoparts",
    registryUrl: origin,
    resolveProduct: async (productId) => resolveAutoPartsProduct(productId),
  });
  return handler(request);
}
