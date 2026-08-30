"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Zap } from "lucide-react";
import { useStore } from "@/lib/store";
import type { Scenario } from "@/lib/types";
import { Button, Card, Select, Mono } from "../ui";
import { cn } from "@/lib/cn";

export const SCENARIOS: { value: Scenario; label: string; hint: string }[] = [
  { value: "standard", label: "Standard tire set — $1,548", hint: "within limit" },
  { value: "premium", label: "Premium tire set — $1,720", hint: "over per-purchase limit → escalate" },
  { value: "accessory", label: "Hydraulic jack — $389", hint: "accessories ∉ scope" },
  { value: "pneufast", label: "Tire set at PneuFast — $1,490", hint: "merchant ∉ scope" },
  { value: "unsigned", label: "Unsigned request", hint: "impersonated agent" },
  { value: "replay", label: "Replay last signature", hint: "reused nonce" },
];

export function AgentPanel() {
  const agent = useStore((s) => s.agent);
  const setAgent = useStore((s) => s.setAgent);
  const checkout = useStore((s) => s.checkout);
  const mandateId = useStore((s) => s.agents[0].currentMandateId);

  const [remaining, setRemaining] = useState(0);
  const dueRef = useRef<number | null>(null);
  const targetRef = useRef(agent.target);
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
        <p className="text-[11.5px] leading-snug text-faint">
          The model proposes; the policy disposes. The agent can <em>try</em> anything — only the registry’s policy engine can approve.
        </p>
      </div>
    </Card>
  );
}
