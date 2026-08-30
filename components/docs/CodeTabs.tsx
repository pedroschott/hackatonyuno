"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";
import { CodeBlock, type CodeSample } from "./prose";

/** Mintlify-style code group: one sample per framework, one tab bar. */
export function CodeTabs({ tabs }: { tabs: Array<{ label: string; sample: CodeSample }> }) {
  const [active, setActive] = useState(0);
  const current = tabs[active] ?? tabs[0];
  return (
    <div className="my-4">
      <div className="flex gap-1 overflow-x-auto border-b border-line pb-px">
        {tabs.map((tab, index) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(index)}
            aria-current={index === active ? "true" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-1.5 text-[13px] font-medium transition-colors",
              index === active ? "border-brand text-brand-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <CodeBlock {...current.sample} className="mt-0 rounded-t-none" />
    </div>
  );
}
