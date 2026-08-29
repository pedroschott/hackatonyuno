"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Fingerprint, PauseCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import { brl, relative } from "@/lib/format";
import { Badge, Button, Mono } from "@/components/ui";
import { PasskeyCeremony } from "@/components/PasskeyCeremony";
import { KV, StickyActions, Status } from "@/components/mobile/bits";

export default function ApprovalSheet() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const approval = useStore((s) => s.approvals.find((a) => a.id === id));
  const attempts = useStore((s) => s.attempts);
  const mandates = useStore((s) => s.mandates);
  const decide = useStore((s) => s.decideApproval);
  const [ceremony, setCeremony] = useState(false);

  if (!approval) return <Status tone="neutral" title="Approval not found" body={<Link className="underline" href="/m">Back to inbox</Link>} />;

  const original = attempts.find((a) => a.id === approval.attempt_id);
  const mandate = mandates.find((m) => m.id === original?.mandate_id);
  const over = mandate ? approval.amount_cents - mandate.limits.per_purchase_cents : 0;
  const retry = approval.exception_id ? attempts.find((a) => a.exception_id === approval.exception_id) : undefined;

  return (
    <div className="flex flex-1 flex-col space-y-4">
      <div className="rounded-lg bg-white px-4 py-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-warn-soft text-warn">
            <PauseCircle className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">FleetBuyer needs an exception</div>
            <div className="text-[12.5px] text-muted">{relative(approval.created_at)} · one-time · bound to this cart</div>
          </div>
          {approval.status === "pending" && <Badge tone="warn">Pending</Badge>}
          {approval.status === "approved" && <Badge tone="success">Approved</Badge>}
          {approval.status === "denied" && <Badge tone="danger">Denied</Badge>}
        </div>
        <p className="mt-3 text-[14px] leading-snug text-ink-2">
          It wants <b className="text-ink">{approval.product_name}</b> for <b className="text-ink tabular">{brl(approval.amount_cents)}</b> at AutoParts —{" "}
          {over > 0 ? (
            <>
              <b className="text-warn-ink tabular">{brl(over)}</b> over your per-purchase limit.
            </>
          ) : (
            "outside the mandate."
          )}
        </p>
      </div>

      <KV
        rows={[
          { k: "Item", v: approval.product_name },
          { k: "Amount", v: brl(approval.amount_cents) },
          { k: "Your limit", v: mandate ? brl(mandate.limits.per_purchase_cents) : "—" },
          { k: "Cart hash", v: <Mono>{approval.cart_hash.slice(0, 12)}…</Mono> },
        ]}
      />

      {approval.status === "approved" && (
        <Status
          tone="success"
          title={retry ? "Approved — purchase completed" : "Approved"}
          body={retry ? <>Token <Mono className="bg-white/60 text-success-ink">{retry.payment_token?.token}</Mono> · recorded with <b>exception: true</b>.</> : `Exception ${approval.exception_id} minted for this cart only.`}
        />
      )}
      {approval.status === "denied" && <Status tone="danger" title="Denied" body="The agent was refused. Nothing was charged." />}

      {approval.status === "pending" ? (
        <StickyActions>
          <Button size="lg" className="flex-1" onClick={async () => { await decide(approval.id, "denied", "user:cfo"); router.push("/m"); }}>
            Deny
          </Button>
          <Button size="lg" variant="primary" className="flex-[2]" icon={<Fingerprint className="size-4" />} onClick={() => setCeremony(true)}>
            Approve with passkey
          </Button>
        </StickyActions>
      ) : (
        <StickyActions>
          <Link href="/m" className="flex-1">
            <Button size="lg" className="w-full">Back to inbox</Button>
          </Link>
        </StickyActions>
      )}

      <PasskeyCeremony
        open={ceremony}
        endpoint={`/api/approvals/${approval.id}/authorize`}
        onClose={() => setCeremony(false)}
        challenge={approval.cart_hash}
        title="Approve one-time exception"
        cta="Approve with passkey"
        successTitle="Exception minted"
        cosignLabel="Minting exception…"
        facts={[
          { label: "Item", value: approval.product_name },
          { label: "Amount", value: brl(approval.amount_cents) },
          { label: "Scope", value: "This cart only · single use" },
        ]}
        onComplete={async (pk) => {
          await decide(approval.id, "approved", "user:cfo", pk);
          setTimeout(() => setCeremony(false), 900);
        }}
      />
    </div>
  );
}
