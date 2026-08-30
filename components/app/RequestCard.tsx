"use client";

import { useState } from "react";
import { Smartphone } from "lucide-react";
import type { Mandate } from "@/lib/types";
import { useStore } from "@/lib/store";
import { mandateHash } from "@/lib/seed";
import { brl } from "@/lib/format";
import { endsIn, itemKinds, storeNames } from "@/lib/plain";
import { Button, Card, Modal } from "../ui";
import { Qr } from "../Qr";
import { PasskeyCeremony } from "../PasskeyCeremony";
import { agentLabel } from "./agent-label";

/** An agent has asked to be able to spend. Nothing happens until the person says yes. */
export function RequestCard({ mandate }: { mandate: Mandate }) {
  const base = useStore((s) => s.publicBaseUrl);
  const agents = useStore((s) => s.agents);
  const merchants = useStore((s) => s.merchants);
  const authorize = useStore((s) => s.authorizeMandate);
  const decline = useStore((s) => s.declineMandate);
  const [ceremony, setCeremony] = useState(false);
  const [phone, setPhone] = useState(false);
  const name = agentLabel(mandate, agents);
  const url = `${base}/m/mandates/${mandate.id}`;

  const where =
    mandate.scope.merchants.length > 0
      ? `${itemKinds(mandate.scope.categories)} at ${storeNames(merchants, mandate.scope.merchants)}`
      : "anything you allow";

  return (
    <Card className="ap-in overflow-hidden border-l-[3px] border-l-brand">
      <div className="px-5 py-4">
        <h3 className="text-[16px] font-semibold">{name} is asking to pay for you</h3>
        {mandate.natural_language_description && (
          <p className="mt-2 text-[14px] italic text-ink-2">“{mandate.natural_language_description}”</p>
        )}

        <dl className="mt-4 divide-y divide-line-2 rounded-md bg-canvas px-3">
          <Row k="Up to" v={`${brl(mandate.limits.per_purchase_cents)} per purchase`} />
          <Row k="This month" v={`${brl(mandate.limits.cumulative_cents)}, ${mandate.limits.max_uses} purchases`} />
          <Row k="For" v={where} />
          <Row k="Stops" v={endsIn(mandate.validity.expires_at)} />
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg" onClick={() => setCeremony(true)}>
            Allow
          </Button>
          <Button size="lg" onClick={() => decline(mandate.id)}>
            Not now
          </Button>
          <button
            onClick={() => setPhone(true)}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink sm:ml-auto"
          >
            <Smartphone className="size-4" /> Use my phone
          </button>
        </div>
      </div>

      <Modal open={phone} onClose={() => setPhone(false)} title="Approve on your phone" width="max-w-[360px]">
        <div className="flex flex-col items-center px-6 py-6 text-center">
          <Qr value={url} size={200} />
          <p className="mt-4 text-[13.5px] text-muted">Scan with your phone camera and confirm with Face ID.</p>
        </div>
      </Modal>

      <PasskeyCeremony
        open={ceremony}
        endpoint={`/api/mandates/${mandate.id}/authorize`}
        onClose={() => setCeremony(false)}
        challenge={mandateHash(mandate)}
        title={`Let ${name} pay for you?`}
        cta="Allow"
        successTitle="Allowed"
        successBody="Your agent can now pay within these limits."
        facts={[
          { label: "Up to", value: brl(mandate.limits.per_purchase_cents) },
          { label: "This month", value: brl(mandate.limits.cumulative_cents) },
          { label: "Purchases", value: mandate.limits.max_uses },
          { label: "Stops", value: endsIn(mandate.validity.expires_at) },
        ]}
        onComplete={async (pk) => {
          await authorize(mandate.id, pk);
          setTimeout(() => setCeremony(false), 800);
        }}
      />
    </Card>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-[13.5px]">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="text-right font-medium text-ink">{v}</dd>
    </div>
  );
}
