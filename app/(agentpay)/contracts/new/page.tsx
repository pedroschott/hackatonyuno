"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, Plus, ShieldCheck, Bot } from "lucide-react";
import { useStore } from "@/lib/store";
import type { Mandate, MandateLimits } from "@/lib/types";
import { CFO, mandateHash } from "@/lib/seed";
import { randomId } from "@/lib/hash";
import { brl, dateTime, nextSunday2359, toLocalInputValue } from "@/lib/format";
import { PageHeader } from "@/components/AppShell";
import { Button, Card, CardHeader, Field, Input, MoneyInput, Select, Badge, Mono } from "@/components/ui";
import { MandateJson } from "@/components/MandateJson";
import { PasskeyCeremony } from "@/components/PasskeyCeremony";
import { CardBrand } from "@/components/dashboard/MandateCard";
import { cn } from "@/lib/cn";

const CATEGORIES = [
  "automotive.tires",
  "automotive.accessories",
  "food.grains.rice",
  "food.meat.poultry",
  "food.prepared.burgers",
  "beauty.skincare",
  "beauty.oils",
];

export default function NewContractPage() {
  const router = useRouter();
  const agent = useStore((s) => s.agents[0]);
  const merchants = useStore((s) => s.merchants);
  const cards = useStore((s) => s.cards);
  const addCard = useStore((s) => s.addCard);
  const createDraft = useStore((s) => s.createDraft);
  const authorize = useStore((s) => s.authorizeMandate);

  // Fixed at mount so the preview hash is exactly the challenge the passkey signs.
  const [draftId] = useState(() => randomId("mnd", 4));
  const [notBefore] = useState(() => new Date().toISOString());
  const [now, setNow] = useState(() => new Date(notBefore).getTime());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const [merchantIds, setMerchantIds] = useState<string[]>(["mrc_autoparts"]);
  const [categories, setCategories] = useState<string[]>(["automotive.tires"]);
  const [limits, setLimits] = useState<MandateLimits>({ per_purchase_cents: 160_000, cumulative_cents: 400_000, max_uses: 3, period: "month", currency: "USD" });
  const [expires, setExpires] = useState(() => toLocalInputValue(nextSunday2359()));
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const [addingCard, setAddingCard] = useState(false);
  const [newCard, setNewCard] = useState({ brand: "visa" as "visa" | "mastercard", last4: "" });
  const [ceremony, setCeremony] = useState(false);
  const [pendingMandate, setPendingMandate] = useState<Mandate | null>(null);
  const [done, setDone] = useState<Mandate | null>(null);

  const expiresIso = useMemo(() => (expires ? new Date(expires).toISOString() : ""), [expires]);

  const draft: Mandate = useMemo(
    () => ({
      id: draftId,
      type: "intent",
      issuer: CFO,
      agent: { agent_id: agent.id, public_key: agent.publicKey },
      scope: { merchants: merchantIds, categories },
      limits,
      validity: { not_before: notBefore, expires_at: expiresIso },
      payment: { vault_card_id: cardId },
      status: "draft",
      created_at: notBefore,
    }),
    [draftId, agent, merchantIds, categories, limits, notBefore, expiresIso, cardId],
  );
  const challenge = useMemo(() => mandateHash(draft), [draft]);

  const errors: Record<string, string> = {};
  if (merchantIds.length === 0) errors.merchants = "Pick at least one merchant.";
  if (categories.length === 0) errors.categories = "Pick at least one category.";
  if (limits.per_purchase_cents <= 0) errors.per = "Must be greater than zero.";
  if (limits.cumulative_cents < limits.per_purchase_cents) errors.cum = "Monthly cap must be at least the per-purchase limit.";
  if (!expiresIso || new Date(expiresIso).getTime() <= now) errors.expires = "Must be in the future.";
  if (!cardId) errors.card = "Select a payment method.";
  const valid = Object.keys(errors).length === 0;

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const selectedCard = cards.find((c) => c.id === cardId);
  const merchantNames = merchantIds.map((id) => merchants.find((m) => m.id === id)?.name ?? id);

  return (
    <>
      <PageHeader title="New contract" description="An AP2 Intent Mandate: what FleetBuyer may buy, how much, until when, paid with what." />

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-6">
        {/* Form */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Agent" description="Identity is a signed request, not a User-Agent string." />
            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-ink">
                <Bot className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                  {agent.name} <Mono>{agent.id}</Mono>
                </div>
                <div className="mt-0.5 truncate text-[12px] text-muted">
                  Ed25519 <Mono>{agent.publicKey.slice(0, 28)}…</Mono>
                </div>
              </div>
              <Badge tone="success" dot>Registered</Badge>
            </div>
          </Card>

          <Card>
            <CardHeader title="Scope" description="Where and what the agent may buy. Everything else is refused." />
            <div className="grid grid-cols-1 gap-5 px-5 py-4 sm:grid-cols-2">
              <Field label="Merchants" error={errors.merchants}>
                <ChipGroup>
                  {merchants.map((m) => (
                    <Chip key={m.id} active={merchantIds.includes(m.id)} onClick={() => toggle(merchantIds, setMerchantIds, m.id)}>
                      {m.name} <span className="font-mono text-[11px] opacity-60">{m.id}</span>
                    </Chip>
                  ))}
                </ChipGroup>
              </Field>
              <Field label="Categories" error={errors.categories}>
                <ChipGroup>
                  {CATEGORIES.map((c) => (
                    <Chip key={c} active={categories.includes(c)} onClick={() => toggle(categories, setCategories, c)}>
                      {c}
                    </Chip>
                  ))}
                </ChipGroup>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Limits" description="Per purchase escalates to you; cumulative and uses refuse hard." />
            <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Per purchase" error={errors.per}>
                <MoneyInput valueCents={limits.per_purchase_cents} onChange={(v) => setLimits({ ...limits, per_purchase_cents: v })} />
              </Field>
              <Field label="Monthly cap" error={errors.cum}>
                <MoneyInput valueCents={limits.cumulative_cents} onChange={(v) => setLimits({ ...limits, cumulative_cents: v })} />
              </Field>
              <Field label="Max uses">
                <Input type="number" min={1} value={limits.max_uses} onChange={(e) => setLimits({ ...limits, max_uses: Math.max(1, Number(e.target.value) || 1) })} />
              </Field>
              <Field label="Period">
                <Select value={limits.period} onChange={() => {}}>
                  <option value="month">per month</option>
                </Select>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Validity" description="After this moment every attempt fails with MANDATE_EXPIRED." />
            <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
              <Field label="Not before">
                <Input value={dateTime(notBefore)} disabled />
              </Field>
              <Field label="Expires at" error={errors.expires}>
                <Input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Preset onClick={() => setExpires(toLocalInputValue(endOfDay()))}>Tonight 23:59</Preset>
                  <Preset onClick={() => setExpires(toLocalInputValue(nextSunday2359()))}>Sunday 23:59</Preset>
                  <Preset onClick={() => setExpires(toLocalInputValue(endOfMonth()))}>End of month</Preset>
                </div>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Payment method"
              description="The mandate references a vault card. We store the last 4 digits and a reference — never a PAN."
              actions={
                !addingCard && (
                  <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAddingCard(true)}>
                    Add card
                  </Button>
                )
              }
            />
            <div className="px-5 py-3">
              {errors.card && <p className="mb-2 text-[12px] text-danger-ink">{errors.card}</p>}
              <div className="divide-y divide-line-2">
                {cards.map((c) => (
                  <label key={c.id} className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13.5px]">
                    <input type="radio" name="card" checked={cardId === c.id} onChange={() => setCardId(c.id)} className="accent-brand" />
                    <CardBrand brand={c.brand} />
                    <span className="font-medium">•••• {c.last4}</span>
                    <span className="text-muted">{c.label ?? (c.brand === "visa" ? "Visa" : "Mastercard")}</span>
                    <Mono className="sm:ml-auto">{c.id}</Mono>
                  </label>
                ))}
              </div>
              {addingCard && (
                <div className="ap-in mt-2 grid grid-cols-1 items-end gap-2 rounded-md bg-canvas p-3 sm:grid-cols-[120px_1fr_auto_auto]">
                  <Field label="Brand">
                    <Select value={newCard.brand} onChange={(e) => setNewCard({ ...newCard, brand: e.target.value as "visa" | "mastercard" })}>
                      <option value="visa">Visa</option>
                      <option value="mastercard">Mastercard</option>
                    </Select>
                  </Field>
                  <Field label="Last four digits" hint="Display data only. Never enter the full card number.">
                    <Input
                      aria-label="Last four digits"
                      autoComplete="off"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="4242"
                      value={newCard.last4}
                      onChange={(e) => setNewCard({ ...newCard, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                    />
                  </Field>
                  <Button className="sm:mb-[22px]" onClick={() => setAddingCard(false)}>Cancel</Button>
                  <Button
                    className="sm:mb-[22px]"
                    variant="primary"
                    disabled={newCard.last4.length !== 4}
                    onClick={async () => {
                      const c = await addCard({ brand: newCard.brand, last4: newCard.last4, label: newCard.brand === "visa" ? "Visa" : "Mastercard" });
                      setCardId(c.id);
                      setNewCard({ brand: "visa", last4: "" });
                      setAddingCard(false);
                    }}
                  >
                    Save to vault
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Preview */}
        <div className="space-y-4 xl:sticky xl:top-7">
          <Card>
            <CardHeader title="Intent Mandate" description="Plain-language summary of what you’re signing." />
            <div className="px-5 py-4 text-[14px] leading-relaxed text-ink-2">
              <b className="text-ink">FleetBuyer</b> may buy <b className="text-ink">{categories.join(", ") || "—"}</b> at{" "}
              <b className="text-ink">{merchantNames.join(", ") || "—"}</b>, up to <b className="text-ink">{brl(limits.per_purchase_cents)}</b> per purchase,{" "}
              <b className="text-ink">{brl(limits.cumulative_cents)}</b> per month, max <b className="text-ink">{limits.max_uses}</b> purchases, until{" "}
              <b className="text-ink">{expiresIso ? dateTime(expiresIso) : "—"}</b>, paid with{" "}
              <b className="text-ink">{selectedCard ? `${selectedCard.brand === "visa" ? "Visa" : "Mastercard"} •••• ${selectedCard.last4}` : "—"}</b>.
            </div>
            <div className="border-t border-line px-5 py-4">
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                icon={<Fingerprint className="size-4" />}
                disabled={!valid}
                onClick={async () => {
                  const mandate = await createDraft({
                    scope: draft.scope,
                    limits,
                    validity: draft.validity,
                    vault_card_id: cardId,
                  });
                  setPendingMandate(mandate);
                  setCeremony(true);
                }}
              >
                Authorize with passkey
              </Button>
              <p className="mt-2 text-center text-[12px] text-muted">
                <ShieldCheck className="mr-1 inline size-3.5 align-[-2px]" />
                Phishing-resistant, device-bound. Same model Pix uses.
              </p>
            </div>
          </Card>
          <MandateJson mandate={draft} />
        </div>
      </div>

      <PasskeyCeremony
        open={ceremony}
        endpoint={pendingMandate ? `/api/mandates/${pendingMandate.id}/authorize` : "/api/mandates/unavailable/authorize"}
        onClose={() => {
          setCeremony(false);
          if (done) router.push("/dashboard");
        }}
        challenge={pendingMandate ? mandateHash(pendingMandate) : challenge}
        title="Authorize this mandate"
        successTitle="Mandate active"
        facts={[
          { label: "Agent", value: agent.name },
          { label: "Scope", value: `${categories.join(", ")} · ${merchantNames.join(", ")}` },
          { label: "Per purchase", value: brl(limits.per_purchase_cents) },
          { label: "Monthly", value: `${brl(limits.cumulative_cents)} · ${limits.max_uses}×` },
          { label: "Until", value: expiresIso ? dateTime(expiresIso) : "—" },
          { label: "Pays with", value: selectedCard ? `•••• ${selectedCard.last4}` : "—" },
        ]}
        onComplete={async (pk) => {
          if (!pendingMandate) throw new Error("Mandate draft was not created");
          const active = await authorize(pendingMandate.id, pk);
          setDone(active);
          setTimeout(() => router.push("/dashboard"), 1200);
        }}
      />
    </>
  );
}

function ChipGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors",
        active ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-white text-ink-2 hover:bg-canvas",
      )}
    >
      {children}
    </button>
  );
}
function Preset({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded border border-line bg-white px-1.5 py-0.5 text-[11.5px] text-ink-2 hover:bg-canvas">
      {children}
    </button>
  );
}
function endOfDay() {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d;
}
function endOfMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 0);
  d.setHours(23, 59, 0, 0);
  return d;
}
