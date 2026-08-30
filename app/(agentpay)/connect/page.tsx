"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Check, Bot, Play, Smartphone } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, Mono } from "@/components/ui";
import { Qr } from "@/components/Qr";

export default function ConnectPage() {
  const base = useStore((s) => s.publicBaseUrl);
  const refresh = useStore((s) => s.refresh);
  const [simulating, setSimulating] = useState(false);
  const [last, setLast] = useState<{ mandate_id: string; approval_url: string } | null>(null);
  const https = /^https:/.test(base);

  const prompt = `Connect to the AgentPay MCP server at ${base}/mcp.

When authentication is requested, open the AgentPay browser flow and let the user sign in or create one account. The user approves mandates and one-time exceptions with their passkey.

1. Find the product through normal search or the store's own tools.
2. Call discover_merchant with that product or store URL. It reads the store's /.well-known/agentpay.json and catalog_endpoint. AgentPay is not a store directory.
3. Copy merchant ID, category, price and product ID exactly from the discovery result. Never derive product_id from a name, SKU, URL slug or list position.
4. Use get_account. If there is no saved payment method, call get_payment_setup_link. Explain that the secure browser form stays inside AgentPay and that you never see or use the full card number, CVC, PIN, bank password or vault credential. Never ask the user to send those details in chat. Wait for the user to finish, then call get_account again.
5. Create_mandate from the user's original request with the narrowest useful merchant, category, amount, use-count and expiry limits.
6. Ask the user to open approval_url. Do not purchase until get_mandate reports active.
7. Use purchase with the exact product_id from discover_merchant. Respect every refusal; if an exception is required, wait for passkey approval and retry only that purchase.
8. If the user says stop, call revoke_mandate immediately.`;

  const mcpConfig = `{
  "mcpServers": {
    "agentpay": {
      "url": "${base}/mcp"
    }
  }
}`;

  async function simulate() {
    setSimulating(true);
    try {
      const res = await fetch("/api/mandates", {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Claude/simulated" },
        body: JSON.stringify({
          requested_by: "Claude",
          natural_language_description: "Restock 4 standard tires for the fleet before Monday — AutoParts only, nothing premium.",
          scope: { merchants: ["AutoParts"], categories: ["tires"] },
          limits: { per_purchase_brl: 1600, cumulative_brl: 4000, max_uses: 3 },
        }),
      });
      const j = await res.json();
      setLast({ mandate_id: j.mandate_id, approval_url: j.approval_url });
      await refresh();
    } finally {
      setSimulating(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Connect an agent"
        description="Connect one OAuth-protected MCP server. The agent finds the store; AgentPay grants and enforces the user's purchase authority."
        actions={
          <Button variant="primary" icon={<Play className="size-4" />} loading={simulating} onClick={simulate}>
            Create demo mandate
          </Button>
        }
      />

      {last && (
        <Card className="ap-in mb-6 border-l-[3px] border-l-brand">
          <div className="flex flex-col items-start gap-4 px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
            <Qr value={last.approval_url} size={112} className="shrink-0" />
            <div className="min-w-0 flex-1 text-[13.5px]">
              <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                <Bot className="size-4 text-brand" /> “Claude” just asked for a mandate <Mono>{last.mandate_id}</Mono>
              </div>
              <p className="mt-1 text-ink-2">
                Scan the QR with your phone (or open the <Link href="/m" className="underline">mobile inbox</Link>) and approve with Face ID. The{" "}
                <Link href="/dashboard" className="underline">dashboard</Link> flips to active the moment you do.
              </p>
              <a href={last.approval_url} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all font-mono text-[12px] text-brand-ink underline-offset-2 hover:underline">
                {last.approval_url}
              </a>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-6">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Instructions for Claude, ChatGPT or any MCP agent" description="The OAuth flow returns to the agent automatically after account consent." actions={<CopyButton text={prompt} />} />
            <pre className="overflow-auto px-5 py-4 font-mono text-[12px] leading-relaxed text-ink-2 whitespace-pre-wrap">{prompt}</pre>
          </Card>
          <Card>
            <CardHeader title="Remote MCP configuration" description={`Server URL: ${base}/mcp`} actions={<CopyButton text={mcpConfig} />} />
            <pre className="overflow-auto bg-[#0f1530] px-5 py-4 font-mono text-[12px] leading-relaxed text-[#d9def0]">{mcpConfig}</pre>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Standards and discovery" description="OAuth for the agent, store-owned discovery for checkout, and live registry verification." />
            <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[13px]">
              <tbody className="divide-y divide-line-2">
                {[
                  ["POST", "/mcp", "OAuth-protected tools: account, secure payment setup, mandate, purchase and revoke"],
                  ["GET", "/.well-known/oauth-protected-resource/mcp", "MCP authorization-server discovery"],
                  ["GET", "/.well-known/agentpay.json", "store-owned AgentPay checkout discovery"],
                  ["GET", "/api/store/catalog", "store-owned catalog with exact product IDs"],
                  ["POST", "/api/store/checkout", "merchant SDK verifies signatures, status, replay and policy"],
                  ["GET", "/api/registry/mandates/:id", "live signed mandate status checked at purchase time"],
                ].map(([m, p, d]) => (
                  <tr key={p}>
                    <td className="w-16 px-5 py-2"><Badge tone={m === "GET" ? "neutral" : "brand"}>{m}</Badge></td>
                    <td className="w-64 px-2 py-2"><Mono>{p}</Mono></td>
                    <td className="px-2 py-2 text-muted">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Public URL" description="What the phone and the agent use." />
            <div className="space-y-3 px-5 py-4 text-[13px]">
              <div className="break-all font-mono text-[12.5px] text-ink">{base || "…"}</div>
              {https ? (
                <Badge tone="success" dot>HTTPS · real passkeys on the phone</Badge>
              ) : (
                <div className="rounded bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink">
                  WebAuthn requires a secure context. Use the production Vercel URL or run <Mono>npm run tunnel</Mono> before registering a passkey on another device.
                </div>
              )}
              <div className="flex flex-col items-center gap-2 pt-1">
                <Qr value={`${base}/m`} size={150} />
                <span className="inline-flex items-center gap-1 text-[12px] text-muted">
                  <Smartphone className="size-3.5" /> Mobile inbox · <Mono>/m</Mono>
                </span>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="What the agent never gets" />
            <ul className="space-y-1.5 px-5 py-4 text-[13px] text-ink-2">
              <li>· The card number. Supabase stores only encrypted mock-vault references and display metadata; the merchant gets a single-use token.</li>
              <li>· The ability to approve. Rules 1–8 refuse, rule 9 escalates to a human.</li>
              <li>· A way past revocation. Status lives in the registry, never in the token.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      size="sm"
      icon={ok ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      onClick={() => navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); })}
    >
      {ok ? "Copied" : "Copy"}
    </Button>
  );
}
