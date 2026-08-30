"use client";

import { create } from "zustand";
import type { Dispute, DisputeReasonCode } from "./disputes";
import type { Approval, Attempt, Mandate, Scenario } from "./types";
import type { CheckoutOpts, Data } from "./engine";
import { usageFor } from "./engine";
import type { PasskeyResult } from "./passkey";

export { usageFor };

type Client = {
  hydrated: boolean;
  online: boolean;
  publicBaseUrl: string;
  serverTime: string | null;

  refresh: () => Promise<void>;
  authorizeMandate: (id: string, pk: PasskeyResult) => Promise<Mandate>;
  declineMandate: (id: string, actor?: string) => Promise<void>;
  revokeMandate: (id: string, actor: string) => Promise<void>;
  checkout: (scenario: Scenario, opts?: CheckoutOpts) => Promise<Attempt>;
  decideApproval: (id: string, decision: "approved" | "denied", actor: string, pk?: PasskeyResult) => Promise<{ approval: Approval; retry?: Attempt }>;
  openDispute: (input: { attempt_id: string; reason_code: DisputeReasonCode; statement: string }) => Promise<Dispute>;
  withdrawDispute: (id: string) => Promise<void>;
};

export type Store = Data & Client;

const empty: Data = {
  cards: [], agents: [], merchants: [], products: [], mandates: [], attempts: [], approvals: [], audit: [], disputes: [], usedNonces: [],
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

  refresh: async () => {
    try {
      const j = await api("/api/state", undefined, "GET");
      applyEnvelope(j);
    } catch {
      set({ online: false });
    }
  },

  authorizeMandate: async (id) => {
    await get().refresh();
    const mandate = get().mandates.find((candidate) => candidate.id === id);
    if (!mandate) throw new Error("Authorized mandate was not found");
    return mandate;
  },
  declineMandate: async (id, actor) => {
    await api(`/api/mandates/${id}/decline`, { actor: actor ?? "user" });
  },
  revokeMandate: async (id, actor) => {
    await api(`/api/mandates/${id}/revoke`, { actor });
  },
  checkout: async (scenario, opts = {}) => (await api<Envelope & { attempt: Attempt }>("/api/checkout", { scenario, ...opts })).attempt,
  openDispute: async (input) => {
    const created = await api<Envelope & { dispute: Dispute }>("/api/disputes", input);
    // The dispute routes answer with the dispute alone, not the whole state, so
    // the panel refreshes to pick it up alongside everything else.
    await get().refresh();
    return created.dispute;
  },
  withdrawDispute: async (id) => {
    await api(`/api/disputes/${id}/withdraw`, {});
    await get().refresh();
  },
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
}));
