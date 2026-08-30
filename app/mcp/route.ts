import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { decodeJwtPayload } from "@/lib/http";
import { registerAgentPayTools } from "@/lib/mcp/agentpay-tools";
import { createBearerSupabase } from "@/lib/supabase/bearer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The instructions are the agent's operating manual. They spell out the one
 * working order of calls and what each decision means, because an agent that
 * guesses a merchant id or retries a refusal is the failure mode this server
 * exists to prevent.
 */
const INSTRUCTIONS = [
  "AgentPay enforces user-signed purchase mandates. The agent holds no money and no card; it can only buy inside a mandate the user signed with a passkey.",
  "Order of calls: (1) get_account. If identity_verification.verified is false, send the user to verification_url and wait. If cards is empty, call get_payment_setup_link and wait; never ask for a card number, CVC, PIN, bank password or vault credential in chat. (2) find_products with the store URL the user gave you: it returns the exact merchant id, category slugs, currency, prices in cents and product ids. Never guess any of these from a page, name, SKU or URL. (3) create_mandate with merchant_urls, the exact categories and per_purchase_cents at or above the price, then send the user authorization_url and wait. (4) get_mandate until status is active. A draft is normal; do not create a second mandate for the same request. (5) check_purchase, then purchase with products[].product_id verbatim.",
  "Reading a purchase result: approved is done. escalated means the price exceeds the per-purchase limit; send the user approval_url, then call purchase again with exception_id. refused carries explanation, remedy and next_tool: follow them. MERCHANT_NOT_IN_SCOPE and CATEGORY_NOT_IN_SCOPE are fixed with amend_mandate, which the user signs once and which retires the old mandate automatically. Never revoke a mandate to fix its scope, and never retry the same refused purchase unchanged.",
  "Revoke only when the user says stop. AgentPay is not a store directory: discover each merchant from its own URL, which must come from the user or from search.",
].join(" ");

const handler = createMcpHandler((server) => {
  registerAgentPayTools(server);
}, {
  serverInfo: { name: "agentpay", version: "0.3.0" },
  instructions: INSTRUCTIONS,
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
