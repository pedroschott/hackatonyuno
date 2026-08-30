"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

type CopyButtonProps = {
  value: string;
  label?: string;
  className?: string;
  variant?: "primary";
};

export function CopyButton({ value, label, className, variant }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (variant === "primary") {
    return (
      <Button variant="primary" icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={copy}>
        {copied ? "Copied" : label ?? "Copy"}
      </Button>
    );
  }

  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      onClick={copy}
      className={cn(
        "inline-flex items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
        label ? "h-9 gap-2 px-3 text-[12.5px] font-semibold" : "size-7",
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-[#9ae6b4]" /> : <Copy className="size-3.5" />}
      {label && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}
