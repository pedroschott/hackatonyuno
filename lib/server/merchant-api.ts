import { hashMerchantApiKey } from "@/lib/server/merchant-console";

/**
 * A merchant API key on the wire. The plaintext is never stored and never
 * logged; only its SHA-256 reaches the database, where it is matched against the
 * hash recorded when the key was issued.
 */
export function merchantKeyHash(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const plaintext = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!plaintext.startsWith("ap_")) return null;
  return hashMerchantApiKey(plaintext);
}

export function unauthorizedKey() {
  return Response.json(
    {
      error: "A valid merchant API key is required.",
      hint: "Send it as `Authorization: Bearer ap_live_…`. Create one under Keys in the merchant console.",
    },
    { status: 401 },
  );
}

/**
 * The key functions return SQL NULL when the key does not authorize the
 * merchant, which arrives as `null` rather than an error. Treating that as 401
 * keeps a wrong key and a wrong merchant id indistinguishable to the caller.
 */
export function rejectsAsUnauthorized(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function parseTimestamp(value: string | null, label: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) throw new Error(`${label} must be an ISO 8601 timestamp`);
  return parsed.toISOString();
}
