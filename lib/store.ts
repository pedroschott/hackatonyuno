"use client";

import { create } from "zustand";
import type { Approval, Attempt, Mandate, MandateLimits, Scenario, VaultCard } from "./types";
import type { AgentState, CheckoutOpts, Data, MandateDraftInput } from "./engine";
import { usageFor } from "./engine";
import type { PasskeyResult } from "./passkey";

export type Actor = "user:cfo" | "judge";
export type { AgentState, MandateDraftInput };
export { usageFor };

type Client = {
  hydrated: boolean;
  online: boolean;
  publicBaseUrl: string;
  serverTime: string | null;
  actor: Actor;

  refresh: () => Promise<void>;
  createDraft: (input: MandateDraftInput) => Promise<Mandate>;
  authorizeMandate: (id: string, pk: PasskeyResult) => Promise<Mandate>;
  declineMandate: (id: string, actor?: string) => Promise<void>;
  revokeMandate: (id: string, actor: string) => Promise<void>;
  updateLimits: (id: string, limits: Partial<MandateLimits>, actor: string) => Promise<void>;
  checkout: (scenario: Scenario, opts?: CheckoutOpts) => Promise<Attempt>;
  decideApproval: (id: string, decision: "approved" | "denied", actor: string, pk?: PasskeyResult) => Promise<{ approval: Approval; retry?: Attempt }>;
  addCard: (card: Omit<VaultCard, "id">) => Promise<VaultCard>;
  setAgent: (patch: Partial<AgentState>) => Promise<void>;
  setActor: (actor: Actor) => void;
  reset: () => Promise<void>;
};

export type Store = Data & Client;

const empty: Data = {
  cards: [], agents: [], merchants: [], products: [], mandates: [], attempts: [], approvals: [], audit: [], usedNonces: [],
  agent: { running: false, target: "standard", intervalMs: 8000 },
};

type Envelope = { state?: Data; public_base_url?: string; server_time?: string; error?: string } & Record<string, unknown>;

async function api<T extends Envelope = Envelope>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const j = (await res.json()) as T;
  if (!res.ok) throw new Error(j.error ?? res.statusText);
  if (j.state) applyEnvelope(j);
  return j;
}

function applyEnvelope(j: Envelope) {
  useStore.setState({
    ...(j.state ?? {}),
    hydrated: true,
    online: true,
    publicBaseUrl: j.public_base_url ?? useStore.getState().publicBaseUrl,
    serverTime: j.server_time ?? null,
  });
}

export const useStore = create<Store>()((set, get) => ({
  ...empty,
  hydrated: false,
  online: true,
  publicBaseUrl: "",
  serverTime: null,
  actor: "user:cfo",

  refresh: async () => {
    try {
      const j = await api("/api/state", undefined, "GET");
      applyEnvelope(j);
    } catch {
      set({ online: false });
    }
  },

  createDraft: async (input) => (await api<Envelope & { mandate: Mandate }>("/api/mandates", { ...input, via: "panel" })).mandate,
  authorizeMandate: async (id) => {
    await get().refresh();
    const mandate = get().mandates.find((candidate) => candidate.id === id);
    if (!mandate) throw new Error("Authorized mandate was not found");
    return mandate;
  },
  declineMandate: async (id, actor) => {
    await api(`/api/mandates/${id}/decline`, { actor: actor ?? get().actor });
  },
  revokeMandate: async (id, actor) => {
    await api(`/api/mandates/${id}/revoke`, { actor });
  },
  updateLimits: async (id, limits, actor) => {
    await api(`/api/mandates/${id}/limits`, { limits, actor }, "PATCH");
  },
  checkout: async (scenario, opts = {}) => (await api<Envelope & { attempt: Attempt }>("/api/checkout", { scenario, ...opts })).attempt,
  decideApproval: async (id, decision, actor, pk) => {
    if (decision === "approved" && pk) {
      await get().refresh();
      const approval = get().approvals.find((candidate) => candidate.id === id);
      if (!approval) throw new Error("Approved exception was not found");
      return { approval };
    }
    const j = await api<Envelope & { approval: Approval; retry?: Attempt }>(`/api/approvals/${id}/decide`, { decision, actor, passkey: pk });
    return { approval: j.approval, retry: j.retry };
  },
  addCard: async (card) => (await api<Envelope & { card: VaultCard }>("/api/cards", card)).card,
  setAgent: async (patch) => {
    set((s) => ({ agent: { ...s.agent, ...patch } })); // optimistic
    await api("/api/agent", patch);
  },
  setActor: (actor) => set({ actor }),
  reset: async () => {
    await api("/api/reset", {});
  },
}));

// ---- selectors ----
export const selectAgent = (s: Store) => s.agents[0];
export const selectCurrentMandate = (s: Store) => s.mandates.find((m) => m.id === s.agents[0]?.currentMandateId);
