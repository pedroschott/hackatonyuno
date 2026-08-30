import { agentPayBaseUrl } from "@/lib/env";
import { buildAutoPartsCatalog } from "@/lib/autoparts";

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "accept, content-type",
  };
}

export async function GET(request: Request) {
  const origin = agentPayBaseUrl(request.url);
  const catalog = buildAutoPartsCatalog(origin);

  return Response.json(catalog, {
    headers: {
      ...corsHeaders(),
      "cache-control": "public, max-age=300",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
