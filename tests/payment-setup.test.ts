import { describe, expect, it } from "vitest";

import { createPaymentSetupToken, verifyPaymentSetupToken } from "@/lib/payment-setup";

const secret = "payment-setup-test-secret";
const now = new Date("2026-08-29T18:00:00.000Z");

describe("payment setup links", () => {
  it("accepts a valid token only for its AgentPay user", () => {
    const { token } = createPaymentSetupToken("user-a", { now, secret });

    expect(verifyPaymentSetupToken(token, "user-a", { now, secret })).toBe(true);
    expect(verifyPaymentSetupToken(token, "user-b", { now, secret })).toBe(false);
  });

  it("rejects expired and tampered tokens", () => {
    const { token } = createPaymentSetupToken("user-a", {
      now,
      secret,
      ttlSeconds: 60,
    });
    const expiredAt = new Date(now.getTime() + 61_000);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    expect(verifyPaymentSetupToken(token, "user-a", { now: expiredAt, secret })).toBe(false);
    expect(verifyPaymentSetupToken(tampered, "user-a", { now, secret })).toBe(false);
  });
});
