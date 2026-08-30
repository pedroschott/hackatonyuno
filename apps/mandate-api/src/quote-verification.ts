import { timingSafeEqual } from 'node:crypto';

import {
  MerchantQuotePayloadSchema,
  MerchantQuoteSchema,
  type MerchantQuote,
  type NormalizedQuote,
  type ReasonCode,
} from '@agentic-mandates/contracts';
import {
  calculateCanonicalCartHash,
  calculateMerchantCartHash,
  canonicalJson,
  sumMinorAmounts,
} from '@agentic-mandates/domain';
import {
  compactVerify,
  decodeProtectedHeader,
  importJWK,
} from 'jose';

import type {
  MerchantQuoteSource,
  RegisteredMerchant,
  TaxonomyNormalizer,
} from './types.js';

export type VerifiedQuote = {
  quote: MerchantQuote;
  normalized: NormalizedQuote;
  canonicalCategoryIds: readonly string[];
};

type QuoteFailureCode = Extract<
  ReasonCode,
  | 'MERCHANT_NOT_REGISTERED'
  | 'MERCHANT_INACTIVE'
  | 'QUOTE_NOT_FOUND'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_MERCHANT_MISMATCH'
  | 'QUOTE_SIGNATURE_INVALID'
  | 'QUOTE_KEY_UNKNOWN'
  | 'CART_CHANGED'
  | 'UNMAPPED_CATEGORY'
  | 'SERVICE_UNAVAILABLE'
>;

export type VerifiedQuoteResult =
  | { ok: true; value: VerifiedQuote }
  | {
      ok: false;
      reasonCode: QuoteFailureCode;
    };

/**
 * Resolve the merchant entirely through the Mandate-owned registry, then
 * verify commercial terms before any policy reads them. The agent's request
 * only selects an already-issued quote ID; it never supplies prices or paths.
 */
export async function loadVerifiedQuote(input: {
  merchant: RegisteredMerchant | undefined;
  quoteId: string;
  quoteSource: MerchantQuoteSource;
  taxonomyNormalizer: TaxonomyNormalizer;
  now: Date;
}): Promise<VerifiedQuoteResult> {
  const merchant = input.merchant;
  if (!merchant) {
    return failure('MERCHANT_NOT_REGISTERED');
  }
  if (merchant.status !== 'active') {
    return failure('MERCHANT_INACTIVE');
  }

  let rawQuote: unknown | undefined;
  try {
    rawQuote = await input.quoteSource.getQuote({ merchant, quoteId: input.quoteId });
  } catch {
    return failure('SERVICE_UNAVAILABLE');
  }
  if (rawQuote === undefined) {
    return failure('QUOTE_NOT_FOUND');
  }

  const parsedQuote = MerchantQuoteSchema.safeParse(rawQuote);
  if (!parsedQuote.success) {
    return failure('QUOTE_SIGNATURE_INVALID');
  }
  const quote = parsedQuote.data;

  if (quote.id !== input.quoteId || quote.merchantId !== merchant.merchantId) {
    return failure('QUOTE_MERCHANT_MISMATCH');
  }
  if (Date.parse(quote.expiresAt) <= input.now.getTime()) {
    return failure('QUOTE_EXPIRED');
  }

  const verifiedSignature = await verifyMerchantQuoteSignature(quote, merchant);
  if (verifiedSignature === 'unknown_key') {
    return failure('QUOTE_KEY_UNKNOWN');
  }
  if (verifiedSignature !== 'valid') {
    return failure('QUOTE_SIGNATURE_INVALID');
  }

  if (!hasValidCommercialTerms(quote)) {
    return failure('CART_CHANGED');
  }

  let normalization;
  try {
    normalization = await input.taxonomyNormalizer.normalize({ merchant, quote });
  } catch {
    return failure('SERVICE_UNAVAILABLE');
  }
  if (!normalization.ok) {
    return failure(normalization.code);
  }
  if (!hasValidNormalization(quote, normalization.normalized)) {
    return failure('UNMAPPED_CATEGORY');
  }

  return {
    ok: true,
    value: {
      quote,
      normalized: normalization.normalized,
      canonicalCategoryIds: normalization.normalized.canonicalLineItems.map(
        (lineItem) => lineItem.canonicalCategoryId,
      ),
    },
  };
}

