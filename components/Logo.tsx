import { cn } from "@/lib/cn";

export function Mark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cn("shrink-0", className)} aria-hidden>
      <rect width="24" height="24" rx="6" fill="#635bff" />
      <path d="M13.2 4.5 7.5 13h4l-.7 6.5L16.5 11h-4l.7-6.5Z" fill="#fff" />
    </svg>
  );
}

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-[-0.01em]", light ? "text-white" : "text-ink", className)}>
      <Mark />
      <span className="text-[15px]">AgentPay</span>
    </span>
  );
}
