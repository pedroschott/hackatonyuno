"use client";

import {
  Activity,
  ArrowLeft,
  Check,
  Circle,
  Code2,
  ExternalLink,
  KeyRound,
  PackagePlus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Store,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/docs/CopyButton";
import { Badge, Button, buttonClassName, Card, CardHeader, EmptyState, Field, Input, Modal } from "@/components/ui";
import { cn } from "@/lib/cn";
import { usd } from "@/lib/format";
import {
  merchantTone,
  type DeveloperMerchant,
  type DeveloperProduct,
  type MerchantApiKey,
  type MerchantAttempt,
} from "@/lib/merchant-console";
import { DeveloperPageHeader, LoadingPanel, MetricCard } from "./bits";
import { developerApi } from "./client";

type Detail = {
  merchant: DeveloperMerchant;
  products: DeveloperProduct[];
  api_keys: MerchantApiKey[];
  attempts: MerchantAttempt[];
};

type Tab = "integration" | "catalog" | "keys" | "activity" | "settings";

const TABS: Array<{ value: Tab; label: string; icon: typeof Code2 }> = [
  { value: "integration", label: "Integration", icon: Code2 },
  { value: "catalog", label: "Catalog", icon: Store },
  { value: "keys", label: "API keys", icon: KeyRound },
  { value: "activity", label: "Activity", icon: Activity },
  { value: "settings", label: "Settings", icon: Settings },
];

export function MerchantDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<Tab>("integration");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const result = await developerApi<Detail>(`/api/developers/merchants/${id}`);
      setDetail(result);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load merchant");
    }
  }

  useEffect(() => {
    let active = true;
    void developerApi<Detail>(`/api/developers/merchants/${id}`)
      .then((result) => {
        if (active) {
          setDetail(result);
          setError(null);
        }
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load merchant");
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await developerApi(`/api/developers/merchants/${id}/verify`, { method: "POST" });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Verification failed");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!detail && !error) return <LoadingPanel />;
  if (!detail) return <div className="rounded-md bg-danger-soft px-4 py-3 text-[13px] text-danger-ink">{error ?? "Merchant not found"}</div>;
  const { merchant } = detail;

  return (
    <>
      <Link href="/developers/merchants" className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> Merchants</Link>
      <DeveloperPageHeader
        eyebrow={merchant.environment === "test" ? "Test merchant" : "Live merchant"}
        title={merchant.name}
        description={<span className="font-mono text-[12px]">{merchant.id}</span>}
        actions={
          <>
            {!merchant.hosted_store && <Button icon={<RefreshCw className="size-3.5" />} loading={busy} onClick={verify}>Verify domain</Button>}
            {merchant.website_url && <a href={merchant.website_url} target="_blank" rel="noreferrer" className={buttonClassName({ variant: "primary" })}><ExternalLink className="size-3.5" /> Open store</a>}
          </>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={merchantTone(merchant.verification_status)} dot>{merchant.verification_status}</Badge>
        <Badge tone={merchant.agent_ready ? "success" : "neutral"}>{merchant.agent_ready ? "Agent-ready" : "Not active"}</Badge>
        <Badge tone={merchant.hosted_store ? "brand" : "neutral"}>{merchant.hosted_store ? "Hosted mock" : "External domain"}</Badge>
        {merchant.publicly_listed && <Badge tone="success">Publicly supported</Badge>}
      </div>
      {error && <div className="mb-5 rounded-md bg-danger-soft px-4 py-3 text-[13px] text-danger-ink">{error}</div>}
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(({ value, label, icon: Icon }) => (
          <button key={value} onClick={() => setTab(value)} className={cn("-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12.5px] font-medium", tab === value ? "border-brand text-brand-ink" : "border-transparent text-muted hover:text-ink")}>
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>
      {tab === "integration" && <IntegrationTab detail={detail} onChange={load} onVerify={verify} verifying={busy} />}
      {tab === "catalog" && <CatalogTab merchant={merchant} products={detail.products} onChange={load} />}
      {tab === "keys" && <KeysTab merchant={merchant} keys={detail.api_keys} onChange={load} />}
      {tab === "activity" && <ActivityTab attempts={detail.attempts} />}
      {tab === "settings" && <SettingsTab merchant={merchant} onChange={load} />}
    </>
  );
}

function IntegrationTab({
  detail,
  onChange,
  onVerify,
  verifying,
}: {
  detail: Detail;
  onChange: () => Promise<void>;
  onVerify: () => Promise<void>;
  verifying: boolean;
}) {
  const { merchant, products, api_keys: keys, attempts } = detail;
  const steps = [
    { label: "Merchant identity created", done: true, detail: merchant.id },
    { label: merchant.hosted_store ? "Hosted discovery is live" : "Discovery manifest verified", done: merchant.verification_status === "verified", detail: merchant.discovery_url ?? "Not configured" },
    { label: "Catalog has at least one product", done: products.some((product) => product.active), detail: `${products.filter((product) => product.active).length} active products` },
    { label: "Server-side API key created", done: keys.some((key) => !key.revoked_at), detail: `${keys.filter((key) => !key.revoked_at).length} active keys` },
    { label: "First checkout received", done: attempts.length > 0, detail: attempts.length ? `${attempts.length} attempts` : "Waiting for an agent" },
  ];
  const manifest = `import { merchantManifest } from "@agentpay/merchant-sdk";

export function GET(request: Request) {
  return Response.json(merchantManifest({
    origin: request.url,
    merchantId: "${merchant.id}",
    merchantName: "${merchant.name}",
    checkoutPath: "/api/agentpay/checkout",
    registryUrl: "https://agentpay-yuno.vercel.app",
  }));
}`;
  const checkout = `const checkout = createAgentPayCheckoutHandler({
  merchantId: "${merchant.id}",
  registryUrl: "https://agentpay-yuno.vercel.app",
  resolveProduct: async (productId) => db.products.find(productId),
});`;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="Integration checklist" description="A complete merchant can be discovered, scoped into a mandate, and verified at checkout." />
          <ol>
            {steps.map((step, index) => (
              <li key={step.label} className="flex gap-3 border-b border-line px-5 py-3.5 last:border-b-0">
                <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", step.done ? "bg-success text-white" : "bg-line-2 text-faint")}>
                  {step.done ? <Check className="size-3" strokeWidth={3} /> : <span className="text-[10px] font-semibold">{index + 1}</span>}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{step.label}</div>
                  <div className="mt-0.5 truncate text-[11.5px] text-muted">{step.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        {!merchant.hosted_store && (
          <Card>
            <CardHeader title="Publish discovery" description="Serve this on your domain before running verification." actions={<Button loading={verifying} onClick={onVerify}>Verify now</Button>} />
            <CodePanel filename="app/.well-known/agentpay.json/route.ts" code={manifest} />
            {merchant.verification_error && <div className="border-t border-line bg-danger-soft px-5 py-3 text-[12px] text-danger-ink">{merchant.verification_error}</div>}
          </Card>
        )}
        <Card>
          <CardHeader title="Protect checkout" description="The SDK resolves price from your catalog and refuses anything it cannot prove." />
          <CodePanel filename="app/api/agentpay/checkout/route.ts" code={checkout} />
        </Card>
      </div>
      <div className="space-y-5">
        <EndpointCard label="Merchant ID" value={merchant.id} />
        <EndpointCard label="Store URL" value={merchant.website_url ?? "Not configured"} href={merchant.website_url} />
        <EndpointCard label="Discovery URL" value={merchant.discovery_url ?? "Not configured"} href={merchant.discovery_url} />
        <EndpointCard label="Checkout URL" value={merchant.checkout_url ?? "Set by verified discovery"} href={merchant.checkout_url} />
        <Card className="px-5 py-5">
          <ShieldCheck className="size-5 text-brand" />
          <h3 className="mt-3 text-[14px] font-semibold">Try the full flow</h3>
          <ol className="mt-3 space-y-2 text-[12px] leading-4.5 text-muted">
            <li>1. Copy the merchant ID and product ID.</li>
            <li>2. Ask a connected agent to create a mandate for both.</li>
            <li>3. Sign the mandate with the buyer passkey.</li>
            <li>4. Ask the agent to purchase; the decision appears in Activity.</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon={<RefreshCw className="size-3.5" />} onClick={() => void onChange()}>Refresh</Button>
            <Link href="/connect" className={buttonClassName({ variant: "primary" })}>Connect agent</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

function CatalogTab({ merchant, products, onChange }: { merchant: DeveloperMerchant; products: DeveloperProduct[]; onChange: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", category: merchant.category, sku: "", price: "49.00" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createProduct() {
    setBusy(true);
    setError(null);
    try {
      await developerApi(`/api/developers/merchants/${merchant.id}/products`, {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          category: form.category,
          sku: form.sku,
          price_cents: Math.round(Number(form.price) * 100),
          currency: "USD",
        }),
      });
      setOpen(false);
      setForm({ name: "", description: "", category: merchant.category, sku: "", price: "49.00" });
      await onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create product");
    } finally {
      setBusy(false);
    }
  }

  async function remove(productId: string) {
    if (!window.confirm("Delete this product from the test catalog?")) return;
    await developerApi(`/api/developers/merchants/${merchant.id}/products/${productId}`, { method: "DELETE" });
    await onChange();
  }

  return (
    <>
      <Card>
        <CardHeader title="Product catalog" description="The merchant, not the agent, is authoritative for category and price." actions={<Button variant="primary" icon={<PackagePlus className="size-3.5" />} onClick={() => setOpen(true)}>Add product</Button>} />
        {products.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[12.5px]">
              <thead className="border-b border-line bg-[#fafbfc] text-[10.5px] uppercase tracking-[0.08em] text-faint"><tr><th className="px-5 py-2.5">Product</th><th className="px-4 py-2.5">Category</th><th className="px-4 py-2.5">Price</th><th className="px-4 py-2.5">Status</th><th className="px-5 py-2.5 text-right">Action</th></tr></thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="border-b border-line last:border-b-0">
                    <td className="px-5 py-3"><div className="font-medium">{product.name}</div><div className="mt-0.5 font-mono text-[10.5px] text-faint">{product.sku} · {product.id}</div></td>
                    <td className="px-4 py-3 text-muted">{product.category}</td>
                    <td className="px-4 py-3 font-medium tabular">{usd(product.price_cents)}</td>
                    <td className="px-4 py-3"><Badge tone={product.active ? "success" : "neutral"} dot>{product.active ? "active" : "inactive"}</Badge></td>
                    <td className="px-5 py-3 text-right"><button onClick={() => void remove(product.id)} className="rounded p-1.5 text-faint hover:bg-danger-soft hover:text-danger-ink" aria-label={`Delete ${product.name}`}><Trash2 className="size-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No products" description="Add a product before asking an agent to research or buy from this store." />}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Add product" width="max-w-lg">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Sample product" /></Field>
          <Field label="SKU"><Input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="SKU-001" /></Field>
          <Field label="Category"><Input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></Field>
          <Field label="Price (USD)"><Input inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></Field>
          <Field label="Description" className="sm:col-span-2"><Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What an agent should know about this product" /></Field>
          {error && <div className="rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger-ink sm:col-span-2">{error}</div>}
          <div className="flex justify-end gap-2 border-t border-line pt-4 sm:col-span-2"><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!form.name || !form.sku || !form.description || Number(form.price) <= 0} onClick={createProduct}>Add product</Button></div>
        </div>
      </Modal>
    </>
  );
}

function KeysTab({ merchant, keys, onChange }: { merchant: DeveloperMerchant; keys: MerchantApiKey[]; onChange: () => Promise<void> }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createKey() {
    setBusy(true);
    setError(null);
    try {
      const result = await developerApi<{ secret: string }>(`/api/developers/merchants/${merchant.id}/keys`, { method: "POST", body: JSON.stringify({ name: "Default key" }) });
      setSecret(result.secret);
      await onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create key");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(keyId: string) {
    if (!window.confirm("Revoke this API key? Requests using it will stop immediately.")) return;
    await developerApi(`/api/developers/merchants/${merchant.id}/keys/${keyId}`, { method: "DELETE" });
    await onChange();
  }

  const curl = `curl -X POST https://agentpay-yuno.vercel.app/api/v1/merchants/${merchant.id}/products \\
  -H "Authorization: Bearer $AGENTPAY_MERCHANT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Desk lamp","description":"LED task lamp","category":"office","sku":"LAMP-01","price_cents":12900,"currency":"USD"}'`;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Server-side API keys" description="Use these keys only from your backend. AgentPay stores a SHA-256 hash and shows the plaintext once." actions={<Button variant="primary" icon={<KeyRound className="size-3.5" />} loading={busy} onClick={createKey}>Create key</Button>} />
        {error && <div className="border-b border-line bg-danger-soft px-5 py-3 text-[12px] text-danger-ink">{error}</div>}
        {keys.length ? keys.map((key) => (
          <div key={key.id} className="grid items-center gap-3 border-b border-line px-5 py-3.5 last:border-b-0 sm:grid-cols-[1fr_160px_90px]">
            <div><div className="flex items-center gap-2 text-[13px] font-medium">{key.name}<Badge tone={key.revoked_at ? "danger" : "success"} dot>{key.revoked_at ? "revoked" : "active"}</Badge></div><div className="mt-1 font-mono text-[11px] text-faint">{key.prefix}_••••••••••••••••</div></div>
            <div className="text-[11.5px] text-muted">{key.last_used_at ? `Used ${formatDate(key.last_used_at)}` : "Never used"}</div>
            <div className="text-right">{!key.revoked_at && <Button variant="danger" size="sm" onClick={() => void revoke(key.id)}>Revoke</Button>}</div>
          </div>
        )) : <EmptyState title="No API keys" description="Create a test key to manage the hosted catalog from your backend." />}
      </Card>
      <Card>
        <CardHeader title="Create a product with the API" description="This request proves the key is connected to a real, RLS-protected merchant identity." />
        <CodePanel filename="Terminal" code={curl} />
      </Card>
      <Modal open={secret !== null} onClose={() => setSecret(null)} title="Save your API key" width="max-w-xl">
        <div className="p-5">
          <div className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn-ink">This key is shown once. Store it in a server-side environment variable; never put it in browser code or Git.</div>
          {secret && <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#0a2540] px-3 py-3 font-mono text-[12px] text-white"><span className="min-w-0 flex-1 break-all">{secret}</span><CopyButton value={secret} /></div>}
          <div className="mt-4 flex justify-end"><Button variant="primary" onClick={() => setSecret(null)}>I saved the key</Button></div>
        </div>
      </Modal>
    </div>
  );
}

function ActivityTab({ attempts }: { attempts: MerchantAttempt[] }) {
  const approved = attempts.filter((attempt) => attempt.decision === "approved");
  const volume = approved.reduce((sum, attempt) => sum + attempt.amount_cents, 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3"><MetricCard label="Attempts" value={attempts.length} /><MetricCard label="Approved" value={approved.length} /><MetricCard label="Mock volume" value={usd(volume)} /></div>
      <Card>
        <CardHeader title="Checkout decisions" description="Merchant-side view; buyer identity, cards, and mandate details stay private." />
        {attempts.length ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-[12px]"><thead className="border-b border-line bg-[#fafbfc] text-[10.5px] uppercase tracking-[0.08em] text-faint"><tr><th className="px-5 py-2.5">Time</th><th className="px-4 py-2.5">Product</th><th className="px-4 py-2.5">Amount</th><th className="px-4 py-2.5">Decision</th><th className="px-5 py-2.5">Reason</th></tr></thead><tbody>{attempts.map((attempt) => <tr key={attempt.id} className="border-b border-line last:border-b-0"><td className="px-5 py-3 text-muted">{formatDate(attempt.created_at)}</td><td className="px-4 py-3 font-mono text-[10.5px]">{attempt.product_id}</td><td className="px-4 py-3 font-medium tabular">{usd(attempt.amount_cents)}</td><td className="px-4 py-3"><Badge tone={attempt.decision === "approved" ? "success" : attempt.decision === "refused" ? "danger" : "warn"} dot>{attempt.decision}</Badge></td><td className="px-5 py-3 text-muted">{attempt.reason_code ?? "—"}</td></tr>)}</tbody></table></div>
        ) : <EmptyState title="No checkout attempts yet" description="Create and approve a mandate for this merchant, then ask the agent to purchase an active product." />}
      </Card>
    </div>
  );
}

function SettingsTab({ merchant, onChange }: { merchant: DeveloperMerchant; onChange: () => Promise<void> }) {
  const [name, setName] = useState(merchant.name);
  const [description, setDescription] = useState(merchant.description ?? "");
  const [listed, setListed] = useState(merchant.publicly_listed);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await developerApi(`/api/developers/merchants/${merchant.id}`, { method: "PATCH", body: JSON.stringify({ name, description: description || null, publicly_listed: listed }) });
      await onChange();
      setMessage("Merchant settings saved.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  const canList = merchant.environment === "live" && merchant.verification_status === "verified";
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Merchant settings" description="The merchant ID and environment cannot change after creation." />
      <div className="space-y-4 p-5">
        <Field label="Merchant ID" hint="Immutable because active mandates may refer to it."><Input value={merchant.id} disabled /></Field>
        <Field label="Business name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Description"><Input value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
        <label className={cn("flex items-start gap-3 rounded-lg border border-line p-4", !canList && "opacity-55")}>
          <input type="checkbox" className="mt-0.5" checked={listed} disabled={!canList} onChange={(event) => setListed(event.target.checked)} />
          <span><span className="block text-[13px] font-medium">List as a supported store</span><span className="mt-0.5 block text-[11.5px] text-muted">Only verified live domains can appear in the public supported-store registry. Hosted test stores are never listed.</span></span>
        </label>
        {message && <div className={cn("rounded-md px-3 py-2 text-[12px]", message.endsWith("saved.") ? "bg-success-soft text-success-ink" : "bg-danger-soft text-danger-ink")}>{message}</div>}
        <div className="flex justify-end border-t border-line pt-4"><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>Save settings</Button></div>
      </div>
    </Card>
  );
}

function EndpointCard({ label, value, href }: { label: string; value: string; href?: string | null }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-center gap-2"><div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</div><CopyButton value={value} className="ml-auto text-muted hover:bg-line-2 hover:text-ink" /></div>
      <div className="mt-1 break-all font-mono text-[11.5px] text-ink-2">{value}</div>
      {href && <a href={href} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-brand-ink">Open <ExternalLink className="size-3" /></a>}
    </Card>
  );
}

function CodePanel({ filename, code }: { filename: string; code: string }) {
  return (
    <div className="overflow-hidden bg-[#0a2540] text-white">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2 text-[10.5px] text-white/45"><Circle className="size-2 fill-[#ff6b6b] text-[#ff6b6b]" /><Circle className="size-2 fill-[#ffd166] text-[#ffd166]" /><Circle className="size-2 fill-[#67d391] text-[#67d391]" /><span className="ml-2">{filename}</span><CopyButton value={code} className="ml-auto" /></div>
      <pre className="overflow-x-auto p-4 text-[11.5px] leading-5 text-[#e6edf3]"><code>{code}</code></pre>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
