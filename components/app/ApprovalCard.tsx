"use client";

import { useState } from "react";
import type { Approval, Mandate } from "@/lib/types";
import { useStore } from "@/lib/store";
import { brl } from "@/lib/format";
import { storeName } from "@/lib/plain";
import { Button, Card } from "../ui";
import { PasskeyCeremony } from "../PasskeyCeremony";
import { agentLabel } from "./agent-label";

/**
 * A purchase the mandate does not cover on its own. It waits here for a one-time
 * exception — a separate signature that authorizes this single purchase and leaves
 * the mandate's limits exactly where they were.
 */
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
        <h3 className="text-[16px] font-semibold">One-time approval requested</h3>
        <p className="mt-1.5 text-[14px] text-ink-2">
          {name} tried to buy <b className="text-ink">{approval.product_name}</b> at {store} for{" "}
          <b className="text-ink tabular">{brl(approval.amount_cents)}</b>.
        </p>
        {over > 0 && mandate && (
          <p className="mt-1 text-[13.5px] text-muted">
            That is {brl(over)} over the {brl(mandate.limits.per_purchase_cents)} per-purchase limit on its mandate, so
            it was held instead of charged.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" size="lg" onClick={() => setOpen(true)}>
            Approve this purchase
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
        title="Approve this one purchase?"
        subtitle="A one-time exception, signed separately. The mandate's limits are not raised."
        cta="Approve"
        successTitle="Exception signed"
        successBody="The agent can complete this single purchase. Nothing else changed."
        facts={[
          { label: "Item", value: approval.product_name },
          { label: "Store", value: store },
          { label: "Amount", value: brl(approval.amount_cents) },
          { label: "Mandate limit", value: mandate ? brl(mandate.limits.per_purchase_cents) : "—" },
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
