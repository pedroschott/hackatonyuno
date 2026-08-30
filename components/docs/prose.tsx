import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Info, Lightbulb } from "lucide-react";

import { cn } from "@/lib/cn";
import { CopyButton } from "./CopyButton";

/* ---------- Syntax highlighting ----------
 * Deliberately dependency-free: a small tokenizer is enough to make the samples
 * readable, and it keeps the docs inside the app bundle with no build step. */

export type CodeLang = "ts" | "tsx" | "js" | "json" | "bash" | "http" | "text";

type TokenPattern = { pattern: RegExp; groups: string[] };

const CODE_PATTERN: TokenPattern = {
  pattern:
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("[^"\n]*"(?=\s*:))|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*(?:\.\d+)?\b)|(\b(?:import|export|from|const|let|var|function|return|async|await|type|interface|new|if|else|for|of|in|try|catch|throw|class|extends|default|as|satisfies|true|false|null|undefined|void)\b)/g,
  groups: ["comment", "prop", "str", "num", "kw"],
};

const SHELL_PATTERN: TokenPattern = {
  pattern:
    /(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(^\s*(?:npm|npx|pnpm|yarn|bun|node|curl|git|cd|mkdir|cp|mv|echo|export|open)\b)|(\s-{1,2}[A-Za-z][\w-]*)/gm,
  groups: ["comment", "str", "cmd", "flag"],
};

const TOKEN_CLASS: Record<string, string> = {
  comment: "text-[#7f8aa3] italic",
  str: "text-[#9ae6b4]",
  prop: "text-[#7dd3fc]",
  num: "text-[#f6ad55]",
  kw: "text-[#c4b5fd]",
  cmd: "text-[#7dd3fc] font-medium",
  flag: "text-[#f6ad55]",
};

function highlight(code: string, lang: CodeLang): ReactNode[] {
  if (lang === "text" || lang === "http") return [code];
  const { pattern, groups } = lang === "bash" ? SHELL_PATTERN : CODE_PATTERN;
  pattern.lastIndex = 0;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const index = groups.findIndex((_, position) => match?.[position + 1] !== undefined);
    const value = index >= 0 ? match[index + 1] : undefined;
    if (value === undefined) continue;
    if (match.index > cursor) nodes.push(code.slice(cursor, match.index));
    nodes.push(
      <span key={`${match.index}-${groups[index]}`} className={TOKEN_CLASS[groups[index]]}>
        {value}
      </span>,
    );
    cursor = match.index + value.length;
  }
  if (cursor < code.length) nodes.push(code.slice(cursor));
  return nodes;
}

const LANG_LABEL: Record<CodeLang, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  json: "JSON",
  bash: "Terminal",
  http: "HTTP",
  text: "Text",
};

export type CodeSample = {
  code: string;
  lang?: CodeLang;
  filename?: string;
};

export function CodeBlock({ code, lang = "ts", filename, className }: CodeSample & { className?: string }) {
  const body = code.replace(/^\n+|\n+$/g, "");
  return (
    <figure className={cn("my-4 overflow-hidden rounded-xl bg-[#161a2e] shadow-[var(--shadow-card)]", className)}>
      <figcaption className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="truncate font-mono text-[11.5px] text-white/60">{filename ?? LANG_LABEL[lang]}</span>
        <CopyButton value={body} className="ml-auto" />
      </figcaption>
      <pre className="overflow-x-auto px-4 py-3.5 text-[12.5px] leading-[1.75] text-[#e5e9f0]">
        <code className="font-mono">{highlight(body, lang)}</code>
      </pre>
    </figure>
  );
}

/* ---------- Prose ---------- */

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("my-3 text-[14.5px] leading-[1.75] text-ink-2", className)}>{children}</p>;
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="my-3 text-[15.5px] leading-[1.7] text-ink-2">{children}</p>;
}

export function List({ children, ordered }: { children: ReactNode; ordered?: boolean }) {
  const cls = "my-3 space-y-1.5 pl-5 text-[14.5px] leading-[1.7] text-ink-2 marker:text-faint";
  return ordered ? (
    <ol className={cn(cls, "list-decimal")}>{children}</ol>
  ) : (
    <ul className={cn(cls, "list-disc")}>{children}</ul>
  );
}

export function LI({ children }: { children: ReactNode }) {
  return <li className="pl-1">{children}</li>;
}

