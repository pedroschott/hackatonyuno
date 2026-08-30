"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/AppShell";
import { Card, EmptyState } from "@/components/ui";
import { PurchaseRow } from "@/components/app/PurchaseRow";
import { dayLabel } from "@/lib/plain";
import type { Attempt } from "@/lib/types";

export default function ActivityPage() {
  const attempts = useStore((s) => s.attempts);

  const days = useMemo(() => {
    const groups: { label: string; items: Attempt[] }[] = [];
    for (const attempt of attempts) {
      const label = dayLabel(attempt.created_at);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(attempt);
      else groups.push({ label, items: [attempt] });
    }
    return groups;
  }, [attempts]);

  return (
    <>
      <PageHeader title="Activity" description="Everything your agents paid for — and everything they were stopped from paying for." />

      {days.length === 0 ? (
        <Card>
          <EmptyState title="Nothing yet" description="Purchases show up here the moment an agent tries to pay." />
        </Card>
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <section key={day.label}>
              <h2 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-faint">{day.label}</h2>
              <Card>
                <ul className="divide-y divide-line-2">
                  {day.items.map((attempt) => (
                    <PurchaseRow key={attempt.id} attempt={attempt} explain />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
