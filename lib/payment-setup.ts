import { createHmac, timingSafeEqual } from "node:crypto";

import { encryptionSecret } from "@/lib/env";

const DEFAULT_TTL_SECONDS = 15 * 60;
const PURPOSE = "payment_method_setup";

type PaymentSetupPayload = {
  v: 1;
  sub: string;
  purpose: typeof PURPOSE;
  exp: number;
};

type TokenOptions = {
  now?: Date;
  secret?: string;
  ttlSeconds?: number;
};

function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("agentpay:payment-setup:v1").digest();
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", signingKey(secret)).update(payload).digest();
}

export function createPaymentSetupToken(userId: string, options: TokenOptions = {}) {
  const now = options.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000,
  );
  const payload: PaymentSetupPayload = {
    v: 1,
    sub: userId,
    purpose: PURPOSE,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secret = options.secret ?? encryptionSecret();
  const token = `${encodedPayload}.${signature(encodedPayload, secret).toString("base64url")}`;
  return { token, expiresAt: expiresAt.toISOString() };
}

export function verifyPaymentSetupToken(
  token: string,
  userId: string,
  options: Pick<TokenOptions, "now" | "secret"> = {},
): boolean {
  try {
    const [encodedPayload, encodedSignature, extra] = token.split(".");
    if (!encodedPayload || !encodedSignature || extra) return false;
    const provided = Buffer.from(encodedSignature, "base64url");
    const expected = signature(encodedPayload, options.secret ?? encryptionSecret());
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<PaymentSetupPayload>;
    const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
    return (
      payload.v === 1 &&
      payload.sub === userId &&
      payload.purpose === PURPOSE &&
      typeof payload.exp === "number" &&
      Number.isInteger(payload.exp) &&
      payload.exp > nowSeconds
    );
  } catch {
    return false;
  }
}
