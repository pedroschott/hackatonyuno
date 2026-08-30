"use client";

import { useEffect, useState } from "react";
import { Check, X, PauseCircle, Loader2 } from "lucide-react";
import type { Attempt, Product } from "@/lib/types";
import { useStore } from "@/lib/store";
import { REASON_LABEL } from "@/lib/policy";
import { brl, timeShort } from "@/lib/format";
import { Modal, Badge, Button } from "../ui";
import { ChecksList } from "./ChecksList";
import { Mark } from "../Logo";
import { cn } from "@/lib/cn";

export function CheckoutModal({ product, open, onClose }: { product: Product | null; open: boolean; onClose: () => void }) {
  if (!open || !product) return null;
  return <CheckoutBody product={product} onClose={onClose} />;
}

function CheckoutBody({ product, onClose }: { product: Product; onClose: () => void }) {
  const checkout = useStore((s) => s.checkout);
  const agent = useStore((s) => s.agents[0]);
  const approvals = useStore((s) => s.approvals);
  const attempts = useStore((s) => s.attempts);
  const cards = useStore((s) => s.cards);
  const mandate = useStore((s) => s.mandates.find((m) => m.id === s.agents[0]?.currentMandateId));

  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [step, setStep] = useState(0); // how many checks revealed

  useEffect(() => {
    const t = setTimeout(() => {
      checkout("standard", { productId: product.id, source: "store" }).then(setAttempt).catch(() => setAttempt(null));
    }, 450);
    return () => clearTimeout(t);
  }, [product, checkout]);

  useEffect(() => {
    if (!attempt) return;
    if (step >= attempt.checks.length) return;
    const t = setTimeout(() => setStep(step + 1), 380);
    return () => clearTimeout(t);
  }, [attempt, step]);

  const revealed = attempt ? step >= attempt.checks.length : false;
  const approval = attempt?.decision === "escalated" ? approvals.find((a) => a.attempt_id === attempt.id) : undefined;
  const retry = approval?.exception_id ? attempts.find((a) => a.exception_id === approval.exception_id) : undefined;
  const card = mandate ? cards.find((c) => c.id === mandate.payment.vault_card_id) : undefined;

  const final = retry ?? attempt;

  return (
    <Modal open onClose={onClose} width="max-w-[520px]" dismissible={revealed || !attempt}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-5 py-3.5">
        <Mark size={20} />
        <span className="text-[14px] font-semibold">AgentPay checkout</span>
        <span className="text-[12px] text-muted sm:ml-auto">AutoParts</span>
      </div>

      {(
        <div className="px-5 py-4">
          {/* Order */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-canvas px-3 py-2.5 text-[13.5px]">
            <div className="min-w-0">
              <div className="font-medium">{product.name}</div>
              <div className="text-[12px] text-muted">
                {product.sku} · <span className="capitalize">{product.category}</span>
              </div>
            </div>
            <div className="text-[15px] font-semibold tabular">{brl(product.priceCents)}</div>
          </div>

          {/* Buyer */}
          <div className="mt-3 rounded-md border border-line px-3 py-2 text-[12.5px]">
            <div className="text-[11px] uppercase tracking-wide text-faint">Paying agent</div>
            <div className="mt-0.5 font-medium">{agent?.name ?? "Connected agent"}</div>
          </div>

          {/* Verification */}
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-faint">
              Verifying before accepting
              {!revealed && <Loader2 className="size-3 animate-spin text-brand" />}
            </div>
            {attempt ? (
              <ChecksList checks={attempt.checks} animateUpTo={revealed ? undefined : step} />
            ) : (
              <div className="h-[92px] animate-pulse rounded bg-line-2" />
            )}
          </div>

          {/* Result */}
          {revealed && final && (
            <div
              className={cn(
                "ap-in mt-4 rounded-md px-4 py-3",
                final.decision === "approved" && "bg-success-soft",
                final.decision === "refused" && "bg-danger-soft",
                final.decision === "escalated" && "bg-warn-soft",
              )}
            >
              {final.decision === "approved" && (
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-5 items-center justify-center rounded-full bg-success text-white">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  <div className="text-[13px] text-success-ink">
                    <div className="font-semibold">Order accepted</div>
                    <div className="mt-0.5">
                      Charged {brl(final.amount_cents)} to •••• {card?.last4 ?? "????"} with a single-use token. The card
                      number never reached the store.
                    </div>
                    {final.exception_id && (
                      <div className="mt-1">
                        <Badge tone="warn">Approved by the buyer</Badge> <span className="opacity-80">{timeShort(final.created_at)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {final.decision === "refused" && (
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-5 items-center justify-center rounded-full bg-danger text-white">
                    <X className="size-3" strokeWidth={3} />
                  </span>
                  <div className="text-[13px] text-danger-ink">
                    <div className="font-semibold">Refused</div>
                    <div className="mt-0.5">{final.reason_code ? REASON_LABEL[final.reason_code] : "Outside the mandate"}. Nothing was charged, and the buyer sees this attempt too.</div>
                  </div>
                </div>
              )}
              {final.decision === "escalated" && (
                <div className="flex items-start gap-2.5">
                  <PauseCircle className="mt-0.5 size-5 text-warn" />
                  <div className="text-[13px] text-warn-ink">
                    <div className="font-semibold">Waiting for human approval</div>
                    <div className="mt-0.5">
                      Over the per-purchase limit. The buyer was asked to approve this one purchase. Never approved silently.
                    </div>
                    {approval?.status === "denied" && <div className="mt-1 font-medium">The buyer declined.</div>}
                    {approval?.status === "pending" && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[12px] opacity-80">
                        <Loader2 className="size-3 animate-spin" /> Listening for the decision…
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-end">
            <Button onClick={onClose} disabled={!revealed}>
              {final?.decision === "approved" ? "Done" : "Close"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
