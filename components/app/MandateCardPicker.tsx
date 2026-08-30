"use client";

import { useState } from "react";

import type { Mandate } from "@/lib/types";
import { useStore } from "@/lib/store";
import { Field, Select } from "@/components/ui";

export function MandateCardPicker({ mandate }: { mandate: Mandate }) {
  const cards = useStore((state) => state.cards);
  const refresh = useStore((state) => state.refresh);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (mandate.status !== "draft" || cards.length < 2) return null;

  return (
    <Field
      label="Payment method"
      hint={message ?? "This choice becomes part of the passkey-signed mandate. Changing your account default later will not change it."}
      error={message?.startsWith("Could not") ? message : undefined}
    >
      <Select
        aria-label="Payment method for this mandate"
        value={mandate.payment.vault_card_id}
        disabled={busy}
        onChange={async (event) => {
          const nextCardId = event.target.value;
          setBusy(true);
          setMessage(null);
          try {
            const response = await fetch(`/api/mandates/${mandate.id}/payment`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ vault_card_id: nextCardId }),
            });
            const result = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(result.error ?? "Could not change the payment method");
            await refresh();
            setMessage("Payment method updated. Review the choice before you authorize the mandate.");
          } catch (error) {
            setMessage(error instanceof Error ? `Could not update: ${error.message}` : "Could not update the payment method");
          } finally {
            setBusy(false);
          }
        }}
      >
        {cards.map((card) => (
          <option key={card.id} value={card.id}>
            {card.label ? `${card.label} · ` : ""}
            {card.brand === "visa" ? "Visa" : "Mastercard"} ending in {card.last4}
            {card.isDefault ? " · Default" : ""}
          </option>
        ))}
      </Select>
    </Field>
  );
}
