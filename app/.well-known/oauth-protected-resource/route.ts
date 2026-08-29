import { agentPayBaseUrl, publicSupabaseEnv } from "@/lib/env";

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
  };
}

export async function GET(request: Request) {
  const resource = `${agentPayBaseUrl(request.url)}/mcp`;
  return Response.json(
    {
      resource,
      authorization_servers: [`${publicSupabaseEnv().url}/auth/v1`],
      scopes_supported: ["email"],
      bearer_methods_supported: ["header"],
      resource_documentation: `${agentPayBaseUrl(request.url)}/connect`,
    },
    { headers: { ...cors(), "cache-control": "public, max-age=300" } },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}
