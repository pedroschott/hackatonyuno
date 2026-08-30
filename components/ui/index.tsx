"use client";

import { cn } from "@/lib/cn";
import { Loader2, X } from "lucide-react";
import { useEffect } from "react";

/* ---------- Button ---------- */
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "dangerSolid" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
};

export function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-[background,box-shadow,color] duration-150 focus:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "h-7 px-2.5 text-[12.5px]", md: "h-8 px-3 text-[13px]", lg: "h-10 px-4 text-[14px]" }[size];
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-hover shadow-[0_1px_1px_rgba(0,0,0,.08),inset_0_1px_0_rgba(255,255,255,.15)]",
    secondary: "bg-white text-ink shadow-[var(--shadow-card)] hover:bg-canvas",
    danger: "bg-white text-danger-ink shadow-[var(--shadow-card)] hover:bg-danger-soft",
    dangerSolid: "bg-danger text-white hover:bg-[#c8143a] shadow-[0_1px_1px_rgba(0,0,0,.08)]",
    ghost: "bg-transparent text-ink-2 hover:bg-line-2",
  }[variant];
  return (
    <button className={cn(base, sizes, variants, className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ---------- Card ---------- */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-lg bg-surface shadow-[var(--shadow-card)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- Badge ---------- */
export function Badge({ tone = "neutral", className, children, dot }: { tone?: "neutral" | "success" | "danger" | "warn" | "brand"; className?: string; children: React.ReactNode; dot?: boolean }) {
  const tones = {
    neutral: "bg-line-2 text-ink-2",
    success: "bg-success-soft text-success-ink",
    danger: "bg-danger-soft text-danger-ink",
    warn: "bg-warn-soft text-warn-ink",
    brand: "bg-brand-soft text-brand-ink",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium leading-4", tones, className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ---------- Mono ---------- */
export function Mono({ className, children, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("rounded bg-line-2 px-1 py-px font-mono text-[11.5px] text-ink-2", className)} {...rest}>
      {children}
    </span>
  );
}

/* ---------- Form ---------- */
export function Label({ className, children, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("block text-[13px] font-medium text-ink", className)} {...rest}>
      {children}
    </label>
  );
}

export function Field({ label, hint, error, children, className }: { label: React.ReactNode; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-[12px] text-danger-ink">{error}</p> : hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

const inputCls =
  "h-9 w-full rounded-md border border-line bg-white px-3 text-[13.5px] text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:shadow-[var(--shadow-focus)] disabled:bg-canvas disabled:text-muted";

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputCls, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputCls, "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23697386%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[position:right_10px_center] bg-no-repeat pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function MoneyInput({ valueCents, onChange, className, ...rest }: { valueCents: number; onChange: (cents: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px] text-muted">$</span>
      <input
        type="number"
        min={0}
        step={1}
        className={cn(inputCls, "pl-9 tabular", className)}
        value={Math.round(valueCents / 100)}
        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value || 0) * 100)))}
        {...rest}
      />
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-[13px] text-ink-2">
      <span className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-brand" : "bg-[#cdd3dc]")}>
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </span>
      {label}
    </button>
  );
}

/* ---------- Modal ---------- */
export function Modal({ open, onClose, title, children, width = "max-w-md", dismissible = true }: { open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; width?: string; dismissible?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismissible && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, dismissible]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink/40 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={() => dismissible && onClose()}>
      <div
        className={cn("ap-in max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-pop)] sm:max-h-[90dvh] sm:rounded-xl sm:pb-0", width)}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
      >
        {title && (
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h3 className="text-[15px] font-semibold">{title}</h3>
            {dismissible && (
              <button onClick={onClose} className="rounded p-1 text-muted hover:bg-line-2 hover:text-ink" aria-label="Close">
                <X className="size-4" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ---------- Misc ---------- */
export function Stat({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[12px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold text-ink tabular">{value}</div>
      {sub && <div className="text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {description && <div className="mt-1 max-w-sm text-[13px] text-muted">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Meter({ value, max, tone = "brand" }: { value: number; max: number; tone?: "brand" | "danger" | "warn" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = { brand: "bg-brand", danger: "bg-danger", warn: "bg-warn" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-2">
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
