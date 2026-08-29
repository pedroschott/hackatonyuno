import { describe, expect, it } from "vitest";

import { resolveWebAuthnEnv } from "@/lib/env";

describe("WebAuthn environment", () => {
  it("binds passkeys to the exact AgentPay production host", () => {
    expect(
      resolveWebAuthnEnv({
        origin: "https://agentpay-yuno.vercel.app",
        requestUrl: "https://agentpay-yuno.vercel.app/api/passkeys/register",
        rpID: "agentpay-yuno.vercel.app",
      }),
    ).toEqual({
      origin: "https://agentpay-yuno.vercel.app",
      rpID: "agentpay-yuno.vercel.app",
      rpName: "AgentPay",
    });
  });

  it("rejects a broad parent domain as the relying party", () => {
    expect(() =>
      resolveWebAuthnEnv({
        origin: "https://agentpay-yuno.vercel.app",
        rpID: "vercel.app",
      }),
    ).toThrow("must exactly match");
  });

  it("rejects passkey ceremonies opened on a different deployment origin", () => {
    expect(() =>
      resolveWebAuthnEnv({
        origin: "https://agentpay-yuno.vercel.app",
        requestUrl: "https://agentpay-yuno-preview.vercel.app/api/passkeys/register",
        rpID: "agentpay-yuno.vercel.app",
      }),
    ).toThrow("Open AgentPay at https://agentpay-yuno.vercel.app");
  });
});
