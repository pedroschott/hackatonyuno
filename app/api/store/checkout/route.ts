import { createPublicSupabase } from "@/lib/supabase/bearer";
import { createAgentPayCheckoutHandler } from "@/sdk";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const supabase = createPublicSupabase();
  const handler = createAgentPayCheckoutHandler({
    merchantId: "mrc_autoparts",
    registryUrl: origin,
    resolveProduct: async (productId) => {
      const result = await supabase.from("products").select("*").eq("id", productId).single();
      return result.error ? null : result.data;
    },
  });
  return handler(request);
}
