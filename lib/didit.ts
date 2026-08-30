import { createHmac, timingSafeEqual } from "node:crypto";

import { diditEnv } from "@/lib/env";

const DIDIT_API_BASE = "https://verification.didit.me/v3";

export const diditSessionStatuses = [
  "Not Started",
  "In Progress",
  "Approved",
  "Declined",
  "In Review",
  "Expired",
  "Abandoned",
  "Kyc Expired",
  "Resubmitted",
  "Awaiting User",
] as const;

export type DiditSessionStatus = (typeof diditSessionStatuses)[number];

export type IdentityVerification = {
  session_id: string;
  status: DiditSessionStatus;
  entity_status: "ACTIVE" | "FLAGGED" | "BLOCKED" | null;
  workflow_id: string;
  environment: "sandbox" | "live" | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
};

type DiditSessionResponse = {
  session_id: string;
  session_kind: "user" | "business";
  url: string;
  status: DiditSessionStatus;
  workflow_id: string;
  vendor_data: string | null;
};

export type DiditDecision = {
  session_id: string;
  session_kind?: "user" | "business";
  status: DiditSessionStatus;
  workflow_id: string;
  vendor_data: string | null;
  features?: string[];
};

export type DiditWebhook = {
  event_id: string;
  webhook_type: string;
  timestamp: number;
  created_at: number;
  application_id: string;
  environment: "sandbox" | "live";
  status: string;
  session_id?: string;
  session_kind?: "user" | "business";
  workflow_id?: string;
  vendor_data?: string;
};

export function isDiditSessionStatus(value: unknown): value is DiditSessionStatus {
  return diditSessionStatuses.includes(value as DiditSessionStatus);
}

export function isIdentityVerified(verification: IdentityVerification | null | undefined): boolean {
  return verification?.status === "Approved" &&
    verification.entity_status !== "FLAGGED" &&
    verification.entity_status !== "BLOCKED";
}

async function diditRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiKey } = diditEnv();
  const response = await fetch(`${DIDIT_API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": apiKey,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let detail = "Didit verification request failed";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.length <= 240) detail = body.detail;
    } catch {}
    throw new Error(`${detail} (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function createDiditSession(input: {
  userId: string;
  callbackUrl: string;
}): Promise<DiditSessionResponse> {
  const { workflowId } = diditEnv();
  const session = await diditRequest<DiditSessionResponse>("/session/", {
    method: "POST",
    body: JSON.stringify({
      workflow_id: workflowId,
      vendor_data: input.userId,
      callback: input.callbackUrl,
      callback_method: "both",
      language: "en",
      metadata: { integration: "agentpay" },
    }),
  });
  if (
    !session.session_id ||
    session.session_kind !== "user" ||
    !session.url ||
    session.vendor_data !== input.userId ||
    session.workflow_id !== workflowId ||
    !isDiditSessionStatus(session.status)
  ) {
    throw new Error("Didit returned an invalid verification session");
  }
  return session;
}

export async function retrieveDiditDecision(sessionId: string): Promise<DiditDecision> {
  const decision = await diditRequest<DiditDecision>(`/session/${encodeURIComponent(sessionId)}/decision/`);
  if (!decision.session_id || !isDiditSessionStatus(decision.status)) {
    throw new Error("Didit returned an invalid verification decision");
  }
  return decision;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortJson((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

export function diditCanonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function validTimestamp(timestampHeader: string | null, nowSeconds: number): boolean {
  if (!timestampHeader || !/^\d+$/.test(timestampHeader)) return false;
  return Math.abs(nowSeconds - Number(timestampHeader)) <= 300;
}

function matchesHmac(value: string, signature: string | null, secret: string): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(value, "utf8").digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(expected, received);
}

export function verifyDiditWebhook(input: {
  rawBody: string;
  body: unknown;
  timestamp: string | null;
  signatureV2: string | null;
  signatureRaw: string | null;
  secret: string;
  nowSeconds?: number;
}): "v2" | "raw" | null {
  if (!validTimestamp(input.timestamp, input.nowSeconds ?? Math.floor(Date.now() / 1000))) return null;
  if (matchesHmac(diditCanonicalJson(input.body), input.signatureV2, input.secret)) return "v2";
  if (matchesHmac(input.rawBody, input.signatureRaw, input.secret)) return "raw";
  return null;
}
