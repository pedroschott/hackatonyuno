import { publicBaseUrl } from "@/lib/server/db";
import { json, options } from "@/lib/server/http";

export const OPTIONS = options;

export async function GET(req: Request) {
  const base = publicBaseUrl(req);
  return json({
    name: "AgentPay",
    version: "0.1.0",
    description:
      "OAuth-protected mandate and payment enforcement for autonomous agents.",
    mcp_endpoint: `${base}/mcp`,
    oauth_protected_resource: `${base}/.well-known/oauth-protected-resource`,
    merchant_discovery:
      "Stores publish /.well-known/agentpay.json on their own domain. AgentPay does not maintain a store directory.",
    instructions: [
      "Connect the AgentPay MCP server using OAuth.",
      "Call discover_merchant with the product or store URL and use its exact catalog identifiers.",
      "Create a draft mandate from the user's stated scope and limits.",
      "Wait for passkey authorization before purchasing.",
      "Discover AgentPay on the merchant found through search, then submit a signed purchase.",
      "Revoke immediately when the user asks to stop.",
    ],
  });
}
