"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { useStore } from "@/lib/store";
import { effectiveStatus } from "@/lib/engine";
import { mandateHash } from "@/lib/seed";
import { brl } from "@/lib/format";
import { endsIn, itemKinds, storeNames } from "@/lib/plain";
import { Badge, Button } from "@/components/ui";
import { PasskeyCeremony } from "@/components/PasskeyCeremony";
import { CardBrand } from "@/components/CardBrand";
import { agentLabel } from "@/components/app/agent-label";
import { KV, StickyActions, Status } from "@/components/mobile/bits";

export default function MandateSheet() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mandate = useStore((s) => s.mandates.find((m) => m.id === id));
  const cards = useStore((s) => s.cards);
  const agents = useStore((s) => s.agents);
  const merchants = useStore((s) => s.merchants);
  const authorize = useStore((s) => s.authorizeMandate);
  const decline = useStore((s) => s.declineMandate);
  const revoke = useStore((s) => s.revokeMandate);
  const [ceremony, setCeremony] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  if (!mandate)
    return (
      <Status
        tone="neutral"
        title="Not found"
        body={
          <Link className="underline" href="/m">
            Back
          </Link>
        }
      />
    );

  const status = effectiveStatus(mandate);
  const card = cards.find((c) => c.id === mandate.payment.vault_card_id);
  const name = agentLabel(mandate, agents);
  const rows = [
    { k: "Up to", v: `${brl(mandate.limits.per_purchase_cents)} per purchase` },
    { k: "This month", v: `${brl(mandate.limits.cumulative_cents)}, ${mandate.limits.max_uses} purchases` },
    ...(mandate.scope.merchants.length > 0
      ? [{ k: "Only for", v: `${itemKinds(mandate.scope.categories)} at ${storeNames(merchants, mandate.scope.merchants)}` }]
      : []),
    { k: "Stops", v: endsIn(mandate.validity.expires_at) },
    {
      k: "Pays with",
      v: (
        <span className="inline-flex items-center gap-1.5">
          <CardBrand brand={card?.brand ?? "mastercard"} /> •••• {card?.last4 ?? "????"}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-1 flex-col space-y-4">
      <div className="rounded-lg bg-white px-4 py-4 shadow-[var(--shadow-card)]">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold">{name} is asking to pay for you</div>
          </div>
          {status === "draft" && <Badge tone="brand">New</Badge>}
          {status === "active" && (
            <Badge tone="success" dot>
              Can spend
            </Badge>
          )}
          {status === "revoked" && <Badge tone="danger">Turned off</Badge>}
          {status === "declined" && <Badge tone="danger">Declined</Badge>}
          {status === "expired" && <Badge tone="warn">Ended</Badge>}
        </div>
        {mandate.natural_language_description && (
          <blockquote className="mt-3 border-l-2 border-brand pl-3 text-[14px] leading-snug text-ink-2">
            “{mandate.natural_language_description}”
          </blockquote>
        )}
      </div>

      <KV rows={rows} />

      {status === "active" && (
        <Status tone="success" title="Allowed" body={<>{name} can pay within these limits. You can turn it off at any time.</>} />
      )}
      {status === "revoked" && <Status tone="danger" title="Turned off" body="Anything it tries from now on is declined." />}
      {status === "declined" && <Status tone="danger" title="Declined" body="Nothing was allowed." />}
      {status === "expired" && <Status tone="warn" title="Ended" body="This permission ran out. Nothing more can be paid with it." />}

      <p className="px-1 text-[12.5px] text-faint">
        You approve with Face ID or Touch ID on this device. Your card details are never shared with the agent or the store.
      </p>

      {status === "draft" && (
        <StickyActions>
          <Button
            size="lg"
            className="flex-1"
            onClick={async () => {
              await decline(mandate.id, "user");
              router.push("/m");
            }}
          >
            Not now
          </Button>
          <Button size="lg" variant="primary" className="flex-[2]" onClick={() => setCeremony(true)}>
            Allow
          </Button>
        </StickyActions>
      )}
      {status === "active" && (
        <StickyActions>
          {!confirmRevoke ? (
            <>
              <Link href="/m" className="flex-1">
                <Button size="lg" className="w-full">
                  Done
                </Button>
              </Link>
              <Button size="lg" variant="danger" className="flex-1" icon={<ShieldOff className="size-4" />} onClick={() => setConfirmRevoke(true)}>
                Turn off
              </Button>
            </>
          ) : (
            <>
              <Button size="lg" className="flex-1" onClick={() => setConfirmRevoke(false)}>
                Keep it on
              </Button>
              <Button
                size="lg"
                variant="dangerSolid"
                className="flex-[2]"
                loading={revoking}
                onClick={async () => {
                  setRevoking(true);
                  setRevokeError(null);
                  try {
                    await revoke(mandate.id, "user");
                    setConfirmRevoke(false);
                  } catch (cause) {
                    setRevokeError(cause instanceof Error ? cause.message : "Revocation failed");
                  } finally {
                    setRevoking(false);
                  }
                }}
              >
                Turn off spending
              </Button>
            </>
          )}
        </StickyActions>
      )}
      {revokeError && <p className="px-1 text-[12px] text-danger-ink">{revokeError}</p>}
      {(status === "revoked" || status === "declined" || status === "expired") && (
        <StickyActions>
          <Link href="/m" className="flex-1">
            <Button size="lg" className="w-full">
              Back
            </Button>
          </Link>
        </StickyActions>
      )}

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
    </div>
  );
}
