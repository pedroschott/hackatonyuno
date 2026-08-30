"use client";

import { CheckCircle2, CreditCard, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/AppShell";
import { CardBrand } from "@/components/CardBrand";
import { Badge, Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { useStore } from "@/lib/store";

type Brand = "visa" | "mastercard";

export function PaymentMethodSetup({ token }: { token: string }) {
  const cards = useStore((state) => state.cards);
  const refresh = useStore((state) => state.refresh);
  const [brand, setBrand] = useState<Brand>("visa");
  const [last4, setLast4] = useState("");
  const [label, setLabel] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand, last4, label, make_default: makeDefault, setup_token: token }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save the payment method");
      await refresh();
      setSaved(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the payment method");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Secure payment setup"
        description="Add a payment method inside AgentPay, then return to your agent to continue the mandate."
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <Card>
          {saved ? (
            <div className="px-6 py-10 text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-soft text-success-ink">
                <CheckCircle2 className="size-7" />
              </div>
              <h1 className="mt-4 text-[20px] font-semibold">Payment method saved</h1>
              <p className="mx-auto mt-2 max-w-lg text-[13.5px] text-muted">
                Return to the agent. It can now see only the payment method ID, brand, and last four
                digits, then create the mandate for your passkey approval.
              </p>
              <Button className="mt-5" variant="primary" onClick={() => window.history.back()}>
                Return to the agent
              </Button>
            </div>
          ) : (
            <>
              <CardHeader
                title="Add payment method"
                description="This challenge build saves a mock vault reference plus display metadata. Do not enter a full card number."
                actions={<Badge tone="success">Agent-safe</Badge>}
              />
              <div className="space-y-5 px-5 py-5">
                {!token && (
                  <p className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger-ink">
                    This setup link is missing or invalid. Ask the agent for a new payment setup link.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[150px_1fr]">
                  <Field label="Brand">
                    <Select
                      aria-label="Card brand"
                      value={brand}
                      onChange={(event) => setBrand(event.target.value as Brand)}
                    >
                      <option value="visa">Visa</option>
                      <option value="mastercard">Mastercard</option>
                    </Select>
                  </Field>
                  <Field
                    label="Last four digits"
                    hint="Display data only. Never enter the full card number or security code."
                  >
                    <Input
                      aria-label="Last four digits"
                      autoComplete="off"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="4242"
                      value={last4}
                      onChange={(event) => setLast4(event.target.value.replace(/\D/g, "").slice(0, 4))}
                    />
                  </Field>
                </div>
                <Field label="Label (optional)" hint="For example, Personal or Work.">
                  <Input
                    aria-label="Payment method label"
                    maxLength={80}
                    placeholder="Personal"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </Field>
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={makeDefault}
                    onChange={(event) => setMakeDefault(event.target.checked)}
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  Make this my default payment method
                </label>
                {message && (
                  <p className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger-ink">
                    {message}
                  </p>
                )}
                <Button
                  className="w-full"
                  size="lg"
                  variant="primary"
                  icon={<CreditCard className="size-4" />}
                  loading={busy}
                  disabled={!token || last4.length !== 4}
                  onClick={save}
                >
                  Save payment method
                </Button>
              </div>
            </>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="What stays private" />
            <div className="space-y-3 px-5 py-4 text-[13px] text-ink-2">
              <p className="flex gap-2">
                <LockKeyhole className="mt-0.5 size-4 shrink-0 text-brand" />
                The agent never sees or uses a full card number, CVC, PIN, bank password, or vault credential.
              </p>
              <p className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success-ink" />
                Saving a card does not authorize a purchase. Every mandate still needs your passkey and remains limited and revocable.
              </p>
            </div>
          </Card>

          {cards.length > 0 && (
            <Card>
              <CardHeader title="Saved payment methods" description={`${cards.length} available`} />
              <div className="divide-y divide-line-2 px-5">
                {cards.map((card) => (
                  <div key={card.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-[13px]">
                    <CardBrand brand={card.brand} />
                    <span className="font-medium">•••• {card.last4}</span>
                    {card.isDefault && <Badge tone="brand">Default</Badge>}
                    <span className="text-muted sm:ml-auto">{card.label ?? card.brand}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
