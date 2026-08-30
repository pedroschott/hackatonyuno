import { publicBaseUrl } from "@/lib/server/db";
import { json, options } from "@/lib/server/http";

export const OPTIONS = options;

export async function GET(req: Request) {
  const base = publicBaseUrl(req);
  return json({
    name: "AgentPay",
    version: "0.2.0",
    description:
      "OAuth-protected mandate and payment enforcement for autonomous agents.",
    documentation: `${base}/docs`,
    agent_guide: `${base}/docs/agents`,
    mcp_endpoint: `${base}/mcp`,
    oauth_protected_resource: `${base}/.well-known/oauth-protected-resource`,
    merchant_discovery: {
      model:
        "Stores publish /.well-known/agentpay.json on their own domain, optionally advertising a catalog endpoint. Product research remains store-owned; AgentPay relays the store's catalog answer and never copies or ranks it.",
      example_manifest: `${base}/.well-known/agentpay.json`,
      example_catalog: `${base}/api/store/catalog`,
      supported_store_urls: `${base}/api/stores`,
      developer_console: `${base}/developers`,
    },
    tools: [
      "get_account",
      "get_payment_setup_link",
      "find_products",
      "create_mandate",
      "amend_mandate",
      "get_mandate",
      "check_purchase",
      "purchase",
      "revoke_mandate",
    ],
    instructions: [
      "Connect the AgentPay MCP server using OAuth and call get_account.",
      "Call find_products with any URL on the store to get exact merchant ids, categories, prices in cents and product ids.",
      "Create a draft mandate with create_mandate from the user's stated scope and limits, using those exact values.",
      "Wait for passkey authorization: poll get_mandate until it is active.",
      "Run check_purchase, then purchase. Follow explanation, remedy and next_tool on any non-approved decision; fix scope with amend_mandate, not revoke_mandate.",
      "Revoke immediately when the user asks to stop.",
    ],
  });
}
