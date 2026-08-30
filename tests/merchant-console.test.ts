import { describe, expect, it } from "vitest";

import {
  createMerchantApiKey,
  hashMerchantApiKey,
  newMerchantId,
  newProductId,
} from "@/lib/server/merchant-console";

describe("merchant console identifiers", () => {
  it("creates opaque database-safe merchant and product IDs", () => {
    expect(newMerchantId()).toMatch(/^mrc_[a-f0-9]{20}$/);
    expect(newProductId()).toMatch(/^prd_[a-f0-9]{20}$/);
  });

  it("creates a one-time merchant key and stores only its stable hash", () => {
    const key = createMerchantApiKey("test");

    expect(key.prefix).toMatch(/^ap_test_[A-Za-z0-9]{10}$/);
    expect(key.plaintext).toMatch(new RegExp(`^${key.prefix}_[A-Za-z0-9_-]{43}$`));
    expect(key.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashMerchantApiKey(key.plaintext)).toBe(key.secretHash);
    expect(key.secretHash).not.toContain(key.plaintext);
  });
});
