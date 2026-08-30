"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { GitBranch, Menu, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { Mark } from "@/components/Logo";
import { DOC_GROUPS } from "./nav";
import { DocsSearch } from "./DocsSearch";

const REPO_URL = "https://github.com/pedroschott/hackatonyuno";

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-6 pb-10">
      {DOC_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{group.label}</div>
          <ul className="space-y-0.5">
            {group.pages.map((page) => {
              const active = pathname === page.href;
              return (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-3 py-1.5 text-[13.5px] transition-colors",
                      active ? "bg-brand-soft font-medium text-brand-ink" : "text-ink-2 hover:bg-line-2 hover:text-ink",
                    )}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-40 border-b border-line bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            className="-ml-1 rounded-md p-1.5 text-muted hover:bg-line-2 hover:text-ink lg:hidden"
          >
            {menuOpen ? <X className="size-4.5" /> : <Menu className="size-4.5" />}
          </button>
          <Link href="/docs" className="flex items-center gap-2" onClick={() => setMenuOpen(false)}>
            <Mark />
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">AgentPay</span>
            <span className="hidden rounded bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand-ink sm:inline">
              Merchant docs
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <DocsSearch className="hidden sm:inline-flex" />
            <Link href="/developers" className="hidden rounded-md bg-brand px-2.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-brand-hover md:inline-block">
              Merchant console
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Repository on GitHub"
              className="rounded-md p-1.5 text-muted hover:bg-line-2 hover:text-ink"
            >
              <GitBranch className="size-4" />
            </a>
          </div>
        </div>
        {menuOpen && (
          <div className="ap-in max-h-[70dvh] overflow-y-auto border-t border-line bg-white px-3 py-4 lg:hidden">
            <DocsSearch className="mb-4 w-full" />
            <SidebarNav pathname={pathname} onNavigate={() => setMenuOpen(false)} />
          </div>
        )}
      </header>

      <div className="mx-auto flex max-w-[1240px] gap-8 px-4 sm:px-6">
        <aside className="hidden w-[236px] shrink-0 lg:block">
          <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto py-8 pr-2">
            <SidebarNav pathname={pathname} />
          </div>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
