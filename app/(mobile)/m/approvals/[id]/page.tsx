"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { brl } from "@/lib/format";
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
            <div className="text-[16px] font-semibold">Approve this purchase?</div>
          </div>
          {approval.status === "pending" && <Badge tone="warn">Waiting</Badge>}
          {approval.status === "approved" && <Badge tone="success">Approved</Badge>}
          {approval.status === "denied" && <Badge tone="danger">Declined</Badge>}
        </div>
        <p className="mt-3 text-[14px] leading-snug text-ink-2">
          {name} wants to buy <b className="text-ink">{approval.product_name}</b> at {store} for{" "}
          <b className="text-ink tabular">{brl(approval.amount_cents)}</b>.
          {over > 0 && mandate && (
            <> That is {brl(over)} more than the {brl(mandate.limits.per_purchase_cents)} you allowed per purchase.</>
          )}
        </p>
      </div>

      <KV
        rows={[
          { k: "Item", v: approval.product_name },
          { k: "Store", v: store },
          { k: "Amount", v: brl(approval.amount_cents) },
          { k: "Your limit", v: mandate ? brl(mandate.limits.per_purchase_cents) : "—" },
        ]}
      />

      {approval.status === "approved" && (
        <Status tone="success" title="Approved" body="This covered one purchase only. Your limits are unchanged." />
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
        onComplete={async (pk) => {
          await decide(approval.id, "approved", "user", pk);
          setTimeout(() => setCeremony(false), 800);
        }}
      />
    </div>
  );
}
