"use client";

import { useState } from "react";
import type { Approval, Mandate } from "@/lib/types";
import { useStore } from "@/lib/store";
import { brl } from "@/lib/format";
import { storeName } from "@/lib/plain";
import { Button, Card } from "../ui";
import { PasskeyCeremony } from "../PasskeyCeremony";
import { agentLabel } from "./agent-label";

/** A purchase that went over the limit. It waits here; it is never approved quietly. */
export function ApprovalCard({ approval, mandate }: { approval: Approval; mandate?: Mandate }) {
  const decide = useStore((s) => s.decideApproval);
  const agents = useStore((s) => s.agents);
  const merchants = useStore((s) => s.merchants);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = agentLabel(mandate, agents);
  const store = storeName(merchants, approval.merchant_id);
  const over = mandate ? approval.amount_cents - mandate.limits.per_purchase_cents : 0;

  return (
    <Card className="ap-in overflow-hidden border-l-[3px] border-l-warn">
      <div className="px-5 py-4">
        <h3 className="text-[16px] font-semibold">Approve this purchase?</h3>
        <p className="mt-1.5 text-[14px] text-ink-2">
          {name} wants to buy <b className="text-ink">{approval.product_name}</b> at {store} for{" "}
          <b className="text-ink tabular">{brl(approval.amount_cents)}</b>.
        </p>
        {over > 0 && mandate && (
          <p className="mt-1 text-[13.5px] text-muted">
            That is {brl(over)} more than the {brl(mandate.limits.per_purchase_cents)} you allowed per purchase.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" size="lg" onClick={() => setOpen(true)}>
            Approve just this one
          </Button>
          <Button
            size="lg"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await decide(approval.id, "denied", "user");
              } finally {
                setBusy(false);
              }
            }}
          >
            Decline
          </Button>
        </div>
      </div>

      <PasskeyCeremony
        open={open}
        endpoint={`/api/approvals/${approval.id}/authorize`}
        onClose={() => setOpen(false)}
        challenge={approval.cart_hash}
        title="Approve this purchase?"
        subtitle="This approval covers this purchase only. Your limits stay exactly as they are."
        cta="Approve"
        successTitle="Approved"
        successBody="Your agent can complete this one purchase."
        facts={[
          { label: "Item", value: approval.product_name },
          { label: "Store", value: store },
          { label: "Amount", value: brl(approval.amount_cents) },
          { label: "Covers", value: "This purchase only" },
        ]}
        onComplete={(pk) => {
          decide(approval.id, "approved", "user", pk);
          setTimeout(() => setOpen(false), 800);
        }}
      />
    </Card>
  );
}
