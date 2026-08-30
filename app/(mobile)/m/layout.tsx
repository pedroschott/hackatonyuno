"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { useHydrated } from "@/components/StoreProvider";
import { useStore } from "@/lib/store";
import { AuthGate } from "@/components/AuthGate";

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const online = useStore((s) => s.online);
  return (
    <AuthGate>
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-canvas">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-white/90 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur">
        <Link href="/m">
          <Logo />
        </Link>
        <span className="ml-auto" />
        <span className={online ? "size-2 rounded-full bg-success" : "size-2 rounded-full bg-danger"} title={online ? "connected" : "offline"} />
      </header>
      <main className="flex flex-1 flex-col px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-4">
        {hydrated ? children : <div className="h-40 animate-pulse rounded-lg bg-line-2" />}
      </main>
      </div>
    </AuthGate>
  );
}
