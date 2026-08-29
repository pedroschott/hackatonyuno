import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  generateEd25519KeyPair,
  signText,
  verifyText,
} from "@/lib/crypto";

describe("AgentPay cryptography", () => {
  it("signs and verifies Ed25519 messages", () => {
    const pair = generateEd25519KeyPair();
    const signature = signText(pair.privateKey, "POST|/checkout|hash|timestamp|nonce");
    expect(verifyText(pair.publicKey, "POST|/checkout|hash|timestamp|nonce", signature)).toBe(true);
    expect(verifyText(pair.publicKey, "tampered", signature)).toBe(false);
  });

  it("encrypts agent private keys with authenticated encryption", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptSecret("private-key", key);
    expect(encrypted).not.toContain("private-key");
    expect(decryptSecret(encrypted, key)).toBe("private-key");
  });
});
