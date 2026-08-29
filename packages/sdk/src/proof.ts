import {
  AgentRequestProofClaimsSchema,
  CompactJwsSchema,
  HttpMethodSchema,
  OpaqueIdSchema,
  type AgentRequestProofClaims,
} from '@agentic-mandates/contracts';
import { SignJWT, type CryptoKey } from 'jose';

const REQUEST_PROOF_TYPE = 'application/agentic-mandates-request-proof+jws';
const MAX_PROOF_LIFETIME_SECONDS = 60;
const textEncoder = new TextEncoder();

export type RequestProofSigningInput = {
  method: string;
  url: string;
  rawBody: Uint8Array;
  audience: string;
  nonce?: string;
};

/**
 * The SDK receives a signer instead of a private-key serialization. This
 * keeps signing-key import and storage in the host application's boundary.
 */
export interface RequestProofSigner {
  sign(input: RequestProofSigningInput): Promise<string>;
}

export type Es256RequestProofSignerOptions = {
  issuer: string;
  keyId: string;
  signingKey: CryptoKey;
  subject?: string;
  now?: () => Date;
  proofIdGenerator?: () => string;
  lifetimeSeconds?: number;
};

/**
 * Creates the standard ES256 request-proof signer from an opaque Web Crypto
 * private key. It intentionally does not accept or return a raw JWK.
 */
export function createEs256RequestProofSigner(
  options: Es256RequestProofSignerOptions,
): RequestProofSigner {
  const issuer = parseOpaqueId(options.issuer, 'issuer');
  const subject = parseOpaqueId(options.subject ?? issuer, 'subject');
  const keyId = parseOpaqueId(options.keyId, 'keyId');
  const lifetimeSeconds = options.lifetimeSeconds ?? MAX_PROOF_LIFETIME_SECONDS;

  if (
    !Number.isSafeInteger(lifetimeSeconds)
    || lifetimeSeconds <= 0
    || lifetimeSeconds > MAX_PROOF_LIFETIME_SECONDS
  ) {
    throw new TypeError('lifetimeSeconds must be a positive integer no greater than 60.');
  }
  if (!isPrivateCryptoKey(options.signingKey)) {
    throw new TypeError('signingKey must be an opaque private CryptoKey.');
  }

  const now = options.now ?? (() => new Date());
  const proofIdGenerator = options.proofIdGenerator ?? defaultProofId;

  return {
    async sign(input: RequestProofSigningInput): Promise<string> {
      const method = HttpMethodSchema.parse(input.method.toUpperCase());
      const htu = canonicalRequestUrl(input.url);
      const audience = parseAudience(input.audience);
      const nonce = input.nonce === undefined ? undefined : parseOpaqueId(input.nonce, 'nonce');
      const currentDate = now();
      const issuedAt = Math.floor(currentDate.getTime() / 1_000);

      if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
        throw new TypeError('now() must return a valid date after 1970-01-01.');
      }

      const claims: AgentRequestProofClaims = AgentRequestProofClaimsSchema.parse({
        iss: issuer,
        sub: subject,
        aud: audience,
        htm: method,
        htu,
        body_hash: await sha256Base64Url(input.rawBody),
        iat: issuedAt,
        exp: issuedAt + lifetimeSeconds,
        jti: parseOpaqueId(proofIdGenerator(), 'proofId'),
        ...(nonce === undefined ? {} : { nonce }),
      });

      const proof = await new SignJWT({
        htm: claims.htm,
        htu: claims.htu,
        body_hash: claims.body_hash,
        ...(claims.nonce === undefined ? {} : { nonce: claims.nonce }),
      })
        .setProtectedHeader({
          alg: 'ES256',
          kid: keyId,
          typ: REQUEST_PROOF_TYPE,
        })
        .setIssuer(claims.iss)
        .setSubject(claims.sub)
        .setAudience(claims.aud)
        .setIssuedAt(claims.iat)
        .setExpirationTime(claims.exp)
        .setJti(claims.jti)
        .sign(options.signingKey);

      return CompactJwsSchema.parse(proof);
    },
  };
}

export function canonicalRequestUrl(url: string): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError('The request URL must be an absolute HTTP(S) URL without credentials.');
  }
  return parsed.toString();
}

export async function sha256Base64Url(value: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SubtleCrypto is required to hash request proofs.');
  }

  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
  return bytesToBase64Url(new Uint8Array(digest));
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
    throw new Error('Web Crypto randomUUID is required to generate request proof IDs.');
  }
  return `proof_${globalThis.crypto.randomUUID()}`;
}

function isPrivateCryptoKey(value: CryptoKey): boolean {
  return typeof value === 'object' && value !== null && value.type === 'private';
}

function bytesToBase64Url(value: Uint8Array): string {
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('A base64 encoder is required to hash request proofs.');
  }

  let binary = '';
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
