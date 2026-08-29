const email = process.argv[2];
const password = process.argv[3];
if (!email || !password) throw new Error("Pass a disposable account email and password");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const baseUrl = process.env.AGENTPAY_BASE_URL;
if (!supabaseUrl || !publishableKey || !baseUrl) throw new Error("AgentPay environment is incomplete");

const signIn = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: publishableKey, "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const session = await signIn.json();
if (!signIn.ok || !session.access_token) throw new Error(session.error_description ?? "Sign-in failed");

let mcpSessionId;
async function call(body) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.access_token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-03-26",
      ...(mcpSessionId ? { "mcp-session-id": mcpSessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  mcpSessionId = response.headers.get("mcp-session-id") ?? mcpSessionId;
  const raw = await response.text();
  if (!response.ok) throw new Error(`MCP ${response.status}: ${raw}`);
  if (raw.includes("data:")) {
    return JSON.parse(
      raw
        .split("\n")
        .find((line) => line.startsWith("data:"))
        .slice(5)
        .trim(),
    );
  }
  return raw ? JSON.parse(raw) : null;
}

const initialized = await call({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "agentpay-smoke", version: "1.0.0" },
  },
});
if (!initialized?.result?.serverInfo) throw new Error("MCP initialization failed");

await call({ jsonrpc: "2.0", method: "notifications/initialized" });
const listed = await call({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
const names = listed?.result?.tools?.map((tool) => tool.name) ?? [];
for (const required of ["get_account", "create_mandate", "get_mandate", "revoke_mandate", "purchase"]) {
  if (!names.includes(required)) throw new Error(`Missing MCP tool: ${required}`);
}
const account = await call({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "get_account", arguments: {} },
});
if (account?.result?.isError) throw new Error("get_account returned an error");

console.log(
  JSON.stringify({
    server: initialized.result.serverInfo.name,
    tools: names,
    account_connected: true,
  }),
);
