import { agentPayBaseUrl } from "@/lib/env";
import { merchantManifest } from "@/sdk";

export async function GET(request: Request) {
  const origin = agentPayBaseUrl(request.url);
  return Response.json(
    merchantManifest({
      origin,
      merchantId: "mrc_autoparts",
      merchantName: "AutoParts",
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
