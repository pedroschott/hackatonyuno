import { createHash } from 'node:crypto';

import { canonicalize } from 'json-canonicalize';

import type { MerchantQuotePayload } from '@agentic-mandates/contracts';

/** Canonicalizes JSON using RFC 8785-compatible JSON Canonicalization Scheme. */
export function canonicalJson(value: unknown): string {
  const result = canonicalize(value);

  if (result === undefined) {
    throw new TypeError('The value cannot be represented as canonical JSON.');
  }

  return result;
}

export function sha256Base64Url(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function hashCanonicalJson(value: unknown): string {
  return sha256Base64Url(canonicalJson(value));
}

/** Alias used for idempotency request-body fingerprints. */
export const requestFingerprint = hashCanonicalJson;

export type MerchantCartHashInput = Pick<
  MerchantQuotePayload,
  | 'merchantId'
  | 'merchantCatalogVersion'
  | 'lineItems'
  | 'subtotalMinor'
  | 'shippingMinor'
  | 'taxMinor'
  | 'totalMinor'
  | 'currency'
>;

/**
 * The merchant cart hash covers all commercial terms, but not quote metadata
 * or the JWS. It is therefore stable while a signed quote is being verified.
 */
export function calculateMerchantCartHash(input: MerchantCartHashInput): string {
  return hashCanonicalJson({
    merchantId: input.merchantId,
    merchantCatalogVersion: input.merchantCatalogVersion,
    lineItems: input.lineItems,
    subtotalMinor: input.subtotalMinor,
    shippingMinor: input.shippingMinor,
    taxMinor: input.taxMinor,
    totalMinor: input.totalMinor,
    currency: input.currency,
  });
}

export type CanonicalCartHashInput = {
  quoteId: string;
  merchantId: string;
  taxonomyVersion: string;
  merchantCartHash: string;
  canonicalLineItems: ReadonlyArray<{
    merchantSku: string;
    canonicalCategoryId: string;
  }>;
};

/**
 * Binds Mandate-owned category normalization to the verified merchant cart.
 * The source merchant cart hash retains every commercial term.
 */
export function calculateCanonicalCartHash(input: CanonicalCartHashInput): string {
  return hashCanonicalJson({
    quoteId: input.quoteId,
    merchantId: input.merchantId,
    taxonomyVersion: input.taxonomyVersion,
    merchantCartHash: input.merchantCartHash,
    canonicalLineItems: input.canonicalLineItems,
  });
}
