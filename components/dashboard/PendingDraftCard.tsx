"use client";

import { useState } from "react";
import { Bot, Fingerprint, Smartphone, ExternalLink } from "lucide-react";
import type { Mandate } from "@/lib/types";
import { useStore } from "@/lib/store";
import { mandateHash } from "@/lib/seed";
import { brl, dateTime, relative } from "@/lib/format";
import { Badge, Button, Card, Mono } from "../ui";
import { Qr } from "../Qr";
import { PasskeyCeremony } from "../PasskeyCeremony";

const MERCHANT_NAME: Record<string, string> = { mrc_autoparts: "AutoParts", mrc_pneufast: "PneuFast" };

export function PendingDraftCard({ mandate }: { mandate: Mandate }) {
  const base = useStore((s) => s.publicBaseUrl);
  const authorize = useStore((s) => s.authorizeMandate);
  const decline = useStore((s) => s.declineMandate);
  const [ceremony, setCeremony] = useState(false);
  const url = `${base}/m/mandates/${mandate.id}`;
  const merchants = mandate.scope.merchants.map((m) => MERCHANT_NAME[m] ?? m).join(", ");

  return (
    <Card className="ap-in overflow-hidden border-l-[3px] border-l-brand">
      <div className="flex flex-col gap-4 px-5 py-4 md:flex-row md:gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
              <Bot className="size-4" />
            </div>
            <span className="text-[14px] font-semibold">{mandate.origin?.requested_by ?? "Agent"} requested a mandate</span>
            <Badge tone="brand">{mandate.origin?.via === "api" ? "via API" : "via panel"}</Badge>
            <span className="text-[12px] text-muted sm:ml-auto">{relative(mandate.created_at)}</span>
          </div>
          {mandate.natural_language_description && (
            <blockquote className="mt-2 border-l-2 border-line pl-3 text-[13.5px] text-ink-2">“{mandate.natural_language_description}”</blockquote>
          )}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
            <Fact k="Scope" v={`${mandate.scope.categories.join(", ")} · ${merchants}`} />
            <Fact k="Per purchase" v={brl(mandate.limits.per_purchase_cents)} />
            <Fact k="Monthly" v={`${brl(mandate.limits.cumulative_cents)} · ${mandate.limits.max_uses}×`} />
            <Fact k="Until" v={dateTime(mandate.validity.expires_at)} />
            <Fact k="Mandate" v={<Mono>{mandate.id}</Mono>} />
            <Fact k="Hash" v={<Mono>{mandateHash(mandate).slice(0, 12)}…</Mono>} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Fingerprint className="size-4" />} onClick={() => setCeremony(true)}>
              Approve here
            </Button>
            <Button onClick={() => decline(mandate.id)}>Decline</Button>
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-[12.5px] text-muted hover:text-ink sm:ml-auto">
              <ExternalLink className="size-3.5 shrink-0" /> <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
            </a>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1.5 self-start md:self-auto">
          <Qr value={url} size={128} />
          <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
            <Smartphone className="size-3.5" /> Approve on your phone
          </span>
        </div>
      </div>
      <PasskeyCeremony
        open={ceremony}
        endpoint={`/api/mandates/${mandate.id}/authorize`}
        onClose={() => setCeremony(false)}
        challenge={mandateHash(mandate)}
        title="Authorize this mandate"
        successTitle="Mandate active"
        facts={[
          { label: "Requested by", value: mandate.origin?.requested_by ?? "Agent" },
          { label: "Scope", value: `${mandate.scope.categories.join(", ")} · ${merchants}` },
          { label: "Per purchase", value: brl(mandate.limits.per_purchase_cents) },
          { label: "Monthly", value: `${brl(mandate.limits.cumulative_cents)} · ${mandate.limits.max_uses}×` },
          { label: "Until", value: dateTime(mandate.validity.expires_at) },
        ]}
        onComplete={async (pk) => {
          await authorize(mandate.id, pk);
          setTimeout(() => setCeremony(false), 900);
        }}
      />
    </Card>
  );
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-faint">{k}</div>
      <div className="truncate font-medium text-ink">{v}</div>
    </div>
  );
}

export function PhoneQrButton() {
  const base = useStore((s) => s.publicBaseUrl);
  const [open, setOpen] = useState(false);
  const url = `${base}/m`;
  return (
    <>
      <Button icon={<Smartphone className="size-4" />} onClick={() => setOpen(true)}>
        Open on phone
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
          <div className="ap-in flex w-full max-w-[380px] flex-col items-center rounded-xl bg-white px-6 py-6 text-center shadow-[var(--shadow-pop)]" onMouseDown={(e) => e.stopPropagation()}>
            <Qr value={url} size={220} />
            <div className="mt-4 text-[15px] font-semibold">The kill switch, in your pocket</div>
            <p className="mt-1 text-[13px] text-muted">Scan to open the mobile inbox: approve mandates with Face ID, approve exceptions, revoke anytime.</p>
            <a href={url} target="_blank" rel="noreferrer" className="mt-3 break-all font-mono text-[12px] text-brand-ink underline-offset-2 hover:underline">
              {url}
            </a>
            {!/^https:/.test(base) && (
              <p className="mt-3 rounded bg-warn-soft px-2 py-1 text-[11.5px] text-warn-ink">
                WebAuthn requires HTTPS on another device. Use the Vercel deployment or run <Mono>npm run tunnel</Mono>.
              </p>
            )}
            <Button className="mt-4" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </div>
      )}
    </>
  );
}
