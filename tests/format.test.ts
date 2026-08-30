import { describe, expect, it } from "vitest";

import { usd, usdCompact } from "@/lib/format";

describe("USD formatting", () => {
  it("renders exact cents with the US dollar symbol", () => {
    expect(usd(154_800)).toBe("$1,548.00");
    expect(usd(49)).toBe("$0.49");
  });

  it("renders compact whole-dollar values for summary UI", () => {
    expect(usdCompact(180_000)).toBe("$1,800");
  });
});
