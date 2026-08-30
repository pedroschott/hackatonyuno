import crypto from "node:crypto";

import { z } from "zod";

export const DIDIT_KYC_WORKFLOW_ID = "81cd4c97-fe07-4ec9-943d-f257f6582267";

export const diditSessionStatusSchema = z.enum([
  "Not Started",
  "In Progress",
  "Awaiting User",
  "In Review",
  "Approved",
  "Declined",
  "Resubmitted",
  "Abandoned",
  "Expired",
  "Kyc Expired",
]);

export type DiditSessionStatus = z.infer<typeof diditSessionStatusSchema>;

export const diditSessionSchema = z.object({
  session_id: z.string().min(1).max(160),
  url: z.string().url(),
  status: diditSessionStatusSchema,
  workflow_id: z.string().uuid(),
});

export const diditWebhookEventSchema = z.object({
  event_id: z.string().uuid(),
  webhook_type: z.string().trim().min(1).max(120),
  session_id: z.string().trim().min(1).max(160),
  status: diditSessionStatusSchema,
});

const userIdSchema = z.string().uuid();

export function diditVendorData(userId: string): string {
  return `agentpay:${userIdSchema.parse(userId)}`;
}

// Whole-number floats are represented as integers after JSON.parse in JavaScript.
// Keeping this normalizer matches Didit's V2 signing canonicalization exactly.
export function shortenDiditFloats(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shortenDiditFloats);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, shortenDiditFloats(item)]),
    );
  }
  if (typeof value === "number" && !Number.isInteger(value) && value % 1 === 0) return Math.trunc(value);
  return value;
}

export function sortDiditKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDiditKeys);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortDiditKeys((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

export function canonicalDiditWebhookPayload(payload: unknown): string {
  return JSON.stringify(sortDiditKeys(shortenDiditFloats(payload)));
}

export function verifyDiditWebhookSignature(input: {
  payload: unknown;
  signature: string;
  timestamp: number;
  secret: string;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(input.timestamp) || Math.abs(now / 1000 - input.timestamp) > 300) return false;
  if (!/^[a-f0-9]{64}$/i.test(input.signature)) return false;

  const expected = crypto
    .createHmac("sha256", input.secret)
    .update(canonicalDiditWebhookPayload(input.payload), "utf8")
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(input.signature, "utf8"));
}
