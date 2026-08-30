"use client";

import { AlertTriangle, ChevronRight, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Card, CardHeader, EmptyState, Field, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
  disputeTone,
  isOpenDispute,
  MERCHANT_DISPUTE_STATUSES,
  type Dispute,
  type DisputeReasonCode,
  type MerchantDisputeStatus,
} from "@/lib/disputes";
import { usd } from "@/lib/format";
import { developerApi } from "./client";
import { LoadingPanel } from "./bits";

type DisputedPurchase = {
  id: string;
  created_at: string;
  product_id: string;
  amount_cents: number;
  shipping_cents: number | null;
  purchase_reason: string | null;
  shipping_address_source: "registered" | "custom" | null;
  fulfillment: { method?: string; estimated_delivery?: { text?: string } } | null;
};

type MerchantDispute = Dispute & { purchase: DisputedPurchase | null };

const formatDate = (value: string) =>
  new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * The merchant's side of a dispute: what the buyer says, what the agent recorded
 * as the reason at the time of purchase, what the model made of the buyer's
 * history here, and the answer the merchant sends back.
 */
export function DisputesTab({ merchantId }: { merchantId: string }) {
  const [disputes, setDisputes] = useState<MerchantDispute[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await developerApi<{ disputes: MerchantDispute[] }>(
        `/api/developers/merchants/${merchantId}/disputes`,
      );
      setDisputes(result.disputes);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load disputes");
    }
  }, [merchantId]);

  useEffect(() => {
    // Guarded so a merchant switched mid-flight cannot land its answer on the
    // wrong screen, matching how the other tabs load.
    let active = true;
    void developerApi<{ disputes: MerchantDispute[] }>(`/api/developers/merchants/${merchantId}/disputes`)
      .then((result) => {
        if (!active) return;
        setDisputes(result.disputes);
        setError(null);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load disputes");
      });
    return () => {
      active = false;
    };
  }, [merchantId]);

  if (!disputes && !error) return <LoadingPanel />;
  const open = (disputes ?? []).filter((dispute) => isOpenDispute(dispute.status));

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md bg-danger-soft px-4 py-3 text-[13px] text-danger-ink">{error}</div>}
      <Card>
        <CardHeader
          title="Disputes"
          description={
            open.length
              ? `${open.length} awaiting your answer. Each one names the charge, the mandate that allowed it, and the reason the buyer gave the agent at the time.`
              : "A buyer can dispute any approved charge. The purchase reason recorded at the time is what makes one reviewable."
          }
        />
        {(disputes ?? []).length === 0 ? (
          <EmptyState
            title="No disputes"
            description="Nothing has been disputed at this merchant. Charges appear here only after a buyer opens a case against one."
          />
        ) : (
          <ul className="divide-y divide-line">
            {(disputes ?? []).map((dispute) => (
              <li key={dispute.id}>
                <button
                  onClick={() => setOpenId(openId === dispute.id ? null : dispute.id)}
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-[#fafbfc]"
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      isOpenDispute(dispute.status) ? "bg-warn-soft text-warn" : "bg-line-2 text-muted",
                    )}
                  >
                    <AlertTriangle className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium text-ink">
                        {DISPUTE_REASON_LABELS[dispute.reason_code as DisputeReasonCode]}
                      </span>
                      <Badge tone={disputeTone(dispute.status)} dot>
                        {DISPUTE_STATUS_LABELS[dispute.status]}
                      </Badge>
                      {dispute.analysis && <Badge tone="brand">Analyzed</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] text-muted">
                      {dispute.purchase?.product_id ?? "—"} · opened {formatDate(dispute.created_at)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[13.5px] font-semibold tabular">{usd(dispute.amount_cents)}</div>
                  </div>
                  <ChevronRight
                    className={cn("size-4 shrink-0 text-faint transition-transform", openId === dispute.id && "rotate-90")}
                  />
                </button>
                {openId === dispute.id && (
                  <DisputeDetail merchantId={merchantId} dispute={dispute} onChange={load} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DisputeDetail({
  merchantId,
  dispute,
  onChange,
}: {
  merchantId: string;
  dispute: MerchantDispute;
  onChange: () => Promise<void>;
}) {
  const [status, setStatus] = useState<MerchantDisputeStatus>("under_review");
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = !isOpenDispute(dispute.status);

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    try {
      await developerApi(`/api/developers/merchants/${merchantId}/disputes/${dispute.id}/analyze`, { method: "POST" });
      await onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function respond() {
    setBusy(true);
    setError(null);
    try {
      await developerApi(`/api/developers/merchants/${merchantId}/disputes/${dispute.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, response }),
      });
      setResponse("");
      await onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the response");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ap-in space-y-4 border-t border-line bg-[#fafbfc] px-5 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Detail label="What the buyer says">{dispute.buyer_statement}</Detail>
        <Detail label="Why the agent bought it, at the time">
          {dispute.purchase?.purchase_reason ?? "Not recorded — this charge predates purchase intent."}
        </Detail>
        <Detail label="Charge">
          {usd(dispute.amount_cents)}
          {dispute.purchase?.shipping_cents ? ` · ${usd(dispute.purchase.shipping_cents)} of it delivery` : ""}
        </Detail>
        <Detail label="Delivery">
          {dispute.purchase?.fulfillment
            ? `${dispute.purchase.fulfillment.method ?? "Shipped"}${
                dispute.purchase.fulfillment.estimated_delivery?.text
                  ? `, quoted ${dispute.purchase.fulfillment.estimated_delivery.text}`
                  : ""
              }${dispute.purchase.shipping_address_source === "custom" ? " to a one-off address" : ""}`
            : "No delivery was quoted for this order."}
        </Detail>
      </div>

      {dispute.analysis ? (
        <div className="rounded-md border border-brand-soft bg-brand-soft/40 px-4 py-3">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Sparkles className="size-3.5 text-brand-ink" />
            <span className="text-[12.5px] font-semibold text-brand-ink">
              Reads as {DISPUTE_REASON_LABELS[dispute.analysis.likely_cause]?.toLowerCase() ?? dispute.analysis.likely_cause}
            </span>
            <Badge tone="brand">{dispute.analysis.confidence} confidence</Badge>
            <Badge tone={dispute.analysis.recommendation === "refund" ? "warn" : "neutral"}>
              suggests {dispute.analysis.recommendation.replace("_", " ")}
            </Badge>
            {dispute.analysis.engine === "rules" && <Badge tone="neutral">offline rules</Badge>}
          </div>
          <p className="text-[13px] leading-5 text-ink-2">{dispute.analysis.summary}</p>
          {dispute.analysis.evidence.length > 0 && (
            <ul className="mt-2 space-y-1">
              {dispute.analysis.evidence.map((item, index) => (
                <li key={index} className="text-[12.5px] leading-5 text-muted">
                  · {item}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] text-muted">
            {dispute.analysis.recommendation_rationale} Advisory only — it never changes the status.
          </p>
        </div>
      ) : (
        <Button icon={<Sparkles className="size-3.5" />} loading={analyzing} onClick={analyze}>
          Analyze this buyer&rsquo;s history here
        </Button>
      )}

      {dispute.merchant_response && (
        <Detail label="Your last response">{dispute.merchant_response}</Detail>
      )}

      {error && <div className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger-ink">{error}</div>}

      {closed ? (
        <p className="text-[12.5px] text-muted">
          This dispute is {DISPUTE_STATUS_LABELS[dispute.status].toLowerCase()} and can no longer be answered.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[200px_1fr] sm:items-end">
          <Field label="Move it to">
            <Select value={status} onChange={(event) => setStatus(event.target.value as MerchantDisputeStatus)}>
              {MERCHANT_DISPUTE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {DISPUTE_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Your response to the buyer">
            <textarea
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What you found, and what happens next."
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-[13.5px] text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:shadow-[var(--shadow-focus)]"
            />
          </Field>
          <div className="sm:col-span-2">
            <Button variant="primary" loading={busy} disabled={response.trim().length === 0} onClick={respond}>
              Send response
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="mt-0.5 text-[13px] leading-5 text-ink-2">{children}</div>
    </div>
  );
}
