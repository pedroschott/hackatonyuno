// Shared, pure domain helpers used by both the server routes and the client.
// State itself lives in Supabase (lib/server/state.ts); enforcement lives in
// lib/policy.ts and the database function it mirrors. Nothing here does I/O.

import type { Dispute } from "./disputes";
import type {
  Agent,
  Approval,
  Attempt,
  AuditEntry,
  Mandate,
  Merchant,
  Product,
  VaultCard,
} from "./types";

export type Data = {
  cards: VaultCard[];
  agents: Agent[];
  merchants: Merchant[];
  products: Product[];
  mandates: Mandate[];
  attempts: Attempt[];
  approvals: Approval[];
  audit: AuditEntry[];
  disputes: Dispute[];
  usedNonces: string[];
};

export type CheckoutOpts = {
  exception_id?: string;
  source?: "manual" | "store" | "api" | "trial";
  productId?: string;
  revocation_window_ms?: number;
};

export function sameMonth(iso: string, now: Date) {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/** Spend and use count for one mandate in the current calendar month. */
export function usageFor(data: Pick<Data, "attempts">, mandateId: string, now = new Date()) {
  const approved = data.attempts.filter(
    (a) => a.mandate_id === mandateId && a.decision === "approved" && sameMonth(a.created_at, now),
  );
  return { uses: approved.length, spent: approved.reduce((sum, a) => sum + a.amount_cents, 0) };
}

/** A mandate stays "active" in the database until something reads it past its expiry. */
export function effectiveStatus(m: Mandate, now = Date.now()) {
  if (m.status === "active" && now > new Date(m.validity.expires_at).getTime()) return "expired";
  return m.status;
}

/** Keep the newest authorized mandate as the authority an agent holds, even after revocation. */
export function latestHeldMandate(mandates: Mandate[]): Mandate | undefined {
  return (
    mandates.find(
      (mandate) =>
        mandate.authorization !== undefined &&
        (mandate.status === "active" || mandate.status === "revoked" || mandate.status === "expired"),
    ) ?? mandates.find((mandate) => mandate.status === "draft")
  );
}

export class EngineError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
