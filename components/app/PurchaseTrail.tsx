"use client";

import { Check, ChevronRight, Minus, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge, Button, Field, Modal, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  DISPUTE_REASON_CODES,
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
  disputeTone,
  isOpenDispute,
  type DisputeReasonCode,
} from "@/lib/disputes";
import { usageFor, useStore } from "@/lib/store";
import { usd } from "@/lib/format";
import { auditSentence, BLOCK_REASON, mandateRef, outcomeOf, storeName, timeOfDay } from "@/lib/plain";
import type { Attempt, AuditEntry } from "@/lib/types";

/**
 * Everything that happened to one purchase, in the order it happened.
 *
 * The security log already holds all of this, but it holds it interleaved with
 * every other event on the account, which is the wrong shape for the question a
 * person actually asks: "what happened with *this* charge?" The trail answers
 * that one — the request, the four verifications, the mandate it was checked
 * against, where it shipped, what the buyer said they wanted it for, and the
 * hash-chained log entries that prove the account was not edited afterwards.
 */
export function PurchaseTrail({ attempt, onClose }: { attempt: Attempt; onClose: () => void }) {
  const mandates = useStore((s) => s.mandates);
  const merchants = useStore((s) => s.merchants);
  const approvals = useStore((s) => s.approvals);
  const attempts = useStore((s) => s.attempts);
  const audit = useStore((s) => s.audit);
  const disputes = useStore((s) => s.disputes);

  const mandate = mandates.find((candidate) => candidate.id === attempt.mandate_id);
  const approval = approvals.find(
    (candidate) => candidate.attempt_id === attempt.id || candidate.id === attempt.exception_id,
  );
  const dispute = disputes.find((candidate) => candidate.attempt_id === attempt.id);
  const outcome = outcomeOf(attempt);

  // The log entries that name this attempt: the decision itself, and any
  // approval raised against it or consumed by it.
  const entries = useMemo(() => {
    const ids = new Set([attempt.id, approval?.id].filter(Boolean) as string[]);
    return audit.filter((entry) => {
      if (ids.has(entry.entity)) return true;
      const payload = entry.payload as Record<string, unknown>;
      return (
        (typeof payload.attempt_id === "string" && ids.has(payload.attempt_id)) ||
        (typeof payload.approval_id === "string" && ids.has(payload.approval_id))
      );
    });
  }, [audit, attempt.id, approval?.id]);

  const usage = mandate ? usageFor({ attempts }, mandate.id) : null;
  const subtotal = attempt.amount_cents - (attempt.shipping_cents ?? 0);

  return (
    <Modal open onClose={onClose} title="Purchase trail" width="max-w-2xl">
      <div className="space-y-5 px-5 py-4">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[17px] font-semibold tracking-[-0.01em]">{attempt.product_name}</h4>
            <Badge tone={outcome.tone === "success" ? "success" : outcome.tone === "danger" ? "danger" : "warn"} dot>
              {outcome.label}
            </Badge>
            {dispute && <Badge tone={disputeTone(dispute.status)}>{DISPUTE_STATUS_LABELS[dispute.status]}</Badge>}
          </div>
          <p className="mt-1 text-[13.5px] text-muted">
            {storeName(merchants, attempt.merchant_id)} · {new Date(attempt.created_at).toLocaleString("en-US", {
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </header>

        <section className="grid gap-3 rounded-lg bg-canvas px-4 py-3 sm:grid-cols-2">
          <Row label="Charged">
            <span className="tabular">{usd(attempt.amount_cents)}</span>
            {attempt.shipping_cents ? (
              <span className="block text-[12px] text-muted">
                {usd(subtotal)} for the item, {usd(attempt.shipping_cents)} delivery
              </span>
            ) : null}
          </Row>
          <Row label="Why it was bought">
            {attempt.purchase_reason ?? (
              <span className="text-muted">Not recorded — this purchase predates stated intent.</span>
            )}
          </Row>
          <Row label="Delivered to">
            {attempt.shipping_address ? (
              <>
                <span className="block">{attempt.shipping_address.recipient}</span>
                <span className="block text-[12.5px] text-muted">
                  {attempt.shipping_address.line1}
                  {attempt.shipping_address.line2 ? `, ${attempt.shipping_address.line2}` : ""}, {attempt.shipping_address.city}
                  {attempt.shipping_address.region ? `, ${attempt.shipping_address.region}` : ""} {attempt.shipping_address.postal_code}
                </span>
                {attempt.shipping_address_source === "custom" && (
                  <span className="mt-1 inline-block text-[12px] text-warn-ink">
                    A one-off address for this order, not the one on your account.
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted">No address was recorded for this attempt.</span>
            )}
          </Row>
          <Row label="Arriving">
            {attempt.fulfillment ? (
              <>
                <span className="block">{attempt.fulfillment.estimated_delivery.text}</span>
                <span className="block text-[12.5px] text-muted">
                  {attempt.fulfillment.method}
                  {attempt.fulfillment.carrier ? ` · ${attempt.fulfillment.carrier}` : ""}. {attempt.fulfillment.handling_time}.
                </span>
              </>
            ) : (
              <span className="text-muted">The store quoted no delivery for this order.</span>
            )}
          </Row>
        </section>

        <section>
          <SectionTitle>What was verified</SectionTitle>
          <ul className="mt-2 divide-y divide-line-2 rounded-lg bg-white shadow-[var(--shadow-card)]">
            {attempt.checks.map((check) => (
              <li key={check.id} className="flex items-center gap-2.5 px-4 py-2.5">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full",
                    check.status === "pass" && "bg-success-soft text-success",
                    check.status === "fail" && "bg-danger-soft text-danger",
                    check.status === "skip" && "bg-line-2 text-faint",
                  )}
                >
                  {check.status === "pass" ? (
                    <Check className="size-3" strokeWidth={3} />
                  ) : check.status === "fail" ? (
                    <X className="size-3" strokeWidth={3} />
                  ) : (
                    <Minus className="size-3" strokeWidth={3} />
                  )}
                </span>
                <span className="flex-1 text-[13.5px]">{check.label}</span>
                {check.detail && <span className="font-mono text-[11.5px] text-muted">{check.detail}</span>}
              </li>
            ))}
          </ul>
          {attempt.decision !== "approved" && attempt.reason_code && (
            <p className="mt-2 text-[13px] text-muted">{BLOCK_REASON[attempt.reason_code]}.</p>
          )}
        </section>

        <section>
          <SectionTitle>The mandate it was checked against</SectionTitle>
          {mandate ? (
            <div className="mt-2 rounded-lg bg-white px-4 py-3 text-[13px] shadow-[var(--shadow-card)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px]">{mandateRef(mandate.id)}</span>
                <Badge tone={mandate.status === "active" ? "success" : mandate.status === "revoked" ? "danger" : "neutral"}>
                  {mandate.status}
                </Badge>
              </div>
              {mandate.natural_language_description && (
                <p className="mt-1.5 text-muted">&ldquo;{mandate.natural_language_description}&rdquo;</p>
              )}
              <p className="mt-1.5 text-muted">
                Up to {usd(mandate.limits.per_purchase_cents)} per purchase, {usd(mandate.limits.cumulative_cents)} a month,
                {" "}
                {mandate.limits.max_uses} purchase{mandate.limits.max_uses === 1 ? "" : "s"}, at{" "}
                {mandate.scope.merchants.length} store{mandate.scope.merchants.length === 1 ? "" : "s"} in{" "}
                {mandate.scope.categories.join(", ")}.
              </p>
              {usage && (
                <p className="mt-1 text-muted">
                  Used {usage.uses} of {mandate.limits.max_uses} this month, {usd(usage.spent)} of{" "}
                  {usd(mandate.limits.cumulative_cents)}.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-muted">No mandate is attached to this attempt.</p>
          )}
        </section>

        {approval && (
          <section>
            <SectionTitle>Your one-time approval</SectionTitle>
            <p className="mt-2 text-[13px] text-muted">
              {approval.status === "approved"
                ? `You approved this exact charge${approval.decided_at ? ` at ${timeOfDay(approval.decided_at)}` : ""}${
                    approval.consumed ? ", and it was used once and then retired." : "."
                  }`
                : approval.status === "denied"
                  ? "You denied this one, so nothing was charged."
                  : "This is still waiting on your decision."}
            </p>
          </section>
        )}

        <section>
          <SectionTitle>In the security log</SectionTitle>
          {entries.length ? (
            <ol className="mt-2 space-y-2">
              {entries.map((entry) => (
                <LogEntry key={entry.seq} entry={entry} />
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-[13px] text-muted">No log entries reference this attempt.</p>
          )}
          <Link href="/audit" className="mt-2 inline-block text-[13px] font-medium text-brand-ink hover:underline">
            Open the full security log →
          </Link>
        </section>

        <DisputeSection attempt={attempt} dispute={dispute} />
      </div>
    </Modal>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h5 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-faint">{children}</h5>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="mt-0.5 text-[13.5px] leading-5 text-ink">{children}</div>
    </div>
  );
}

function LogEntry({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg bg-white shadow-[var(--shadow-card)]">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px]">{auditSentence(entry.action)}</div>
          <div className="text-[12px] text-muted">
            {timeOfDay(entry.ts)} · event {entry.seq} · {entry.actor}
          </div>
        </div>
        <ChevronRight className={cn("size-4 shrink-0 text-faint transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="border-t border-line-2 px-4 py-2.5">
          <pre className="overflow-auto rounded bg-canvas p-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
            {JSON.stringify(entry.payload, null, 2)}
          </pre>
          <div className="mt-1.5 break-all font-mono text-[10.5px] text-faint">
            {entry.prev_hash.slice(0, 12)}… → {entry.hash.slice(0, 12)}…
          </div>
        </div>
      )}
    </li>
  );
}

/** Opening a dispute is the one action available from the trail. */
function DisputeSection({
  attempt,
  dispute,
}: {
  attempt: Attempt;
  dispute: ReturnType<typeof useStore.getState>["disputes"][number] | undefined;
}) {
  const openDispute = useStore((s) => s.openDispute);
  const withdrawDispute = useStore((s) => s.withdrawDispute);
  const [reason, setReason] = useState<DisputeReasonCode>("not_recognized");
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);

  if (attempt.decision !== "approved") {
    return (
      <section>
        <SectionTitle>Dispute</SectionTitle>
        <p className="mt-2 text-[13px] text-muted">
          Nothing was charged on this attempt, so there is nothing to dispute. The reason it was refused is above.
        </p>
      </section>
    );
  }

  if (dispute) {
    return (
      <section>
        <SectionTitle>Dispute</SectionTitle>
        <div className="mt-2 rounded-lg bg-white px-4 py-3 text-[13px] shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={disputeTone(dispute.status)} dot>
              {DISPUTE_STATUS_LABELS[dispute.status]}
            </Badge>
            <span className="text-muted">{DISPUTE_REASON_LABELS[dispute.reason_code]}</span>
          </div>
          <p className="mt-1.5 text-muted">&ldquo;{dispute.buyer_statement}&rdquo;</p>
          {dispute.merchant_response && (
            <p className="mt-2">
              <span className="font-medium">The store replied:</span>{" "}
              <span className="text-muted">{dispute.merchant_response}</span>
            </p>
          )}
          {dispute.resolution && (
            <p className="mt-2">
              <span className="font-medium">Outcome:</span> <span className="text-muted">{dispute.resolution}</span>
            </p>
          )}
          {isOpenDispute(dispute.status) && (
            <div className="mt-3">
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await withdrawDispute(dispute.id);
                  } catch (caught) {
                    setError(caught instanceof Error ? caught.message : "Could not withdraw");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Withdraw the dispute
              </Button>
            </div>
          )}
          {error && <p className="mt-2 text-[12.5px] text-danger-ink">{error}</p>}
        </div>
      </section>
    );
  }

  return (
    <section>
      <SectionTitle>Dispute</SectionTitle>
      {form ? (
        <div className="mt-2 space-y-3 rounded-lg bg-white px-4 py-3 shadow-[var(--shadow-card)]">
          <Field label="What went wrong">
            <Select value={reason} onChange={(event) => setReason(event.target.value as DisputeReasonCode)}>
              {DISPUTE_REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {DISPUTE_REASON_LABELS[code]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="In your own words"
            hint="The store sees this, along with the reason your agent recorded when it bought this."
          >
            <textarea
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              rows={3}
              minLength={10}
              maxLength={2000}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-[13.5px] text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:shadow-[var(--shadow-focus)]"
              placeholder="What happened, and what you want done about it."
            />
          </Field>
          {error && <p className="text-[12.5px] text-danger-ink">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="primary"
              loading={busy}
              disabled={statement.trim().length < 10}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await openDispute({ attempt_id: attempt.id, reason_code: reason, statement: statement.trim() });
                  setForm(false);
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : "Could not open the dispute");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Open the dispute
            </Button>
            <Button onClick={() => setForm(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <p className="mb-2 text-[13px] text-muted">
            This charge was inside your mandate. If it still should not have happened, tell the store why.
          </p>
          <Button onClick={() => setForm(true)}>Dispute this charge</Button>
        </div>
      )}
    </section>
  );
}
