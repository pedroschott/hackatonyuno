import { CompactJwsSchema, HttpMethodSchema, OpaqueIdSchema } from '@agentic-mandates/contracts';
import { sha256Base64Url } from '@agentic-mandates/domain';
import { SignJWT, type CryptoKey } from 'jose';

/** Shared request-proof media type accepted by merchant and Vault boundaries. */
const SERVICE_REQUEST_PROOF_TYPE = 'application/agentic-mandates-request-proof+jws';
const DEFAULT_PROOF_LIFETIME_SECONDS = 60;

export type ServiceRequestProofSigningInput = {
  method: string;
  url: string;
  rawBody: Uint8Array;
  audience: string;
};

/**
 * A server-owned signing boundary. Adapters receive this interface instead of
 * a serialized private key, so HTTP clients never need to expose key material.
 */
export interface ServiceRequestProofSigner {
  sign(input: ServiceRequestProofSigningInput): Promise<string>;
}

export type Es256ServiceRequestProofSignerOptions = {
  issuer: string;
  keyId: string;
  signingKey: CryptoKey;
  subject?: string;
  now?: () => Date;
  proofIdGenerator?: () => string;
  lifetimeSeconds?: number;
};

/**
 * Creates a short-lived ES256 request-proof signer for a trusted service.
 * The proof binds method, canonical URL, raw request body, audience and a
 * one-time identifier before an internal HTTP request is sent.
 */
export function createEs256ServiceRequestProofSigner(
  options: Es256ServiceRequestProofSignerOptions,
): ServiceRequestProofSigner {
  const issuer = parseOpaqueId(options.issuer, 'issuer');
  const subject = parseOpaqueId(options.subject ?? issuer, 'subject');
  const keyId = parseOpaqueId(options.keyId, 'keyId');
  const lifetimeSeconds = options.lifetimeSeconds ?? DEFAULT_PROOF_LIFETIME_SECONDS;

  if (
    !Number.isSafeInteger(lifetimeSeconds)
    || lifetimeSeconds <= 0
    || lifetimeSeconds > DEFAULT_PROOF_LIFETIME_SECONDS
  ) {
    throw new TypeError('lifetimeSeconds must be a positive integer no greater than 60.');
  }
  if (!isPrivateCryptoKey(options.signingKey)) {
    throw new TypeError('signingKey must be an opaque private CryptoKey.');
  }

  const now = options.now ?? (() => new Date());
  const proofIdGenerator = options.proofIdGenerator ?? defaultProofId;

  return {
    async sign(input: ServiceRequestProofSigningInput): Promise<string> {
      const method = HttpMethodSchema.parse(input.method.toUpperCase());
      const url = canonicalServiceRequestUrl(input.url);
      const audience = parseAudience(input.audience);
      const currentDate = now();
      const issuedAt = Math.floor(currentDate.getTime() / 1_000);

      if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
        throw new TypeError('now() must return a valid date after 1970-01-01.');
      }

      const proof = await new SignJWT({
        htm: method,
        htu: url,
        body_hash: sha256Base64Url(input.rawBody),
      })
        .setProtectedHeader({
          alg: 'ES256',
          kid: keyId,
          typ: SERVICE_REQUEST_PROOF_TYPE,
        })
        .setIssuer(issuer)
        .setSubject(subject)
        .setAudience(audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + lifetimeSeconds)
        .setJti(parseOpaqueId(proofIdGenerator(), 'proofId'))
        .sign(options.signingKey);

      return CompactJwsSchema.parse(proof);
    },
  };
}

/** The exact URL representation used by the service request-proof claims. */
export function canonicalServiceRequestUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError('The service request URL must be an absolute HTTP(S) URL without credentials or a fragment.');
  }
  return url.toString();
}

function parseOpaqueId(value: string, field: string): string {
  const parsed = OpaqueIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(`${field} must be a valid opaque identifier.`);
  }
  return parsed.data;
}

function parseAudience(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || value !== value.trim()) {
    throw new TypeError('audience must be a non-empty trimmed string of at most 160 characters.');
  }
  return value;
}

function defaultProofId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Web Crypto randomUUID is required to generate service request proof IDs.');
  }
  return `service_proof_${globalThis.crypto.randomUUID()}`;
}

function isPrivateCryptoKey(value: CryptoKey): boolean {
  return typeof value === 'object' && value !== null && value.type === 'private';
}
