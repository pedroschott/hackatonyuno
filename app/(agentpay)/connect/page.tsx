"use client";

import { useEffect, useState } from "react";
import { Copy, Check, Plug } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/AppShell";
import { Button, Card, CardHeader, Modal } from "@/components/ui";
import { cn } from "@/lib/cn";

type App = {
  key: string;
  name: string;
  logo?: string;
  logoAlt?: string;
  tile: string;
  steps: string[];
  identifiers?: string[];
};

type OAuthGrant = {
  client: {
    id: string;
    name: string;
    uri: string;
  };
  granted_at: string;
};

type ConnectedApp = App & { connectionKey: string };

const APPS: App[] = [
  {
    key: "claude",
    name: "Claude",
    logo: "https://api.iconify.design/logos:claude-icon.svg",
    logoAlt: "Claude",
    tile: "bg-[#f4eee8]",
    identifiers: ["claude", "anthropic"],
    steps: [
      "Open Claude and go to Settings, then Connectors.",
      "Choose “Add custom connector” and paste the link below.",
      "Sign in to AgentPay when Claude asks you to.",
    ],
  },
  {
    key: "chatgpt",
    name: "ChatGPT",
    logo: "https://api.iconify.design/logos:openai-icon.svg",
    logoAlt: "ChatGPT",
    tile: "bg-white",
    identifiers: ["chatgpt", "openai", "gpt"],
    steps: [
      "Open ChatGPT and go to Settings, then Connectors.",
      "Choose to add a connector and paste the link below.",
      "Sign in to AgentPay when ChatGPT asks you to.",
    ],
  },
  {
    key: "openclaw",
    name: "OpenClaw",
    logo: "https://raw.githubusercontent.com/openclaw/openclaw/main/apps/ios/Sources/Assets.xcassets/AppIcon.appiconset/1024.png",
    logoAlt: "OpenClaw",
    tile: "bg-white",
    identifiers: ["openclaw"],
    steps: [
      "Open OpenClaw and go to its connectors or tools settings.",
      "Add a new connector and paste the link below.",
      "Sign in to AgentPay when OpenClaw asks you to.",
    ],
  },
  {
    key: "gemini",
    name: "Gemini",
    logo: "https://api.iconify.design/selfhst:google-gemini.svg",
    logoAlt: "Gemini",
    tile: "bg-white",
    identifiers: ["gemini"],
    steps: [
      "Open Gemini and go to its extensions or tools settings.",
      "Add a new connector and paste the link below.",
      "Sign in to AgentPay when Gemini asks you to.",
    ],
  },
  {
    key: "other",
    name: "Any MCP app",
    tile: "bg-ink-2",
    steps: [
      "Open your assistant's connector or tool settings.",
      "Add a new connector and paste the link below.",
      "Sign in to AgentPay when it asks you to.",
    ],
  },
];

function connectedApps(grants: OAuthGrant[]): ConnectedApp[] {
  const unique = new Map<string, ConnectedApp>();

  for (const grant of grants) {
    const fingerprint = `${grant.client.name} ${grant.client.uri}`.toLowerCase();
    const known = APPS.find((app) => app.identifiers?.some((identifier) => fingerprint.includes(identifier)));
    const fallback = APPS[APPS.length - 1];
    const app = known ?? { ...fallback, name: grant.client.name || fallback.name };
    const connectionKey = known?.key ?? grant.client.id;
    unique.set(connectionKey, { ...app, connectionKey });
  }

  return [...unique.values()];
}

export default function AgentsPage() {
  const base = useStore((s) => s.publicBaseUrl);
  const [selected, setSelected] = useState<App | null>(null);
  const [grants, setGrants] = useState<OAuthGrant[] | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const link = `${base}/mcp`;
  const connected = connectedApps(grants ?? []);

  useEffect(() => {
    let active = true;

    async function loadConnections() {
      try {
        const response = await fetch("/api/account", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not load connected agents");
        const account = (await response.json()) as { agent_connections?: OAuthGrant[] };
        if (!active) return;
        setGrants(Array.isArray(account.agent_connections) ? account.agent_connections : []);
        setConnectionError(false);
      } catch {
        if (!active) return;
        setGrants([]);
        setConnectionError(true);
      }
    }

    void loadConnections();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadConnections();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Agents"
        description="See which assistants are connected to AgentPay, or connect another one in about a minute."
      />

      <Card>
        <CardHeader
          title="Connected agents"
          description="These assistants currently have access to AgentPay through your account."
        />
        <div className="px-5 py-4" aria-live="polite">
          {grants === null ? (
            <p className="text-[13.5px] text-muted">Checking connections…</p>
          ) : connectionError ? (
            <p className="text-[13.5px] text-danger-ink" role="alert">
              Connection status is temporarily unavailable.
            </p>
          ) : connected.length === 0 ? (
            <p className="text-[13.5px] text-muted">No agents connected yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2.5" aria-label="Connected agents">
              {connected.map((app) => (
                <li
                  key={app.connectionKey}
                  className="flex min-w-[150px] items-center gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5"
                >
                  <span className={cn("flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg", app.tile)}>
                    {app.logo ? (
                      // External SVGs are brand-owned marks; keeping their source URL avoids shipping altered copies.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={app.logo} alt="" className="size-full object-contain p-2" />
                    ) : (
                      <Plug className="size-4 text-white" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{app.name}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[11.5px] font-medium text-success-ink">
                      <Check className="size-3" aria-hidden="true" /> Connected
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <section className="mt-6" aria-labelledby="connect-an-agent">
        <h2 id="connect-an-agent" className="text-[15px] font-semibold text-ink">
          Connect another agent
        </h2>
        <p className="mt-0.5 text-[13px] text-muted">
          Pick where your assistant lives. It still cannot charge anything until you sign a mandate.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {APPS.map((app) => (
            <button
              key={app.key}
              onClick={() => setSelected(app)}
              className="flex flex-col items-center gap-2.5 rounded-xl bg-white px-3 py-5 text-center shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-pop)]"
            >
              <span className={cn("flex size-11 items-center justify-center overflow-hidden rounded-xl", app.tile)}>
                {app.logo ? (
                  // External SVGs are brand-owned marks; keeping their source URL avoids shipping altered copies.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={app.logo} alt={app.logoAlt} className="size-full object-contain p-2" />
                ) : (
                  <Plug className="size-5 text-white" aria-hidden="true" />
                )}
              </span>
              <span className="text-[13.5px] font-medium">{app.name}</span>
            </button>
          ))}
        </div>
      </section>

      <Modal open={selected !== null} onClose={() => setSelected(null)} title={selected ? `Connect ${selected.name}` : ""} width="max-w-[460px]">
        {selected && (
          <div className="px-5 py-5 sm:px-6">
            <ol className="space-y-3">
              {selected.steps.map((step, i) => (
                <li key={step} className="flex gap-3 text-[14px] text-ink-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12.5px] font-semibold text-brand-ink">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>

            <div className="mt-4">
              <div className="mb-1.5 text-[12.5px] font-medium text-muted">Your AgentPay link</div>
              <div className="flex items-center gap-2 rounded-md bg-canvas px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{link}</span>
                <CopyButton text={link} />
              </div>
            </div>

            <p className="mt-4 text-[13.5px] text-muted">
              Then ask it to buy something. It requests a mandate here, and it cannot charge anything until you sign
              that mandate with your passkey.
            </p>

            <div className="mt-5 flex justify-end">
              <Button variant="primary" onClick={() => setSelected(null)}>
                Got it
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      size="sm"
      icon={ok ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        })
      }
    >
      {ok ? "Copied" : "Copy"}
    </Button>
  );
}
