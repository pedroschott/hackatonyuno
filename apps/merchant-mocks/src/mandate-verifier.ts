import { timingSafeEqual } from 'node:crypto';

import {
  CompactSign,
  compactVerify,
  decodeProtectedHeader,
  importJWK,
  type JWK,
} from 'jose';

import { canonicalJson, sha256Base64Url } from './canonical.js';
import {
  VerificationReceiptPayloadSchema,
  VerificationResultSchema,
  type VerificationReceiptPayload,
  type VerificationResult,
} from './contracts.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * The merchant sends this minimal tuple server-to-server. The Mandate API must
 * independently retrieve the quote from its registered merchant endpoint and
 * verify the capability, current mandate state, cart hash, and revocation.
 */
export type MandateVerificationRequest = {
  merchantId: string;
  merchantOrderRef: string;
  quoteId: string;
  purchaseCapability: string;
  idempotencyKey: string;
  requestId: string;
};

export interface MandateVerificationClient {
  verify(request: MandateVerificationRequest): Promise<VerificationResult>;
}

export interface MerchantServiceRequestProofSigner {
  sign(input: {
    method: 'POST';
    url: string;
    body: string;
    audience: 'mandate-api';
  }): Promise<string>;
}

export type MandateVerificationReceiptKey = {
  keyId: string;
  publicJwk: JWK;
};

/**
 * Thin production bridge only. It deliberately owns no policy or payment
 * logic; the actual Mandate API is the authoritative verifier. A response is
 * accepted only after its Mandate-signed receipt is bound to this exact tuple.
 */
export class HttpMandateVerificationClient implements MandateVerificationClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      requestProofSigner: MerchantServiceRequestProofSigner;
      receiptKeys: ReadonlyMap<string, JWK>;
      fetch?: typeof fetch;
      now?: () => Date;
      timeoutMs?: number;
    },
  ) {}

  async verify(request: MandateVerificationRequest): Promise<VerificationResult> {
    const endpoint = new URL('v1/merchant/verifications', withTrailingSlash(this.options.baseUrl));
    const body = JSON.stringify(request);
    const proof = await this.options.requestProofSigner.sign({
      method: 'POST',
      url: endpoint.toString(),
      body,
      audience: 'mandate-api',
    });
    const timeoutMs = this.options.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new MandateVerificationBridgeError(
        'The Mandate verification timeout must be a positive integer.',
        500,
        undefined,
      );
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);
    let response: Response;

    try {
      response = await (this.options.fetch ?? fetch)(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': request.idempotencyKey,
          'x-merchant-request-proof': proof,
          'x-request-id': request.requestId,
        },
        body,
        redirect: 'error',
        signal: abortController.signal,
      });
    } catch (error) {
      throw new MandateVerificationBridgeError(
        'The Mandate verification service is unavailable or timed out.',
        503,
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      clearTimeout(timeout);
    }

    const responseBody: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      throw new MandateVerificationBridgeError(
        `The Mandate API rejected merchant verification with HTTP ${response.status}.`,
        response.status,
        responseBody,
      );
    }

    let result: VerificationResult;
    try {
      result = VerificationResultSchema.parse(responseBody);
      await verifyMandateVerificationReceipt({
        receipt: result.verificationReceipt,
        result,
        request,
        receiptKeys: this.options.receiptKeys,
        now: this.options.now?.() ?? new Date(),
      });
    } catch (error) {
      throw new MandateVerificationBridgeError(
        'The Mandate verification result was malformed, untrusted, expired, or bound to another request.',
        502,
        error instanceof Error ? error.message : undefined,
      );
    }

    return result;
  }
}

