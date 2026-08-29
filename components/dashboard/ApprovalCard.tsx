"use client";

import { useState } from "react";
import { Fingerprint, PauseCircle, Check, X } from "lucide-react";
import type { Approval, Mandate } from "@/lib/types";
import { useStore, type Actor } from "@/lib/store";
import { brl, relative } from "@/lib/format";
import { Badge, Button, Card, Mono } from "../ui";
import { PasskeyCeremony } from "../PasskeyCeremony";

export function ApprovalCard({ approval, mandate, actor }: { approval: Approval; mandate?: Mandate; actor: Actor }) {
  const decide = useStore((s) => s.decideApproval);
  const [open, setOpen] = useState(false);
  const over = mandate ? approval.amount_cents - mandate.limits.per_purchase_cents : 0;

  return (
    <Card className="ap-in overflow-hidden border-l-[3px] border-l-warn">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <PauseCircle className="mt-0.5 size-5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] font-semibold">Approval needed</span>
            <Badge tone="warn">AMOUNT_EXCEEDS_LIMIT</Badge>
            <span className="text-[12px] text-muted sm:ml-auto">{relative(approval.created_at)}</span>
          </div>
          <p className="mt-1 text-[13px] text-ink-2">
            FleetBuyer wants to buy <span className="font-medium text-ink">{approval.product_name}</span> for{" "}
            <span className="font-medium text-ink tabular">{brl(approval.amount_cents)}</span> at AutoParts —{" "}
            {over > 0 ? (
              <>
                <span className="font-medium text-warn-ink tabular">{brl(over)}</span> over the per-purchase limit.
              </>
            ) : (
              "outside the mandate."
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            <Mono>{approval.id}</Mono>
            <span>cart</span>
            <Mono>{approval.cart_hash.slice(0, 10)}…</Mono>
            <span>· one-time · bound to this exact cart</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" icon={<Fingerprint className="size-4" />} onClick={() => setOpen(true)}>
              Approve with passkey
            </Button>
            <Button onClick={() => decide(approval.id, "denied", actor)}>Deny</Button>
          </div>
        </div>
      </div>
      <PasskeyCeremony
        open={open}
        endpoint={`/api/approvals/${approval.id}/authorize`}
        onClose={() => setOpen(false)}
        challenge={approval.cart_hash}
        title="Approve one-time exception"
        cta="Approve with passkey"
        successTitle="Exception minted"
        cosignLabel="Minting exception…"
        facts={[
          { label: "Item", value: approval.product_name },
          { label: "Amount", value: brl(approval.amount_cents) },
          { label: "Limit", value: mandate ? brl(mandate.limits.per_purchase_cents) : "—" },
          { label: "Scope", value: "This cart only · single use" },
        ]}
        onComplete={(pk) => {
          decide(approval.id, "approved", actor, pk);
          setTimeout(() => setOpen(false), 900);
        }}
      />
    </Card>
  );
}

export function DecidedApprovalRow({ approval }: { approval: Approval }) {
  const ok = approval.status === "approved";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-[12.5px]">
      {ok ? <Check className="size-3.5 text-success" /> : <X className="size-3.5 text-danger" />}
      <span className="text-ink-2">
        {approval.product_name} · {brl(approval.amount_cents)}
      </span>
      <span className="text-muted">{ok ? "approved" : "denied"}</span>
      {approval.exception_id && (
        <Mono className={approval.consumed ? "" : "text-success-ink"}>
          {approval.exception_id}
          {approval.consumed ? " · used" : ""}
        </Mono>
      )}
      <span className="text-muted sm:ml-auto">{approval.decided_by} · {approval.decided_at ? relative(approval.decided_at) : ""}</span>
    </div>
  );
}
