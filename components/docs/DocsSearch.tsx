"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";

import { cn } from "@/lib/cn";
import { DOC_GROUPS, DOC_PAGES } from "./nav";

function groupOf(href: string) {
  return DOC_GROUPS.find((group) => group.pages.some((page) => page.href === href))?.label ?? "";
}

/** Client-side search over the static page index. No index server, no network. */
export function DocsSearch({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  function openSearch() {
    setQuery("");
    setCursor(0);
    setOpen(true);
  }

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return DOC_PAGES;
    return DOC_PAGES.filter((page) => {
      const haystack = [page.title, page.description, ...(page.keywords ?? [])].join(" ").toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => {
          if (value) return false;
          setQuery("");
          setCursor(0);
          return true;
        });
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={openSearch}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-md border border-line bg-white px-2.5 text-[13px] text-muted transition-colors hover:border-faint",
          className,
        )}
      >
        <Search className="size-3.5" />
        <span>Search docs</span>
        <kbd className="ml-2 hidden rounded border border-line bg-canvas px-1 font-sans text-[11px] text-faint sm:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-4 pt-[12vh] backdrop-blur-[2px]"
          onMouseDown={() => setOpen(false)}
        >
          <div
            className="ap-in w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-[var(--shadow-pop)]"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal
            aria-label="Search documentation"
          >
            <div className="flex items-center gap-2 border-b border-line px-3.5">
              <Search className="size-4 shrink-0 text-faint" />
              <input
                autoFocus
                value={query}
                placeholder="Search the merchant docs…"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCursor(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setCursor((value) => Math.min(value + 1, results.length - 1));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setCursor((value) => Math.max(value - 1, 0));
                  }
                  if (event.key === "Enter" && results[cursor]) {
                    setOpen(false);
                    router.push(results[cursor].href);
                  }
                }}
                className="h-11 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
              />
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-1.5">
              {results.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-muted">No matching page.</div>}
              {results.map((page, index) => (
                <button
                  key={page.href}
                  type="button"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => {
                    setOpen(false);
                    router.push(page.href);
                  }}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left",
                    index === cursor ? "bg-brand-soft" : "hover:bg-canvas",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13.5px] font-medium text-ink">{page.title}</span>
                      <span className="text-[11.5px] text-faint">{groupOf(page.href)}</span>
                    </div>
                    <div className="truncate text-[12.5px] text-muted">{page.description}</div>
                  </div>
                  {index === cursor && <CornerDownLeft className="mt-1 size-3.5 shrink-0 text-brand-ink" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
