import { timingSafeEqual } from 'node:crypto';

import {
  PurchaseCapabilityPayloadSchema,
  VerificationReceiptPayloadSchema,
  type PurchaseCapabilityPayload,
  type VerificationReceiptPayload,
} from '@agentic-mandates/contracts';
import { canonicalJson, sha256Base64Url } from '@agentic-mandates/domain';
import {
  CompactSign,
  compactVerify,
  decodeProtectedHeader,
  importJWK,
  type JWK,
} from 'jose';

import type { SigningKey } from './types.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const CAPABILITY_JWS_TYPE = 'application/agentic-mandates-capability+jws';
const VERIFICATION_RECEIPT_JWS_TYPE = 'application/agentic-mandates-verification+jws';

export async function signPurchaseCapability(
  payload: PurchaseCapabilityPayload,
  signingKey: SigningKey,
): Promise<string> {
  const validated = PurchaseCapabilityPayloadSchema.parse(payload);
  const key = await importJWK(signingKey.privateJwk, 'ES256');

  return new CompactSign(textEncoder.encode(canonicalJson(validated)))
    .setProtectedHeader({
      alg: 'ES256',
      kid: signingKey.keyId,
      typ: CAPABILITY_JWS_TYPE,
    })
    .sign(key);
}

export async function verifyPurchaseCapability(input: {
  capability: string;
  verificationKeys: ReadonlyMap<string, JWK>;
  now: Date;
}): Promise<
  | { ok: true; payload: PurchaseCapabilityPayload; capabilityHash: string }
  | { ok: false; reasonCode: 'CAPABILITY_INVALID' | 'CAPABILITY_EXPIRED' }
> {
  try {
    const header = decodeProtectedHeader(input.capability);
    if (
      header.alg !== 'ES256' ||
      header.typ !== CAPABILITY_JWS_TYPE ||
      typeof header.kid !== 'string'
    ) {
      return invalidCapability();
    }

    const publicJwk = input.verificationKeys.get(header.kid);
    if (!publicJwk) {
      return invalidCapability();
    }

    const verificationKey = await importJWK(publicJwk, 'ES256');
    const { payload: rawPayload } = await compactVerify(input.capability, verificationKey, {
      algorithms: ['ES256'],
    });
    const parsedPayload = PurchaseCapabilityPayloadSchema.safeParse(
      JSON.parse(textDecoder.decode(rawPayload)),
    );
    if (!parsedPayload.success) {
      return invalidCapability();
    }

    const expectedPayload = Buffer.from(canonicalJson(parsedPayload.data));
    const signedPayload = Buffer.from(rawPayload);
    if (
      signedPayload.length !== expectedPayload.length ||
      !timingSafeEqual(signedPayload, expectedPayload)
    ) {
      return invalidCapability();
    }

    if (Date.parse(parsedPayload.data.expiresAt) <= input.now.getTime()) {
      return { ok: false, reasonCode: 'CAPABILITY_EXPIRED' };
    }

    return {
      ok: true,
      payload: parsedPayload.data,
      capabilityHash: sha256Base64Url(input.capability),
    };
  } catch {
    return invalidCapability();
  }
}

export async function signVerificationReceipt(
  payload: VerificationReceiptPayload,
  signingKey: SigningKey,
): Promise<string> {
  const validated = VerificationReceiptPayloadSchema.parse(payload);
  const key = await importJWK(signingKey.privateJwk, 'ES256');

  return new CompactSign(textEncoder.encode(canonicalJson(validated)))
    .setProtectedHeader({
      alg: 'ES256',
      kid: signingKey.keyId,
      typ: VERIFICATION_RECEIPT_JWS_TYPE,
    })
    .sign(key);
}

function invalidCapability(): { ok: false; reasonCode: 'CAPABILITY_INVALID' } {
  return { ok: false, reasonCode: 'CAPABILITY_INVALID' };
}
