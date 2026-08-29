import { createHash } from 'node:crypto';

import { canonicalize } from 'json-canonicalize';

import type { MerchantQuotePayload } from './contracts.js';

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

/**
 * The cart hash covers every commercial term the merchant calculated. It does
 * not include issuance metadata or the JWS, so it represents the cart itself.
 */
export function calculateMerchantCartHash(
  quote: Pick<
    MerchantQuotePayload,
    | 'merchantId'
    | 'merchantCatalogVersion'
    | 'lineItems'
    | 'subtotalMinor'
    | 'shippingMinor'
    | 'taxMinor'
    | 'totalMinor'
    | 'currency'
  >,
): string {
  return sha256Base64Url(
    canonicalJson({
      merchantId: quote.merchantId,
      merchantCatalogVersion: quote.merchantCatalogVersion,
      lineItems: quote.lineItems,
      subtotalMinor: quote.subtotalMinor,
      shippingMinor: quote.shippingMinor,
      taxMinor: quote.taxMinor,
      totalMinor: quote.totalMinor,
      currency: quote.currency,
    }),
  );
}

export function requestFingerprint(value: unknown): string {
  return sha256Base64Url(canonicalJson(value));
}