export function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded border border-line bg-canvas px-1 py-0.5 font-mono text-[12.5px] text-ink">{children}</code>
  );
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http") || href.startsWith("mailto:");
  const className = "font-medium text-brand-ink underline decoration-brand/30 underline-offset-2 hover:decoration-brand";
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/* ---------- Callout ---------- */

const CALLOUT = {
  note: { icon: Info, wrap: "border-brand/25 bg-brand-soft/60", tint: "text-brand-ink" },
  tip: { icon: Lightbulb, wrap: "border-success/25 bg-success-soft/70", tint: "text-success-ink" },
  warn: { icon: AlertTriangle, wrap: "border-warn/30 bg-warn-soft/70", tint: "text-warn-ink" },
  check: { icon: CheckCircle2, wrap: "border-success/25 bg-success-soft/70", tint: "text-success-ink" },
} as const;

export function Callout({ tone = "note", title, children }: { tone?: keyof typeof CALLOUT; title?: string; children: ReactNode }) {
  const { icon: Icon, wrap, tint } = CALLOUT[tone];
  return (
    <div className={cn("my-4 flex gap-3 rounded-lg border px-4 py-3", wrap)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", tint)} />
      <div className="min-w-0 text-[13.5px] leading-[1.65] text-ink-2 [&>p]:my-0 [&>p+p]:mt-2">
        {title && <div className={cn("mb-0.5 text-[13.5px] font-semibold", tint)}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

/* ---------- Steps ---------- */

export function Steps({ children }: { children: ReactNode }) {
  return <div className="my-5 space-y-0">{children}</div>;
}

export function Step({ n, title, children, last }: { n: number; title: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={cn("relative pl-9", last ? "pb-0" : "pb-5")}>
      {!last && <span className="absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-px bg-line" aria-hidden />}
      <span className="absolute left-0 top-0 inline-flex size-[27px] items-center justify-center rounded-full bg-brand-soft text-[12.5px] font-semibold text-brand-ink">
        {n}
      </span>
      <h3 className="mt-0.5 text-[15px] font-semibold text-ink">{title}</h3>
      <div className="[&>*:first-child]:mt-2">{children}</div>
    </div>
  );
}

/* ---------- Cards ---------- */

export function Cards({ children }: { children: ReactNode }) {
  return <div className="my-5 grid gap-3 sm:grid-cols-2">{children}</div>;
}

export function LinkCard({ href, title, description, icon }: { href: string; title: string; description: string; icon?: ReactNode }) {
  const external = href.startsWith("http");
  const content = (
    <>
      <div className="flex items-center gap-2">
        {icon && <span className="text-brand">{icon}</span>}
        <span className="text-[14px] font-semibold text-ink">{title}</span>
        {external && <ArrowUpRight className="size-3.5 text-faint" />}
      </div>
      <p className="mt-1 text-[13px] leading-[1.6] text-muted">{description}</p>
    </>
  );
  const className =
    "block rounded-xl bg-surface px-4 py-3.5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-pop)]";
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {content}
    </a>
  ) : (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}

/* ---------- Tables ---------- */

export function PropTable({ rows }: { rows: Array<{ name: string; type: string; required?: boolean; description: ReactNode }> }) {
  return (
    <div className="my-4 overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-card)]">
      {rows.map((row, index) => (
        <div key={row.name} className={cn("px-4 py-3", index > 0 && "border-t border-line-2")}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <code className="font-mono text-[12.5px] font-medium text-ink">{row.name}</code>
            <span className="font-mono text-[11.5px] text-muted">{row.type}</span>
            {row.required ? (
              <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-danger-ink">
                required
              </span>
            ) : (
              <span className="rounded bg-line-2 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-muted">
                optional
              </span>
            )}
          </div>
          <div className="mt-1 text-[13.5px] leading-[1.65] text-ink-2">{row.description}</div>
        </div>
      ))}
    </div>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="my-4 overflow-x-auto rounded-xl bg-surface shadow-[var(--shadow-card)]">
      <table className="w-full border-collapse text-left text-[13.5px]">
        <thead>
          <tr className="border-b border-line">
            {head.map((cell) => (
              <th key={cell} className="whitespace-nowrap px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-line-2 last:border-0 align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-2.5 leading-[1.6] text-ink-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
