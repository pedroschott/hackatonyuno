"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutGrid, FilePlus2, ScrollText, Store, ExternalLink, Plug, LogOut, Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "./Logo";
import { useHydrated } from "./StoreProvider";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/contracts/new", label: "New contract", icon: FilePlus2 },
  { href: "/audit", label: "Audit log", icon: ScrollText },
  { href: "/connect", label: "Connect an agent", icon: Plug },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const hydrated = useHydrated();
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white/95 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur lg:hidden">
        <button
          onClick={() => setMenuOpen(true)}
          className="-ml-1.5 rounded-md p-1.5 text-ink-2 hover:bg-line-2"
          aria-label="Open navigation"
          aria-expanded={menuOpen}
        >
          <Menu className="size-5" />
        </button>
        <Link href="/dashboard">
          <Logo />
        </Link>
        <span className="ml-auto truncate text-[12px] text-muted">Personal account</span>
      </header>

      {menuOpen && <div className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] lg:hidden" onClick={close} />}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[264px] max-w-[85vw] flex-col border-r border-line bg-white",
          // Tailwind v4 slides via the `translate` property, not `transform`; visibility rides along so the
          // closed drawer leaves the tab order only once it has finished sliding away.
          "transition-[translate,visibility] duration-200 ease-out",
          "lg:visible lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-[228px] lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:transition-none",
          menuOpen ? "visible translate-x-0" : "invisible -translate-x-full",
        )}
      >
        <div className="px-4 pb-3 pt-[max(16px,env(safe-area-inset-top))] lg:pt-4">
          <div className="flex items-center">
            <Logo />
            <button
              onClick={close}
              className="-mr-1.5 ml-auto rounded-md p-1.5 text-muted hover:bg-line-2 hover:text-ink lg:hidden"
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-3 rounded-md bg-canvas px-2.5 py-2 text-[12px] leading-tight">
            <div className="font-medium text-ink">Personal account</div>
            <div className="text-muted">Registry · protected</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = path === href || (href !== "/dashboard" && path.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                onClick={close}
                className={cn(
                  "mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors lg:py-1.5",
                  active ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-line-2",
                )}
              >
                <Icon className={cn("size-4 shrink-0", active ? "text-brand" : "text-faint")} />
                {label}
              </Link>
            );
          })}
          <div className="mt-4 mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wide text-faint">Merchant</div>
          <a
            href="/store"
            target="_blank"
            rel="noreferrer"
            onClick={close}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-ink-2 hover:bg-line-2 lg:py-1.5"
          >
            <Store className="size-4 shrink-0 text-faint" />
            AutoParts store
            <ExternalLink className="ml-auto size-3.5 shrink-0 text-faint" />
          </a>
        </nav>
        <div className="border-t border-line p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button
            onClick={() => createBrowserSupabase().auth.signOut()}
            className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted hover:bg-line-2 hover:text-ink"
          >
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1180px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{hydrated ? children : <div className="h-40" />}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink sm:text-[22px]">{title}</h1>
        {description && <p className="mt-1 text-[13.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}
