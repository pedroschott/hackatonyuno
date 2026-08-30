"use client";

import { Boxes, BookOpen, Building2, ChevronDown, ExternalLink, Home, LogOut, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo } from "@/components/Logo";
import { cn } from "@/lib/cn";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const NAV = [
  { href: "/developers", label: "Overview", icon: Home },
  { href: "/developers/merchants", label: "Merchants", icon: Building2 },
  { href: "/developers/stores", label: "Supported stores", icon: Store },
];

export function DeveloperShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [email, setEmail] = useState("");

  useEffect(() => {
    let active = true;
    void createBrowserSupabase().auth.getUser().then((result: { data: { user: { email?: string } | null } }) => {
      if (active) setEmail(result.data.user?.email ?? "");
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-dvh bg-[#f6f8fa] text-ink lg:grid lg:grid-cols-[236px_1fr]">
      <aside className="border-b border-line bg-[#0a2540] text-white lg:fixed lg:inset-y-0 lg:w-[236px] lg:border-b-0">
        <div className="flex h-16 items-center px-5">
          <Link href="/developers" aria-label="AgentPay Developers" className="rounded bg-white px-2.5 py-1.5">
            <Logo />
          </Link>
        </div>
        <div className="border-y border-white/10 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50">Workspace</div>
          <div className="mt-1 flex items-center gap-2 text-[13px] font-medium">
            <Boxes className="size-3.5 text-[#7a73ff]" /> AgentPay Developers
            <ChevronDown className="ml-auto size-3.5 text-white/40" />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 py-3 lg:block lg:space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/developers" ? path === href : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
                  active ? "bg-white/12 text-white" : "text-white/65 hover:bg-white/8 hover:text-white",
                )}
              >
                <Icon className="size-4" /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 pb-3 lg:absolute lg:inset-x-0 lg:bottom-0">
          <Link href="/docs" className="flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px] text-white/60 hover:bg-white/8 hover:text-white">
            <BookOpen className="size-3.5" /> Documentation <ExternalLink className="ml-auto size-3" />
          </Link>
          <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px] text-white/60 hover:bg-white/8 hover:text-white">
            <Home className="size-3.5" /> Buyer dashboard
          </Link>
          <button
            onClick={() => createBrowserSupabase().auth.signOut()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12.5px] text-white/60 hover:bg-white/8 hover:text-white"
          >
            <LogOut className="size-3.5" /> <span className="min-w-0 truncate">{email || "Sign out"}</span>
          </button>
        </div>
      </aside>
      <div className="min-w-0 lg:col-start-2">
        <header className="sticky top-0 z-20 flex h-14 items-center border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Developers</span>
          <span className="ml-auto rounded-full bg-brand-soft px-2 py-1 text-[11px] font-semibold text-brand-ink">Test mode</span>
        </header>
        <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
