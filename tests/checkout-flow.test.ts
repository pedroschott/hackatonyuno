import { describe, expect, it } from "vitest";

import {
  MAX_REVOCATION_WINDOW_MS,
  parseRevocationWindowMs,
} from "@/lib/server/checkout-flow";
import { latestHeldMandate, seedData } from "@/lib/engine";

describe("checkout revocation window", () => {
  it("defaults to no artificial delay", () => {
    expect(parseRevocationWindowMs(undefined)).toBe(0);
    expect(parseRevocationWindowMs(0)).toBe(0);
  });

  it("accepts only bounded integer delays", () => {
    expect(parseRevocationWindowMs(MAX_REVOCATION_WINDOW_MS)).toBe(
      MAX_REVOCATION_WINDOW_MS,
    );
    expect(parseRevocationWindowMs(-1)).toBeNull();
    expect(parseRevocationWindowMs(MAX_REVOCATION_WINDOW_MS + 1)).toBeNull();
    expect(parseRevocationWindowMs(1.5)).toBeNull();
    expect(parseRevocationWindowMs("8000")).toBeNull();
  });

  it("keeps the revoked mandate as the agent's held authority", () => {
    const latest = seedData().mandates[0];
    const olderActive = {
      ...latest,
      id: "mnd_older_active",
      created_at: "2026-08-01T00:00:00.000Z",
    };
    const revoked = {
      ...latest,
      status: "revoked" as const,
      revoked_at: "2026-08-29T12:00:00.000Z",
    };

    expect(latestHeldMandate([revoked, olderActive])?.id).toBe(revoked.id);
  });
});
