import { timingSafeEqual } from 'node:crypto';

import {
  CompactSign,
  compactVerify,
  decodeProtectedHeader,
  importJWK,
  type JWK,
} from 'jose';

import {
  MerchantQuotePayloadSchema,
  type MerchantQuote,
  type MerchantQuotePayload,
} from '@agentic-mandates/contracts';
import { canonicalJson } from '@agentic-mandates/domain';

const textEncoder = new TextEncoder();

export async function signMerchantQuote(
  payload: MerchantQuotePayload,
  privateJwk: JWK,
): Promise<MerchantQuote> {
  const validatedPayload = MerchantQuotePayloadSchema.parse(payload);
  const signingKey = await importJWK(privateJwk, 'ES256');
  const signature = await new CompactSign(textEncoder.encode(canonicalJson(validatedPayload)))
    .setProtectedHeader({
      alg: 'ES256',
      kid: validatedPayload.keyId,
      typ: 'application/agents-pay-quote+jws',
    })
    .sign(signingKey);

  return {
    ...validatedPayload,
    signature,
  };
}

/**
 * Used by contract tests and by a future registry adapter. The Mandate service
 * must still reject inactive keys, wrong endpoints, replay, and expired quotes.
 */
export async function verifyMerchantQuoteSignature(
  quote: MerchantQuote,
  publicJwk: JWK,
): Promise<boolean> {
  try {
    const protectedHeader = decodeProtectedHeader(quote.signature);

    if (
      protectedHeader.alg !== 'ES256' ||
      protectedHeader.kid !== quote.keyId ||
      protectedHeader.typ !== 'application/agents-pay-quote+jws'
    ) {
      return false;
    }

    const verificationKey = await importJWK(publicJwk, 'ES256');
    const { payload } = await compactVerify(quote.signature, verificationKey, {
      algorithms: ['ES256'],
    });
    const expectedPayload = Buffer.from(
      canonicalJson(MerchantQuotePayloadSchema.parse(removeSignature(quote))),
    );
    const signedPayload = Buffer.from(payload);

    return (
      signedPayload.length === expectedPayload.length &&
      timingSafeEqual(signedPayload, expectedPayload)
    );
  } catch {
    return false;
  }
}

function removeSignature(quote: MerchantQuote): MerchantQuotePayload {
  const { signature: _signature, ...payload } = quote;
  return payload;
}
