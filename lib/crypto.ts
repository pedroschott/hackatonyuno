import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from "node:crypto";

import { canonicalJson } from "@/lib/canonical-json";

export function sha256Base64Url(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("base64url");
}

export function bodyHash(body: string): string {
  return sha256Base64Url(body);
}

export function agentSigningMessage(input: {
  method: string;
  path: string;
  body: string;
  timestamp: string;
  nonce: string;
}): string {
  return [
    input.method.toUpperCase(),
    input.path,
    bodyHash(input.body),
    input.timestamp,
    input.nonce,
  ].join("|");
}

export function generateEd25519KeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

export function signText(privateKeyPem: string, value: string): string {
  return sign(null, Buffer.from(value), createPrivateKey(privateKeyPem)).toString("base64url");
}

export function verifyText(publicKeyPem: string, value: string, signature: string): boolean {
  try {
    return verify(
      null,
      Buffer.from(value),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

export function signCanonical(privateKeyPem: string, value: unknown): string {
  return signText(privateKeyPem, canonicalJson(value));
}

function encryptionKey(key: string): Buffer {
  const decoded = Buffer.from(key, "base64");
  if (decoded.length !== 32) {
    throw new Error("AGENTPAY_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return decoded;
}

export function encryptSecret(plaintext: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(payload: string, key: string): string {
  const [ivValue, tagValue, ciphertextValue] = payload.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Encrypted secret has an invalid format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(key),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function decodePemEnvironment(value: string): string {
  const decoded = Buffer.from(value, "base64").toString("utf8");
  if (!decoded.includes("KEY-----")) {
    throw new Error("Registry key environment variables must be base64-encoded PEM strings");
  }
  return decoded;
}