export async function signMandateVerificationReceipt(
  payload: VerificationReceiptPayload,
  privateJwk: JWK,
): Promise<string> {
  const validatedPayload = VerificationReceiptPayloadSchema.parse(payload);
  const signingKey = await importJWK(privateJwk, 'ES256');

  return new CompactSign(textEncoder.encode(canonicalJson(validatedPayload)))
    .setProtectedHeader({
      alg: 'ES256',
      kid: validatedPayload.keyId,
      typ: 'application/agentic-mandates-verification+jws',
    })
    .sign(signingKey);
}

export async function verifyMandateVerificationReceipt(input: {
  receipt: string;
  result: VerificationResult;
  request: MandateVerificationRequest;
  receiptKeys: ReadonlyMap<string, JWK>;
  now: Date;
}): Promise<VerificationReceiptPayload> {
  const protectedHeader = decodeProtectedHeader(input.receipt);

  if (
    protectedHeader.alg !== 'ES256' ||
    protectedHeader.typ !== 'application/agentic-mandates-verification+jws' ||
    typeof protectedHeader.kid !== 'string'
  ) {
    throw new MandateVerificationReceiptError('The verification receipt header is invalid.');
  }

  const publicJwk = input.receiptKeys.get(protectedHeader.kid);
  if (!publicJwk) {
    throw new MandateVerificationReceiptError('The verification receipt key is unknown or inactive.');
  }

  const verificationKey = await importJWK(publicJwk, 'ES256');
  const { payload } = await compactVerify(input.receipt, verificationKey, {
    algorithms: ['ES256'],
  });
  const payloadText = textDecoder.decode(payload);
  let decodedPayload: unknown;

  try {
    decodedPayload = JSON.parse(payloadText);
  } catch {
    throw new MandateVerificationReceiptError('The verification receipt payload is not JSON.');
  }

  const receiptPayload = VerificationReceiptPayloadSchema.parse(decodedPayload);
  const canonicalPayload = Buffer.from(canonicalJson(receiptPayload));
  const signedPayload = Buffer.from(payload);

  if (
    signedPayload.length !== canonicalPayload.length ||
    !timingSafeEqual(signedPayload, canonicalPayload)
  ) {
    throw new MandateVerificationReceiptError(
      'The verification receipt payload is not canonical.',
    );
  }

  if (receiptPayload.keyId !== protectedHeader.kid) {
    throw new MandateVerificationReceiptError('The verification receipt key IDs do not match.');
  }

  assertReceiptMatchesRequest(receiptPayload, input.request);
  assertReceiptMatchesResult(receiptPayload, input.result);

  if (receiptPayload.expiresAt && Date.parse(receiptPayload.expiresAt) <= input.now.getTime()) {
    throw new MandateVerificationReceiptError('The verification receipt has expired.');
  }

  return receiptPayload;
}

export class MandateVerificationBridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'MandateVerificationBridgeError';
  }
}

export class MandateVerificationReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MandateVerificationReceiptError';
  }
}

function assertReceiptMatchesRequest(
  receipt: VerificationReceiptPayload,
  request: MandateVerificationRequest,
): void {
  const expectedCapabilityHash = sha256Base64Url(request.purchaseCapability);

  if (
    receipt.merchantId !== request.merchantId ||
    receipt.merchantOrderRef !== request.merchantOrderRef ||
    receipt.quoteId !== request.quoteId ||
    receipt.capabilityHash !== expectedCapabilityHash ||
    receipt.requestId !== request.requestId
  ) {
    throw new MandateVerificationReceiptError(
      'The verification receipt is bound to another merchant, order, quote, or capability.',
    );
  }
}

function assertReceiptMatchesResult(
  receipt: VerificationReceiptPayload,
  result: VerificationResult,
): void {
  if (
    receipt.verificationId !== result.verificationId ||
    receipt.decision !== result.decision ||
    receipt.reasonCode !== result.reasonCode ||
    receipt.mandateStatus !== result.mandateStatus ||
    receipt.expiresAt !== result.expiresAt
  ) {
    throw new MandateVerificationReceiptError(
      'The verification receipt and response fields do not match.',
    );
  }
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
