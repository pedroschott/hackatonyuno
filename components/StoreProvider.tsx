"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect } from "react";
import { useStore } from "@/lib/store";

const HydratedCtx = createContext(false);
export const useHydrated = () => useContext(HydratedCtx);

const POLL_MS = 1500;

/** Server is the source of truth; every panel (desktop, phone, store) polls /api/state. */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useStore((s) => s.hydrated);
  // The landing page and the documentation site are public and read no account
  // state, so they never poll.
  const path = usePathname();
  const polls = path !== "/" && !path.startsWith("/docs");

  useEffect(() => {
    if (!polls) return;
    const refresh = useStore.getState().refresh;
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [polls]);

  return <HydratedCtx.Provider value={hydrated}>{children}</HydratedCtx.Provider>;
}
