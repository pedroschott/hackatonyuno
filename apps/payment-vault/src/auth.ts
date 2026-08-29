import {
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type CryptoKey,
  type JWK,
} from 'jose';

import { requestBodyHash } from './canonical.js';

export const PAYMENT_VAULT_AUDIENCE = 'payment-vault';
export const MANDATE_SERVICE_ID = 'mandate-service';

export type ServiceRequestAuthenticationInput = {
  request: Request;
  rawBody: Uint8Array;
  requiredAudience: string;
};

export type AuthenticatedVaultService = {
  serviceId: string;
  keyId: string;
  proofId: string;
};

export type ServiceRequestAuthenticationResult =
  | { ok: true; actor: AuthenticatedVaultService }
  | {
      ok: false;
      code: 'SERVICE_PROOF_INVALID' | 'SERVICE_PROOF_REPLAYED' | 'AUTHENTICATION_UNAVAILABLE';
      message: string;
    };

/**
 * The Vault receives only a service proof. Its production implementation
 * validates an ES256 JWS; test code may inject an equivalent deterministic
 * verifier without creating a browser, merchant, or agent authentication path.
 */
export interface ServiceJwsAuthenticator {
  authenticate(
    input: ServiceRequestAuthenticationInput,
  ): Promise<ServiceRequestAuthenticationResult>;
}

export interface ServiceProofReplayStore {
  claim(input: { keyId: string; proofId: string; expiresAtUnixSeconds: number }): Promise<boolean>;
}

export type ServiceJwsVerificationKey = JWK | CryptoKey | Uint8Array;

export type JoseServiceJwsAuthenticatorOptions = {
  resolveVerificationKey: (keyId: string) => Promise<ServiceJwsVerificationKey | undefined>;
  replayStore: ServiceProofReplayStore;
  expectedServiceId?: string;
  expectedAudience?: string;
  now?: () => Date;
  maxLifetimeSeconds?: number;
};

/**
 * Verifies the exact request-bound, short-lived service JWS described by the
 * architecture. Key lookup and replay persistence are injected so this class
 * does not embed a secret or choose an infrastructure provider.
 */
export class JoseServiceJwsAuthenticator implements ServiceJwsAuthenticator {
  private readonly expectedServiceId: string;
  private readonly expectedAudience: string;
  private readonly now: () => Date;
  private readonly maxLifetimeSeconds: number;

  constructor(private readonly options: JoseServiceJwsAuthenticatorOptions) {
    this.expectedServiceId = options.expectedServiceId ?? MANDATE_SERVICE_ID;
    this.expectedAudience = options.expectedAudience ?? PAYMENT_VAULT_AUDIENCE;
    this.now = options.now ?? (() => new Date());
    this.maxLifetimeSeconds = options.maxLifetimeSeconds ?? 60;
  }

  async authenticate(
    input: ServiceRequestAuthenticationInput,
  ): Promise<ServiceRequestAuthenticationResult> {
    if (input.requiredAudience !== this.expectedAudience) {
      return unavailable('The Vault authenticator audience is misconfigured.');
    }

    const proof = input.request.headers.get('x-mandate-request-proof');
    if (!proof) {
      return invalid('The Mandate-service request proof is required.');
    }

    try {
      const header = decodeProtectedHeader(proof);
      if (header.alg !== 'ES256' || typeof header.kid !== 'string' || header.kid.length === 0) {
        return invalid('The Mandate-service request proof is invalid.');
      }

      const verificationKey = await this.options.resolveVerificationKey(header.kid);
      if (!verificationKey) {
        return invalid('The Mandate-service request proof is invalid.');
      }

      const { payload, protectedHeader } = await jwtVerify(
        proof,
        await importVerificationKey(verificationKey),
        {
          algorithms: ['ES256'],
          issuer: this.expectedServiceId,
          subject: this.expectedServiceId,
          audience: this.expectedAudience,
          currentDate: this.now(),
        },
      );

      const keyId = protectedHeader.kid;
      if (typeof keyId !== 'string' || keyId !== header.kid) {
        return invalid('The Mandate-service request proof is invalid.');
      }

      const proofId = readStringClaim(payload, 'jti');
      const method = readStringClaim(payload, 'htm');
      const url = readStringClaim(payload, 'htu');
      const bodyHash = readStringClaim(payload, 'body_hash');
      const issuedAt = payload.iat;
      const expiresAt = payload.exp;
      const nowSeconds = Math.floor(this.now().getTime() / 1000);

      if (
        !proofId ||
        !method ||
        !url ||
        !bodyHash ||
        typeof issuedAt !== 'number' ||
        typeof expiresAt !== 'number' ||
        issuedAt > nowSeconds + 5 ||
        expiresAt <= nowSeconds ||
        expiresAt - issuedAt > this.maxLifetimeSeconds ||
        method !== input.request.method.toUpperCase() ||
        url !== canonicalRequestUrl(input.request) ||
        bodyHash !== requestBodyHash(input.rawBody)
      ) {
        return invalid('The Mandate-service request proof is invalid.');
      }

      let claimed: boolean;
      try {
        claimed = await this.options.replayStore.claim({
          keyId,
          proofId,
          expiresAtUnixSeconds: expiresAt,
        });
      } catch {
        return unavailable('The service-proof replay store is unavailable.');
      }

      if (!claimed) {
        return {
          ok: false,
          code: 'SERVICE_PROOF_REPLAYED',
          message: 'The Mandate-service request proof was already used.',
        };
      }

      return {
        ok: true,
        actor: {
          serviceId: this.expectedServiceId,
          keyId,
          proofId,
        },
      };
    } catch {
      return invalid('The Mandate-service request proof is invalid.');
    }
  }
}

/** Test adapter. Production uses a shared durable replay store. */
export class InMemoryServiceProofReplayStore implements ServiceProofReplayStore {
  private readonly usedProofs = new Map<string, number>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async claim(input: {
    keyId: string;
    proofId: string;
    expiresAtUnixSeconds: number;
  }): Promise<boolean> {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    for (const [key, expiry] of this.usedProofs) {
      if (expiry <= nowSeconds) {
        this.usedProofs.delete(key);
      }
    }

    const replayKey = `${input.keyId}:${input.proofId}`;
    if (this.usedProofs.has(replayKey)) {
      return false;
    }
    this.usedProofs.set(replayKey, input.expiresAtUnixSeconds);
    return true;
  }
}

export function canonicalRequestUrl(request: Request): string {
  return new URL(request.url).toString();
}

async function importVerificationKey(
  key: ServiceJwsVerificationKey,
): Promise<CryptoKey | Uint8Array> {
  if (isJwk(key)) {
    return importJWK(key, 'ES256');
  }
  return key;
}

function isJwk(key: ServiceJwsVerificationKey): key is JWK {
  return typeof key === 'object' && key !== null && 'kty' in key;
}

function readStringClaim(payload: Record<string, unknown>, name: string): string | undefined {
  const value = payload[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function invalid(message: string): ServiceRequestAuthenticationResult {
  return { ok: false, code: 'SERVICE_PROOF_INVALID', message };
}

function unavailable(message: string): ServiceRequestAuthenticationResult {
  return { ok: false, code: 'AUTHENTICATION_UNAVAILABLE', message };
}
