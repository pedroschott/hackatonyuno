"use client";

import { useEffect, useState } from "react";
import { Ban, CreditCard, Pencil, Check, X, Clock, Store, Tag } from "lucide-react";
import type { Mandate, VaultCard } from "@/lib/types";
import { useStore, usageFor, type Actor } from "@/lib/store";
import { brl, dateTime, timeShort, untilText } from "@/lib/format";
import { Badge, Button, Card, Meter, Mono } from "../ui";
import { MandateJson } from "../MandateJson";
import { cn } from "@/lib/cn";

const MERCHANT_NAME: Record<string, string> = {
  mrc_autoparts: "AutoParts",
  mrc_harvest_market: "Harvest Market",
  mrc_city_basket: "City Basket",
  mrc_mare_botanicals: "Maré Botanicals",
  mrc_pneufast: "PneuFast",
};

export function MandateCard({ mandate, card, actor }: { mandate: Mandate; card?: VaultCard; actor: Actor }) {
  const attempts = useStore((s) => s.attempts);
  const revoke = useStore((s) => s.revokeMandate);
  const updateLimits = useStore((s) => s.updateLimits);
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const usage = usageFor({ attempts }, mandate.id);
  const active = mandate.status === "active";
  const expired = active && now > new Date(mandate.validity.expires_at).getTime();
  const status = mandate.status === "revoked" ? "revoked" : expired ? "expired" : mandate.status;

  return (
    <Card className={cn("overflow-hidden transition-shadow", status === "revoked" && "shadow-[0_0_0_1px_var(--color-danger)]")}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-[14px] font-semibold text-brand-ink">F</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">FleetBuyer</span>
            <Badge tone="brand">Intent Mandate</Badge>
            {status === "active" && <Badge tone="success" dot>Active</Badge>}
            {status === "revoked" && <Badge tone="danger" dot>Revoked</Badge>}
            {status === "expired" && <Badge tone="warn" dot>Expired</Badge>}
            {status === "draft" && <Badge>Draft</Badge>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
            <Mono>{mandate.id}</Mono>
            <span>·</span>
            <span>issued by {mandate.issuer.display_name}</span>
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          {status === "active" && !confirming && (
            <Button className="w-full sm:w-auto" variant="dangerSolid" size="lg" icon={<Ban className="size-4" />} onClick={() => setConfirming(true)}>
              Revoke
            </Button>
          )}
          {status === "active" && confirming && (
            <div className="ap-in flex w-full flex-wrap items-center gap-2 rounded-md bg-danger-soft px-2 py-1.5 sm:w-auto">
              <span className="text-[13px] text-danger-ink">Every later purchase fails. Revoke {mandate.id}?</span>
              <Button size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button
                size="sm"
                variant="dangerSolid"
                onClick={() => {
                  revoke(mandate.id, actor);
                  setConfirming(false);
                }}
              >
                Revoke now
              </Button>
            </div>
          )}
        </div>
      </div>

      {status === "revoked" && mandate.revoked_at && (
        <div className="ap-in flex items-start gap-2 border-y border-danger/20 bg-danger-soft px-5 py-2.5 text-[13px] leading-relaxed text-danger-ink">
          <Ban className="mt-[3px] size-4 shrink-0" />
          <p>
            Revoked at {timeShort(mandate.revoked_at)}. Registry status is <Mono className="bg-white/60 text-danger-ink">revoked</Mono> — the next agent
            attempt dies with <Mono className="bg-white/60 text-danger-ink">MANDATE_REVOKED</Mono>.
          </p>
        </div>
      )}

      {/* Limits */}
      <div className="grid grid-cols-1 gap-px border-y border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        <EditableMoney
          label="Per purchase"
          valueCents={mandate.limits.per_purchase_cents}
          disabled={status !== "active"}
          onSave={(v) => updateLimits(mandate.id, { per_purchase_cents: v }, actor)}
        />
        <EditableMoney
          label="Monthly cap"
          valueCents={mandate.limits.cumulative_cents}
          disabled={status !== "active"}
          onSave={(v) => updateLimits(mandate.id, { cumulative_cents: v }, actor)}
          sub={
            <div className="mt-2">
              <Meter value={usage.spent} max={mandate.limits.cumulative_cents} tone={usage.spent >= mandate.limits.cumulative_cents ? "danger" : "brand"} />
              <div className="mt-1 text-[11.5px] text-muted tabular">{brl(usage.spent)} spent</div>
            </div>
          }
        />
        <EditableNumber
          label="Uses / month"
          value={mandate.limits.max_uses}
          disabled={status !== "active"}
          onSave={(v) => updateLimits(mandate.id, { max_uses: v }, actor)}
          display={(v) => `${usage.uses} / ${v}`}
          sub={
            <div className="mt-2">
              <Meter value={usage.uses} max={mandate.limits.max_uses} tone={usage.uses >= mandate.limits.max_uses ? "danger" : "brand"} />
              <div className="mt-1 text-[11.5px] text-muted">{Math.max(0, mandate.limits.max_uses - usage.uses)} remaining</div>
            </div>
          }
        />
        <div className="bg-surface px-5 py-3.5">
          <div className="text-[11.5px] font-medium uppercase tracking-wide text-faint">Valid until</div>
          <div className="mt-0.5 text-[15px] font-semibold tabular">{dateTime(mandate.validity.expires_at)}</div>
          <div className={cn("mt-1 inline-flex items-center gap-1 text-[11.5px]", status === "expired" ? "text-danger-ink" : "text-muted")}>
            <Clock className="size-3" /> {untilText(mandate.validity.expires_at, now)}
          </div>
        </div>
      </div>

      {/* Scope + payment */}
      <div className="grid grid-cols-1 gap-4 px-5 py-4 text-[13px] sm:grid-cols-3">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-faint">
            <Store className="size-3" /> Merchants
          </div>
          <div className="flex flex-wrap gap-1">
            {mandate.scope.merchants.map((m) => (
              <Badge key={m}>{MERCHANT_NAME[m] ?? m}</Badge>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-faint">
            <Tag className="size-3" /> Categories
          </div>
          <div className="flex flex-wrap gap-1">
            {mandate.scope.categories.map((c) => (
              <Badge key={c}>{c}</Badge>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-faint">
            <CreditCard className="size-3" /> Payment
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CardBrand brand={card?.brand ?? "mastercard"} />
            <span className="font-medium">•••• {card?.last4 ?? "????"}</span>
            <span className="text-[12px] text-muted">vault ref only</span>
          </div>
        </div>
      </div>

      <div className="px-5 pb-4">
        <MandateJson mandate={mandate} />
      </div>
    </Card>
  );
}

export function CardBrand({ brand }: { brand: "mastercard" | "visa" }) {
  if (brand === "visa")
    return <span className="rounded bg-[#1a1f71] px-1.5 py-0.5 font-mono text-[10px] font-bold italic text-white">VISA</span>;
  return (
    <span className="inline-flex" aria-label="Mastercard">
      <span className="size-4 rounded-full bg-[#eb001b]" />
      <span className="-ml-1.5 size-4 rounded-full bg-[#f79e1b] opacity-90" />
    </span>
  );
}

function EditableMoney({ label, valueCents, onSave, disabled, sub }: { label: string; valueCents: number; onSave: (v: number) => void; disabled?: boolean; sub?: React.ReactNode }) {
  return (
    <EditableBase label={label} value={valueCents} onSave={onSave} disabled={disabled} sub={sub} display={(v) => brl(v)} toInput={(v) => String(Math.round(v / 100))} fromInput={(s) => Math.round(Number(s) * 100)} prefix="R$" />
  );
}

function EditableNumber({ label, value, onSave, disabled, sub, display }: { label: string; value: number; onSave: (v: number) => void; disabled?: boolean; sub?: React.ReactNode; display: (v: number) => string }) {
  return <EditableBase label={label} value={value} onSave={onSave} disabled={disabled} sub={sub} display={display} toInput={String} fromInput={(s) => Math.max(1, Math.round(Number(s)))} />;
}

function EditableBase({ label, value, onSave, disabled, sub, display, toInput, fromInput, prefix }: { label: string; value: number; onSave: (v: number) => void; disabled?: boolean; sub?: React.ReactNode; display: (v: number) => string; toInput: (v: number) => string; fromInput: (s: string) => number; prefix?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [flash, setFlash] = useState(false);
  const start = () => {
    setDraft(toInput(value));
    setEditing(true);
  };
  const commit = () => {
    const v = fromInput(draft);
    if (Number.isFinite(v) && v !== value) {
      onSave(v);
      setFlash(true);
      setTimeout(() => setFlash(false), 900);
    }
    setEditing(false);
  };
  return (
    <div className="group bg-surface px-5 py-3.5">
      <div className="text-[11.5px] font-medium uppercase tracking-wide text-faint">{label}</div>
      {editing ? (
        <div className="mt-0.5 flex items-center gap-1">
          {prefix && <span className="text-[13px] text-muted">{prefix}</span>}
          <input
            autoFocus
            type="number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-7 w-24 rounded border border-brand px-1.5 text-[14px] font-semibold tabular focus:outline-none focus:shadow-[var(--shadow-focus)]"
          />
          <button onClick={commit} className="rounded p-1 text-success hover:bg-success-soft" aria-label="Save">
            <Check className="size-3.5" />
          </button>
          <button onClick={() => setEditing(false)} className="rounded p-1 text-muted hover:bg-line-2" aria-label="Cancel">
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={start}
          disabled={disabled}
          className={cn("mt-0.5 inline-flex items-center gap-1.5 rounded text-left text-[15px] font-semibold tabular transition-colors", flash && "text-brand", !disabled && "hover:text-brand")}
          title={disabled ? undefined : "Edit limit"}
        >
          {display(value)}
          {!disabled && <Pencil className="size-3 text-faint opacity-0 transition-opacity group-hover:opacity-100" />}
        </button>
      )}
      {sub}
    </div>
  );
}
