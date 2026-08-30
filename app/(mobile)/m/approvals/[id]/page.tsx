"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { usd } from "@/lib/format";
import { storeName } from "@/lib/plain";
import { Badge, Button } from "@/components/ui";
import { PasskeyCeremony } from "@/components/PasskeyCeremony";
import { agentLabel } from "@/components/app/agent-label";
import { KV, StickyActions, Status } from "@/components/mobile/bits";

export default function ApprovalSheet() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const approval = useStore((s) => s.approvals.find((a) => a.id === id));
  const attempts = useStore((s) => s.attempts);
  const mandates = useStore((s) => s.mandates);
  const agents = useStore((s) => s.agents);
  const merchants = useStore((s) => s.merchants);
  const decide = useStore((s) => s.decideApproval);
  const [ceremony, setCeremony] = useState(false);

  if (!approval)
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

  const original = attempts.find((a) => a.id === approval.attempt_id);
  const mandate = mandates.find((m) => m.id === original?.mandate_id);
  const name = agentLabel(mandate, agents);
  const store = storeName(merchants, approval.merchant_id);
  const over = mandate ? approval.amount_cents - mandate.limits.per_purchase_cents : 0;

  return (
    <div className="flex flex-1 flex-col space-y-4">
      <div className="rounded-lg bg-white px-4 py-4 shadow-[var(--shadow-card)]">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold">One-time approval requested</div>
          </div>
          {approval.status === "pending" && <Badge tone="warn">Waiting</Badge>}
          {approval.status === "approved" && <Badge tone="success">Approved</Badge>}
          {approval.status === "denied" && <Badge tone="danger">Declined</Badge>}
        </div>
        <p className="mt-3 text-[14px] leading-snug text-ink-2">
          {name} tried to buy <b className="text-ink">{approval.product_name}</b> at {store} for{" "}
          <b className="text-ink tabular">{usd(approval.amount_cents)}</b>.
          {over > 0 && mandate && (
            <>
              {" "}
              That is {usd(over)} over the {usd(mandate.limits.per_purchase_cents)} per-purchase limit on its mandate, so
              it was held instead of charged.
            </>
          )}
        </p>
      </div>

      <KV
        rows={[
          { k: "Item", v: approval.product_name },
          { k: "Store", v: store },
          { k: "Amount", v: usd(approval.amount_cents) },
          { k: "Mandate limit", v: mandate ? usd(mandate.limits.per_purchase_cents) : "—" },
        ]}
      />

      {approval.status === "approved" && (
        <Status tone="success" title="Exception signed" body="This covered one purchase only. The mandate's limits are unchanged." />
      )}
      {approval.status === "denied" && <Status tone="danger" title="Declined" body="Nothing was paid." />}

      {approval.status === "pending" ? (
        <StickyActions>
          <Button
            size="lg"
            className="flex-1"
            onClick={async () => {
              await decide(approval.id, "denied", "user");
              router.push("/m");
            }}
          >
            Decline
          </Button>
          <Button size="lg" variant="primary" className="flex-[2]" onClick={() => setCeremony(true)}>
            Approve
          </Button>
        </StickyActions>
      ) : (
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
        endpoint={`/api/approvals/${approval.id}/authorize`}
        onClose={() => setCeremony(false)}
        challenge={approval.cart_hash}
        title="Approve this one purchase?"
        subtitle="A one-time exception, signed separately. The mandate's limits are not raised."
        cta="Approve"
        successTitle="Exception signed"
        successBody="The agent can complete this single purchase. Nothing else changed."
        facts={[
          { label: "Item", value: approval.product_name },
          { label: "Store", value: store },
          { label: "Amount", value: usd(approval.amount_cents) },
          { label: "Mandate limit", value: mandate ? usd(mandate.limits.per_purchase_cents) : "—" },
          { label: "Covers", value: "This purchase only" },
        ]}
        onComplete={async (pk) => {
          await decide(approval.id, "approved", "user", pk);
          setTimeout(() => setCeremony(false), 800);
        }}
      />
    </div>
  );
}
