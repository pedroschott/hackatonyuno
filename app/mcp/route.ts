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
  serverInfo: { name: "agentpay", version: "0.2.0" },
  instructions:
    "AgentPay enforces user-authorized purchase mandates. Start with get_account. If no payment method is saved, call get_payment_setup_link, explain that payment setup happens only in AgentPay's browser UI, and wait for the user before calling get_account again. Never ask for or accept a full card number, CVC, PIN, bank password, or vault credential in chat; tools expose only safe payment metadata. Use discover_merchant with the store or product URL and copy its merchant ID, category and product ID exactly. Never guess a product ID. Never purchase before a mandate is active. AgentPay is not a store directory. Revoke immediately when the user says stop.",
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
