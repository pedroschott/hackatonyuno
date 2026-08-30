import { describe, expect, it } from "vitest";
import { withShippingHeadroom } from "@/lib/mcp/agentpay-tools";

describe("withShippingHeadroom", () => {
  it("always leaves room above the product price for shipping, handling and tax", () => {
    for (const price of [199, 1_000, 15_480, 154_800]) {
      expect(withShippingHeadroom(price)).toBeGreaterThan(price);
    }
  });

  it("adds a flat minimum on cheap items and a percentage on expensive ones", () => {
    expect(withShippingHeadroom(1_000)).toBe(1_500);
    expect(withShippingHeadroom(154_800)).toBe(178_100);
  });

  it("rounds up to a whole currency unit", () => {
    expect(withShippingHeadroom(199) % 100).toBe(0);
    expect(withShippingHeadroom(154_800) % 100).toBe(0);
  });
});
