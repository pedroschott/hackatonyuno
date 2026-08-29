"use client";

import { useState } from "react";
import { ChevronRight, Copy, Check } from "lucide-react";
import type { Mandate } from "@/lib/types";
import { mandateCanonical, mandateHash } from "@/lib/seed";
import { cn } from "@/lib/cn";
import { Badge, Mono } from "./ui";

export function MandateJson({ mandate, defaultOpen = false, className }: { mandate: Mandate; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const canonical = mandateCanonical(mandate);
  const hash = mandateHash(mandate);
  const json = JSON.stringify(canonical, null, 2);

  return (
    <div className={cn("rounded-md border border-line", className)}>
      <button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-left text-[13px] hover:bg-canvas">
        <ChevronRight className={cn("size-4 shrink-0 text-faint transition-transform", open && "rotate-90")} />
        <span className="font-medium text-ink">What your agent actually holds</span>
        <span className="flex items-center gap-2 sm:ml-auto">
          <span className="text-[12px] text-muted">sha256</span>
          <Mono>{hash.slice(0, 12)}…</Mono>
        </span>
      </button>
      {open && (
        <div className="border-t border-line">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12px] text-muted">
            <Badge tone="brand">AP2 Intent Mandate</Badge>
            <span className="min-w-0">Canonical JSON · sorted keys · this exact string is what the passkey signs.</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(json).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                });
              }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-line-2 hover:text-ink sm:ml-auto"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="max-h-[360px] overflow-auto bg-[#0f1530] px-4 py-3 font-mono text-[11.5px] leading-[1.55] text-[#d9def0]">{json}</pre>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[12px] text-muted">
            <span>
              <span className="text-faint">status</span> — <em>not in the token</em>. Lives in the registry; that’s the kill switch.
            </span>
            {mandate.server_sig && (
              <span>
                <span className="text-faint">registry co-sig</span> <Mono>{mandate.server_sig.slice(0, 12)}…</Mono>
              </span>
            )}
            {mandate.authorization && (
              <span>
                <span className="text-faint">assertion</span> <Mono>{mandate.authorization.assertion.slice(0, 12)}…</Mono>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
