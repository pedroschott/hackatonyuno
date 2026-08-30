"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Fingerprint, Ban, Bot } from "lucide-react";
import { useStore } from "@/lib/store";
import { effectiveStatus } from "@/lib/engine";
import { mandateHash } from "@/lib/seed";
import { brl, dateTime, relative, untilText } from "@/lib/format";
import { Badge, Button, Mono } from "@/components/ui";
import { PasskeyCeremony } from "@/components/PasskeyCeremony";
import { MandateJson } from "@/components/MandateJson";
import { CardBrand } from "@/components/dashboard/MandateCard";
import { KV, StickyActions, Status } from "@/components/mobile/bits";

const MERCHANT_NAME: Record<string, string> = {
  mrc_autoparts: "AutoParts",
  mrc_harvest_market: "Harvest Market",
  mrc_city_basket: "City Basket",
  mrc_mare_botanicals: "Maré Botanicals",
  mrc_pneufast: "PneuFast",
};

export default function MandateSheet() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mandate = useStore((s) => s.mandates.find((m) => m.id === id));
  const cards = useStore((s) => s.cards);
  const authorize = useStore((s) => s.authorizeMandate);
  const decline = useStore((s) => s.declineMandate);
  const revoke = useStore((s) => s.revokeMandate);
  const [ceremony, setCeremony] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  if (!mandate) return <Status tone="neutral" title="Mandate not found" body={<Link className="underline" href="/m">Back to inbox</Link>} />;

  const status = effectiveStatus(mandate);
  const card = cards.find((c) => c.id === mandate.payment.vault_card_id);
  const requester = mandate.origin?.requested_by ?? "Your agent";
  const merchants = mandate.scope.merchants.map((m) => MERCHANT_NAME[m] ?? m).join(", ");
  const rows = [
    { k: "Where", v: merchants },
    { k: "What", v: mandate.scope.categories.join(", ") },
    { k: "Per purchase", v: brl(mandate.limits.per_purchase_cents) },
    { k: "Monthly cap", v: `${brl(mandate.limits.cumulative_cents)} · ${mandate.limits.max_uses}×` },
    { k: "Until", v: dateTime(mandate.validity.expires_at) },
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
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
            <Bot className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">{requester} is asking for a mandate</div>
            <div className="text-[12.5px] text-muted">
              for <b className="text-ink">FleetBuyer</b> · {relative(mandate.origin?.requested_at ?? mandate.created_at)}
            </div>
          </div>
          {status === "draft" && <Badge tone="brand">Pending</Badge>}
          {status === "active" && <Badge tone="success" dot>Active</Badge>}
          {status === "revoked" && <Badge tone="danger" dot>Revoked</Badge>}
          {status === "declined" && <Badge tone="danger">Declined</Badge>}
          {status === "expired" && <Badge tone="warn">Expired</Badge>}
        </div>
        {mandate.natural_language_description && (
          <blockquote className="mt-3 border-l-2 border-brand pl-3 text-[14px] leading-snug text-ink-2">“{mandate.natural_language_description}”</blockquote>
        )}
      </div>

      <KV rows={rows} />

      {status === "active" && <Status tone="success" title="Mandate active" body={<>FleetBuyer can shop within these limits · {untilText(mandate.validity.expires_at)}. You can revoke any time.</>} />}
      {status === "revoked" && <Status tone="danger" title="Revoked" body="Every later purchase fails with MANDATE_REVOKED." />}
      {status === "declined" && <Status tone="danger" title="Declined" body="Your agent was told no. Nothing was authorized." />}
      {status === "expired" && <Status tone="warn" title="Expired" body="Purchases now fail with MANDATE_EXPIRED." />}

      <MandateJson mandate={mandate} />

      <p className="px-1 text-[12px] text-faint">
        Approving signs <Mono>sha256(mandate)</Mono> with a passkey on this device. The card never leaves the vault; the merchant only ever sees a single-use token.
      </p>

      {status === "draft" && (
        <StickyActions>
          <Button size="lg" className="flex-1" onClick={async () => { await decline(mandate.id, "user:cfo"); router.push("/m"); }}>
            Decline
          </Button>
          <Button size="lg" variant="primary" className="flex-[2]" icon={<Fingerprint className="size-4" />} onClick={() => setCeremony(true)}>
            Approve with passkey
          </Button>
        </StickyActions>
      )}
      {status === "active" && (
        <StickyActions>
          {!confirmRevoke ? (
            <>
              <Link href="/m" className="flex-1">
                <Button size="lg" className="w-full">Done</Button>
              </Link>
              <Button size="lg" variant="danger" className="flex-1" icon={<Ban className="size-4" />} onClick={() => setConfirmRevoke(true)}>
                Revoke
              </Button>
            </>
          ) : (
            <>
              <Button size="lg" className="flex-1" onClick={() => setConfirmRevoke(false)}>Cancel</Button>
              <Button size="lg" variant="dangerSolid" className="flex-[2]" onClick={() => { revoke(mandate.id, "user:cfo"); setConfirmRevoke(false); }}>
                Revoke now
              </Button>
            </>
          )}
        </StickyActions>
      )}
      {(status === "revoked" || status === "declined" || status === "expired") && (
        <StickyActions>
          <Link href="/m" className="flex-1">
            <Button size="lg" className="w-full">Back to inbox</Button>
          </Link>
        </StickyActions>
      )}

      <PasskeyCeremony
        open={ceremony}
        endpoint={`/api/mandates/${mandate.id}/authorize`}
        onClose={() => setCeremony(false)}
        challenge={mandateHash(mandate)}
        title="Authorize this mandate"
        successTitle="Mandate active"
        facts={[
          { label: "Agent", value: "FleetBuyer" },
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
    </div>
  );
}
