"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "./Logo";
import { useHydrated } from "./StoreProvider";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// Three places, that is the whole app: which mandates are active, what happened under them, who is connected.
const TABS = [
  { href: "/dashboard", label: "Summary" },
  { href: "/activity", label: "Activity" },
  { href: "/connect", label: "Agents" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const hydrated = useHydrated();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    createBrowserSupabase()
      .auth.getUser()
      .then((result: { data: { user: { email?: string } | null } }) => {
        if (active) setEmail(result.data.user?.email ?? null);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[880px] items-center gap-3 px-4 pb-2.5 pt-[max(12px,env(safe-area-inset-top))] sm:px-6">
          <Link href="/dashboard" aria-label="AgentPay home">
            <Logo />
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <span className="hidden min-w-0 truncate text-[12.5px] text-muted sm:inline">{email ?? ""}</span>
            <button
              onClick={() => createBrowserSupabase().auth.signOut()}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] text-muted hover:bg-line-2 hover:text-ink"
            >
              <LogOut className="size-3.5" /> Sign out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[880px] gap-1 overflow-x-auto px-2 sm:px-4">
          {TABS.map(({ href, label }) => {
            const active = path === href || path.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[14px] font-medium transition-colors",
                  active ? "border-brand text-brand-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[880px] px-4 py-6 sm:px-6 sm:py-8">{hydrated ? children : <div className="h-40" />}</div>
      </main>

      <footer className="border-t border-line px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 sm:px-6">
        <div className="mx-auto flex max-w-[880px] flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-faint">
          <span>AgentPay</span>
          <Link href="/audit" className="hover:text-ink">
            Security log
          </Link>
          <a href="/store" target="_blank" rel="noreferrer" className="hover:text-ink">
            Demo store
          </a>
        </div>
      </footer>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink sm:text-[24px]">{title}</h1>
        {description && <p className="mt-1 text-[14px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}