type QuoteSignatureResult = 'valid' | 'invalid' | 'unknown_key';

async function verifyMerchantQuoteSignature(
  quote: MerchantQuote,
  merchant: RegisteredMerchant,
): Promise<QuoteSignatureResult> {
  try {
    const header = decodeProtectedHeader(quote.signature);
    if (
      header.alg !== 'ES256' ||
      header.typ !== 'application/agents-pay-quote+jws' ||
      header.kid !== quote.keyId
    ) {
      return 'invalid';
    }

    const verificationJwk = merchant.quoteVerificationKeys.get(quote.keyId);
    if (!verificationJwk) {
      return 'unknown_key';
    }

    const verificationKey = await importJWK(verificationJwk, 'ES256');
    const verified = await compactVerify(quote.signature, verificationKey, {
      algorithms: ['ES256'],
    });
    const signedPayload = Buffer.from(verified.payload);
    const expectedPayload = Buffer.from(
      canonicalJson(MerchantQuotePayloadSchema.parse(withoutSignature(quote))),
    );

    return signedPayload.length === expectedPayload.length &&
      timingSafeEqual(signedPayload, expectedPayload)
      ? 'valid'
      : 'invalid';
  } catch {
    return 'invalid';
  }
}

function hasValidCommercialTerms(quote: MerchantQuote): boolean {
  try {
    if (Date.parse(quote.issuedAt) > Date.parse(quote.expiresAt)) {
      return false;
    }
    if (calculateMerchantCartHash(quote) !== quote.merchantCartHash) {
      return false;
    }

    const expectedSubtotal = quote.lineItems.reduce((subtotal, lineItem) => {
      const lineAmount = multiplyMinorAmounts(lineItem.unitAmountMinor, lineItem.quantity);
      return sumMinorAmounts(subtotal, lineAmount);
    }, 0);
    const expectedTotal = sumMinorAmounts(
      expectedSubtotal,
      quote.shippingMinor,
      quote.taxMinor,
    );

    return expectedSubtotal === quote.subtotalMinor && expectedTotal === quote.totalMinor;
  } catch {
    return false;
  }
}

function hasValidNormalization(quote: MerchantQuote, normalized: NormalizedQuote): boolean {
  try {
    if (normalized.quoteId !== quote.id || normalized.merchantId !== quote.merchantId) {
      return false;
    }
    if (normalized.canonicalLineItems.length !== quote.lineItems.length) {
      return false;
    }

    const quoteSkus = new Set(quote.lineItems.map((lineItem) => lineItem.merchantSku));
    const normalizedSkus = new Set(
      normalized.canonicalLineItems.map((lineItem) => lineItem.merchantSku),
    );
    if (quoteSkus.size !== quote.lineItems.length || normalizedSkus.size !== quoteSkus.size) {
      return false;
    }
    if ([...quoteSkus].some((sku) => !normalizedSkus.has(sku))) {
      return false;
    }

    const canonicalCartHash = calculateCanonicalCartHash({
      quoteId: quote.id,
      merchantId: quote.merchantId,
      taxonomyVersion: normalized.taxonomyVersion,
      merchantCartHash: quote.merchantCartHash,
      canonicalLineItems: normalized.canonicalLineItems,
    });
    return canonicalCartHash === normalized.canonicalCartHash;
  } catch {
    return false;
  }
}

function multiplyMinorAmounts(unitAmountMinor: number, quantity: number): number {
  if (!Number.isSafeInteger(unitAmountMinor) || !Number.isSafeInteger(quantity)) {
    throw new RangeError('Quote line amount is not a safe integer.');
  }
  const value = unitAmountMinor * quantity;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Quote line amount exceeds safe integer precision.');
  }
  return value;
}

function withoutSignature(quote: MerchantQuote) {
  const { signature: _signature, ...payload } = quote;
  return payload;
}

function failure(reasonCode: QuoteFailureCode): VerifiedQuoteResult {
  return { ok: false, reasonCode };
}
