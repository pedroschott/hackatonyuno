import { describe, expect, it } from "vitest";

import { GENESIS_HASH, sha256 } from "@/lib/hash";
import { appendAudit, verifyChain } from "@/lib/seed";
import type { AuditEntry } from "@/lib/types";

describe("AgentPay audit chain", () => {
  it("appends and verifies versioned audit events", () => {
    const first = appendAudit([], {
      ts: "2026-08-30T03:00:00.123Z",
      actor: "agent:shopping",
      action: "mandate.created",
      entity: "mnd_123",
      payload: { status: "draft" },
    });
    const log = appendAudit(first, {
      ts: "2026-08-30T03:01:00.456Z",
      actor: "user:buyer",
      action: "mandate.authorized",
      entity: "mnd_123",
      payload: { status: "active" },
    });

    expect(log[0]).toMatchObject({
      hash_version: 2,
      prev_hash: GENESIS_HASH,
    });
    expect(log[1].prev_hash).toBe(log[0].hash);
    expect(verifyChain(log)).toEqual({ ok: true });
  });

  it("verifies stored PostgreSQL JSON text without recreating its formatting", () => {
    const material =
      '{"ts": "2026-08-30T03:00:00.123000Z", "actor": "agent:shopping", "action": "mandate.created", "entity": "mnd_123", "payload": {"status": "draft"}}';
    const entry: AuditEntry = {
      seq: 42,
      ts: "2026-08-30T03:00:00.123+00:00",
      actor: "agent:shopping",
      action: "mandate.created",
      entity: "mnd_123",
      payload: { status: "draft" },
      prev_hash: GENESIS_HASH,
      hash: sha256(GENESIS_HASH + material),
      hash_version: 2,
      hash_material: material,
    };

    expect(verifyChain([entry])).toEqual({ ok: true });
  });

  it("detects payload tampering even when the stored digest input is unchanged", () => {
    const [entry] = appendAudit([], {
      ts: "2026-08-30T03:00:00.000Z",
      actor: "merchant:store",
      action: "attempt.approved",
      entity: "attempt_123",
      payload: { amount_cents: 2699 },
    });
    const tampered = [{ ...entry, payload: { amount_cents: 1 } }];

    expect(verifyChain(tampered)).toEqual({ ok: false, brokenAt: entry.seq });
  });

  it("detects a removed event through the next chain link", () => {
    const first = appendAudit([], {
      actor: "agent:shopping",
      action: "mandate.created",
      entity: "mnd_123",
      payload: {},
    });
    const second = appendAudit(first, {
      actor: "user:buyer",
      action: "mandate.authorized",
      entity: "mnd_123",
      payload: {},
    });
    const third = appendAudit(second, {
      actor: "merchant:store",
      action: "attempt.approved",
      entity: "attempt_123",
      payload: {},
    });

    expect(verifyChain([third[0], third[2]])).toEqual({ ok: false, brokenAt: third[2].seq });
  });
});
