import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import { z } from "zod";

import { authenticatedRequest } from "@/lib/http";
import {
  MERCHANT_FIELDS,
  type DeveloperMerchant,
  type MerchantEnvironment,
} from "@/lib/merchant-console";

const manifestSchema = z.object({
  protocol: z.literal("agentpay/1.0"),
  merchant: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  checkout_endpoint: z.url(),
  registry_url: z.url(),
  capabilities: z.array(z.string()).min(1),
});

export async function ownedMerchant(id: string) {
  const { supabase, user } = await authenticatedRequest();
  const membership = await supabase
    .from("merchant_memberships")
    .select("merchant_id")
    .eq("merchant_id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership.error) throw new Error(membership.error.message);
  if (!membership.data) return { supabase, user, merchant: null };
  const result = await supabase
    .from("merchants")
    .select(MERCHANT_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return { supabase, user, merchant: (result.data as DeveloperMerchant | null) ?? null };
}

export function newMerchantId(): string {
  return `mrc_${randomBytes(10).toString("hex")}`;
}

export function newProductId(): string {
  return `prd_${randomBytes(10).toString("hex")}`;
}

export function createMerchantApiKey(environment: MerchantEnvironment) {
  const prefix = `ap_${environment}_${randomBytes(5).toString("hex")}`;
  const plaintext = `${prefix}_${randomBytes(32).toString("base64url")}`;
  return { prefix, plaintext, secretHash: hashMerchantApiKey(plaintext) };
}

export function hashMerchantApiKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function verifyExternalMerchant(input: {
  merchantId: string;
  discoveryUrl: string;
}) {
  const url = await assertPublicHttpsUrl(input.discoveryUrl);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) {
    throw new Error(`Discovery returned HTTP ${response.status}.`);
  }
  const manifest = manifestSchema.parse(await response.json());
  if (manifest.merchant.id !== input.merchantId) {
    throw new Error(`Discovery identifies ${manifest.merchant.id}, not ${input.merchantId}.`);
  }
  const checkout = await assertPublicHttpsUrl(manifest.checkout_endpoint);
  return { manifest, checkoutUrl: checkout.toString() };
}

async function assertPublicHttpsUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Live merchant endpoints must use HTTPS.");
  if (url.username || url.password) throw new Error("Merchant endpoints cannot include credentials.");
  if (url.port && url.port !== "443") throw new Error("Merchant endpoints must use the standard HTTPS port.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Merchant endpoints must use a public hostname.");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Merchant endpoints must resolve only to public IP addresses.");
  }
  return url;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}
