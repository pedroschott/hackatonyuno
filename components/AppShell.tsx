"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, FilePlus2, ScrollText, Store, ExternalLink, Plug, LogOut } from "lucide-react";
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

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[228px] shrink-0 flex-col border-r border-line bg-white">
        <div className="px-4 pt-4 pb-3">
          <Logo />
          <div className="mt-3 rounded-md bg-canvas px-2.5 py-2 text-[12px] leading-tight">
            <div className="font-medium text-ink">Personal account</div>
            <div className="text-muted">Registry · protected</div>
          </div>
        </div>
        <nav className="flex-1 px-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = path === href || (href !== "/dashboard" && path.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                  active ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-line-2",
                )}
              >
                <Icon className={cn("size-4", active ? "text-brand" : "text-faint")} />
                {label}
              </Link>
            );
          })}
          <div className="mt-4 mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wide text-faint">Merchant</div>
          <a
            href="/store"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-line-2"
          >
            <Store className="size-4 text-faint" />
            AutoParts store
            <ExternalLink className="ml-auto size-3.5 text-faint" />
          </a>
        </nav>
        <div className="border-t border-line p-3">
          <button
            onClick={() => createBrowserSupabase().auth.signOut()}
            className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted hover:bg-line-2 hover:text-ink"
          >
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1180px] px-8 py-7">{hydrated ? children : <div className="h-40" />}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-1 text-[13.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
