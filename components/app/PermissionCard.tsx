"use client";

import { useEffect, useState } from "react";
import { ShieldOff } from "lucide-react";
import type { Mandate } from "@/lib/types";
import { useStore, usageFor } from "@/lib/store";
import { effectiveStatus } from "@/lib/engine";
import { brl } from "@/lib/format";
import { endsIn, itemKinds, storeNames } from "@/lib/plain";
import { Badge, Button, Card, Meter } from "../ui";
import { agentLabel } from "./agent-label";

/**
 * One agent's spending permission, said the way the account holder set it up:
 * how much per purchase, how much is left this month, and when it stops.
 */
export function PermissionCard({ mandate, onTurnedOff }: { mandate: Mandate; onTurnedOff?: () => void }) {
  const attempts = useStore((s) => s.attempts);
  const agents = useStore((s) => s.agents);
  const merchants = useStore((s) => s.merchants);
  const revoke = useStore((s) => s.revokeMandate);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const status = effectiveStatus(mandate, now);
  const usage = usageFor({ attempts }, mandate.id);
  const left = Math.max(0, mandate.limits.cumulative_cents - usage.spent);
  const usesLeft = Math.max(0, mandate.limits.max_uses - usage.uses);
  const name = agentLabel(mandate, agents);

  async function turnOff() {
    setBusy(true);
    try {
      await revoke(mandate.id, "user");
      onTurnedOff?.();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <span className="text-[16px] font-semibold">{name}</span>
        {status === "active" ? (
          <Badge tone="success" dot>
            Can spend
          </Badge>
        ) : status === "expired" ? (
          <Badge tone="warn">Ended</Badge>
        ) : (
          <Badge tone="danger">Turned off</Badge>
        )}
      </div>

      <p className="px-5 pt-1 text-[14px] text-ink-2">
        Spends up to <b className="text-ink">{brl(mandate.limits.per_purchase_cents)}</b> per purchase.
      </p>

      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
          <span className="text-muted">Left this month</span>
          <span className="font-semibold tabular">
            {brl(left)} <span className="font-normal text-muted">of {brl(mandate.limits.cumulative_cents)}</span>
          </span>
        </div>
        <div className="mt-2">
          <Meter value={usage.spent} max={mandate.limits.cumulative_cents} tone={left === 0 ? "danger" : "brand"} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
          <span>
            {usesLeft} {usesLeft === 1 ? "purchase" : "purchases"} left
          </span>
          <span>{endsIn(mandate.validity.expires_at, now)}</span>
        </div>
      </div>

      {mandate.scope.merchants.length > 0 && (
        <div className="border-t border-line px-5 py-3 text-[13px] text-muted">
          Only for {itemKinds(mandate.scope.categories)} at {storeNames(merchants, mandate.scope.merchants)}.
        </div>
      )}

      {status === "active" && (
        <div className="border-t border-line px-5 py-4">
          {confirming ? (
            <div className="ap-in space-y-3">
              <p className="text-[13.5px] text-ink-2">
                This stops immediately. {name} will not be able to pay for anything until you allow it again.
              </p>
              <div className="flex gap-2">
                <Button size="lg" onClick={() => setConfirming(false)}>
                  Keep it on
                </Button>
                <Button size="lg" variant="dangerSolid" loading={busy} onClick={turnOff}>
                  Turn off spending
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="w-full sm:w-auto"
              size="lg"
              variant="danger"
              icon={<ShieldOff className="size-4" />}
              onClick={() => setConfirming(true)}
            >
              Turn off spending
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
