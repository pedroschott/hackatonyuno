import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { decodeJwtPayload } from "@/lib/http";
import { registerAgentPayTools } from "@/lib/mcp/agentpay-tools";
import { createBearerSupabase } from "@/lib/supabase/bearer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const handler = createMcpHandler((server) => {
  registerAgentPayTools(server);
}, {
  serverInfo: { name: "agentpay", version: "0.1.0" },
  instructions:
    "AgentPay enforces user-authorized purchase mandates. Never purchase before a mandate is active. Discover each merchant from its own product page or /.well-known/agentpay.json; AgentPay is not a store directory. Revoke immediately when the user says stop.",
});

async function verifyToken(request: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const supabase = createBearerSupabase(bearerToken);
  const result = await supabase.auth.getUser(bearerToken);
  if (result.error || !result.data.user) return undefined;
  const claims = decodeJwtPayload(bearerToken);
  const scope = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : ["email"];
  return {
    token: bearerToken,
    clientId: typeof claims.client_id === "string" ? claims.client_id : "agentpay-mcp-client",
    scopes: scope.includes("email") ? scope : [...scope, "email"],
    expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
    extra: { userId: result.data.user.id, origin: new URL(request.url).origin },
  };
}

const authenticatedHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  requiredScopes: ["email"],
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authenticatedHandler as GET, authenticatedHandler as POST };
