import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { docGroupLabel, docMeta, docNeighbors } from "./nav";

export type DocSection = {
  id: string;
  title: string;
  /** 2 renders a top-level heading, 3 a nested one. Both appear in the page outline. */
  level?: 2 | 3;
  body: ReactNode;
};

const REPO_URL = "https://github.com/pedroschott/hackatonyuno";

/** Page metadata comes from the same nav entry the sidebar and search use. */
export function docMetadata(href: string): Metadata {
  const meta = docMeta(href);
  return {
    title: `${meta.title} — AgentPay merchant docs`,
    description: meta.description,
    alternates: { canonical: href },
  };
}

function Heading({ section }: { section: DocSection }) {
  const Tag = section.level === 3 ? "h3" : "h2";
  return (
    <Tag
      id={section.id}
      className={cn(
        "group scroll-mt-20 font-semibold tracking-[-0.01em] text-ink",
        section.level === 3 ? "mt-7 text-[15.5px]" : "mt-10 text-[19px]",
      )}
    >
      <a href={`#${section.id}`} className="no-underline">
        {section.title}
        <span className="ml-2 text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
          #
        </span>
      </a>
    </Tag>
  );
}

export function DocPage({ href, intro, sections }: { href: string; intro?: ReactNode; sections: DocSection[] }) {
  const meta = docMeta(href);
  const { previous, next } = docNeighbors(href);
  const filePath = href === "/docs" ? "app/(docs)/docs/page.tsx" : `app/(docs)${href}/page.tsx`;

  return (
    <div className="flex gap-10">
      <article className="min-w-0 max-w-[46rem] flex-1 py-8 sm:py-10">
        <div className="text-[12.5px] font-medium text-brand-ink">{docGroupLabel(href)}</div>
        <h1 className="mt-1 text-[30px] font-semibold tracking-[-0.02em] text-ink">{meta.title}</h1>
        <p className="mt-2 text-[16px] leading-[1.6] text-muted">{meta.description}</p>

        {intro}

        {sections.map((section) => (
          <section key={section.id}>
            <Heading section={section} />
            {section.body}
          </section>
        ))}

        <hr className="mt-12 border-line" />

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <a
            href={`${REPO_URL}/blob/main/${filePath}`}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] text-muted hover:text-ink"
          >
            Edit this page on GitHub
          </a>
        </div>

        <nav className="mt-4 grid gap-3 sm:grid-cols-2">
          {previous ? (
            <Link
              href={previous.href}
              className="group rounded-xl bg-surface px-4 py-3 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-pop)]"
            >
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                <ArrowLeft className="size-3.5" /> Previous
              </span>
              <span className="mt-0.5 block text-[14px] font-medium text-ink">{previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={next.href}
              className="group rounded-xl bg-surface px-4 py-3 text-right shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-pop)] sm:col-start-2"
            >
              <span className="flex items-center justify-end gap-1.5 text-[12px] text-muted">
                Next <ArrowRight className="size-3.5" />
              </span>
              <span className="mt-0.5 block text-[14px] font-medium text-ink">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>

      <aside className="hidden w-[190px] shrink-0 xl:block">
        <div className="sticky top-14 py-10">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">On this page</div>
          <ul className="space-y-1.5 border-l border-line">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className={cn(
                    "-ml-px block border-l border-transparent text-[12.5px] leading-[1.4] text-muted hover:border-brand hover:text-ink",
                    section.level === 3 ? "pl-6" : "pl-3",
                  )}
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
