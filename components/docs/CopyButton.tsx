"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-[#9ae6b4]" /> : <Copy className="size-3.5" />}
    </button>
  );
}
