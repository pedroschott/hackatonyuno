"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, ShieldCheck, TimerReset, Zap } from "lucide-react";
import { useStore } from "@/lib/store";
import type { Attempt, Scenario } from "@/lib/types";
import { Button, Card, Select, Mono } from "../ui";
import { cn } from "@/lib/cn";

export const SCENARIOS: { value: Scenario; label: string; hint: string }[] = [
  { value: "standard", label: "Standard tire set — R$ 1.548", hint: "within limit" },
  { value: "premium", label: "Premium tire set — R$ 1.720", hint: "over per-purchase limit → escalate" },
  { value: "accessory", label: "Hydraulic jack — R$ 389", hint: "accessories ∉ scope" },
  { value: "pneufast", label: "Tire set at PneuFast — R$ 1.490", hint: "merchant ∉ scope" },
  { value: "unsigned", label: "Unsigned request", hint: "impersonated agent" },
  { value: "replay", label: "Replay last signature", hint: "reused nonce" },
];

export function AgentPanel() {
  const agent = useStore((s) => s.agent);
  const setAgent = useStore((s) => s.setAgent);
  const checkout = useStore((s) => s.checkout);
  const heldMandate = useStore((s) => {
    const currentMandateId = s.agents[0]?.currentMandateId;
    return s.mandates.find((mandate) => mandate.id === currentMandateId);
  });
  const mandateId = heldMandate?.id ?? null;

  const [remaining, setRemaining] = useState(0);
  const [trial, setTrial] = useState<
    | { status: "idle" }
    | { status: "running"; mandateId: string; startedAt: number; remainingMs: number }
    | { status: "complete"; mandateId: string; attempt: Attempt }
    | { status: "error"; mandateId: string; message: string }
  >({ status: "idle" });
  const dueRef = useRef<number | null>(null);
  const targetRef = useRef(agent.target);
  const trialStartedAt = trial.status === "running" ? trial.startedAt : null;
  useEffect(() => {
    targetRef.current = agent.target;
  }, [agent.target]);

  useEffect(() => {
    if (!agent.running) {
      dueRef.current = null;
      return;
    }
    dueRef.current = Date.now() + agent.intervalMs;
    const id = setInterval(() => {
      const t = Date.now();
      if (dueRef.current !== null && t >= dueRef.current) {
        checkout(targetRef.current, { source: "heartbeat" });
        dueRef.current = t + agent.intervalMs;
      }
      setRemaining(Math.max(0, (dueRef.current ?? t) - t));
    }, 200);
    return () => clearInterval(id);
  }, [agent.running, agent.intervalMs, checkout]);

  useEffect(() => {
    if (trialStartedAt === null) return;
    const update = () => {
      const remainingMs = Math.max(0, 8_000 - (Date.now() - trialStartedAt));
      setTrial((current) =>
        current.status === "running" ? { ...current, remainingMs } : current,
      );
    };
    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, [trialStartedAt]);

  const runRevocationTrial = async () => {
    if (!mandateId || trial.status === "running") return;
    if (agent.running) await setAgent({ running: false });
    const trialMandateId = mandateId;
    setTrial({
      status: "running",
      mandateId: trialMandateId,
      startedAt: Date.now(),
      remainingMs: 8_000,
    });
    try {
      const attempt = await checkout("standard", {
        source: "trial",
        revocation_window_ms: 8_000,
      });
      setTrial({ status: "complete", mandateId: trialMandateId, attempt });
    } catch (cause) {
      setTrial({
        status: "error",
        mandateId: trialMandateId,
        message: cause instanceof Error ? cause.message : "The trial could not finish",
      });
    }
  };

  const pct = agent.running ? 100 - Math.round((remaining / agent.intervalMs) * 100) : 0;
  const scenario = SCENARIOS.find((s) => s.value === agent.target)!;

  return (
    <Card>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className={cn("relative size-2.5 rounded-full", agent.running ? "ap-dot bg-success text-success" : "bg-faint")} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">FleetBuyer</div>
          <div className="text-[12px] text-muted">
            Restock watcher · holds <Mono>{mandateId ?? "no mandate"}</Mono>
          </div>
        </div>
        <Button
          size="sm"
          variant={agent.running ? "secondary" : "primary"}
          icon={agent.running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          onClick={() => setAgent({ running: !agent.running })}
        >
          {agent.running ? "Pause" : "Start heartbeat"}
        </Button>
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="mb-1 flex items-center justify-between text-[12px] text-muted">
          <span>{agent.running ? `Next attempt in ${(remaining / 1000).toFixed(1)}s` : `Paused · every ${agent.intervalMs / 1000}s when running`}</span>
          <span className="text-faint">{scenario.hint}</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-line-2">
          <div className="h-full bg-brand transition-[width] duration-200 ease-linear" style={{ width: `${agent.running ? pct : 0}%` }} />
        </div>
      </div>

      <div className="space-y-2 border-t border-line px-4 py-3">
        <Select value={agent.target} onChange={(e) => setAgent({ target: e.target.value as Scenario })}>
          {SCENARIOS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Button className="w-full" icon={<Zap className="size-3.5" />} onClick={() => checkout(agent.target, { source: "manual" })}>
          Trigger attempt now
        </Button>
        <Button
          className="w-full"
          variant="danger"
          icon={<TimerReset className="size-3.5" />}
          disabled={heldMandate?.status !== "active" || trial.status === "running"}
          onClick={runRevocationTrial}
        >
          {trial.status === "running" ? "Revocation window open" : "Run mid-turn revocation trial"}
        </Button>
        {trial.status === "running" && (
          <div className="ap-in rounded-md border border-brand/25 bg-brand-soft px-3 py-2.5 text-[12px] leading-relaxed text-brand-ink">
            <div className="flex items-center gap-2 font-semibold">
              <TimerReset className="size-3.5" />
              Final registry check in {(trial.remainingMs / 1000).toFixed(1)}s
            </div>
            <p className="mt-1">
              Checkout is in flight under <Mono>{trial.mandateId}</Mono>. Revoke it now from the mandate card or phone. No payment token exists yet.
            </p>
          </div>
        )}
        {trial.status === "complete" && trial.attempt.reason_code === "MANDATE_REVOKED" && (
          <div className="ap-in rounded-md border border-success/25 bg-success-soft px-3 py-2.5 text-[12px] leading-relaxed text-success-ink">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="size-3.5" /> Trial passed
            </div>
            <p className="mt-1">
              The final live check returned <Mono>MANDATE_REVOKED</Mono>. No payment token was issued.
            </p>
          </div>
        )}
        {trial.status === "complete" && trial.attempt.reason_code !== "MANDATE_REVOKED" && (
          <div className="ap-in rounded-md border border-warn/25 bg-warn-soft px-3 py-2.5 text-[12px] leading-relaxed text-warn-ink">
            {trial.attempt.decision === "approved"
              ? "The checkout committed before a revocation. Authorize a fresh mandate and retry the 8-second window."
              : `The trial was refused with ${trial.attempt.reason_code ?? "another policy rule"}. Use a fresh mandate with remaining budget and retry.`}
          </div>
        )}
        {trial.status === "error" && (
          <div className="ap-in rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-[12px] text-danger-ink">
            {trial.message}
          </div>
        )}
        <p className="text-[11.5px] leading-snug text-faint">
          The model proposes; the policy disposes. The agent can <em>try</em> anything — only the registry’s policy engine can approve.
        </p>
      </div>
    </Card>
  );
}
