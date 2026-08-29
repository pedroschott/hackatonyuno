import {
  AgentRequestProofClaimsSchema,
  type AgentRequestProofClaims,
} from '@agentic-mandates/contracts';
import { sha256Base64Url } from '@agentic-mandates/domain';
import {
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type CryptoKey,
  type JWK,
} from 'jose';

import {
  MANDATE_API_AUDIENCE,
  type AgentAuthenticationResult,
  type AgentRequestAuthenticator,
  type MerchantAuthenticationResult,
  type MerchantRequestAuthenticator,
  type RequestAuthenticationInput,
} from './types.js';

export type RequestProofActorKind = 'agent' | 'merchant';
export type RequestProofVerificationKey = JWK | CryptoKey | Uint8Array;

const REQUEST_PROOF_JWS_TYPE = 'application/agentic-mandates-request-proof+jws';

/**
 * The registry is the source of truth for identity/key status. It should
 * return only the currently registered public key and never accept a key sent
 * by a request header.
 */
export interface RequestProofKeyRegistry {
  resolve(input: {
    actorKind: RequestProofActorKind;
    keyId: string;
  }): Promise<
    | {
        status: 'active';
        actorId: string;
        publicKey: RequestProofVerificationKey;
      }
    | { status: 'revoked' | 'unknown' }
    | undefined
  >;
}

export interface RequestProofReplayStore {
  claim(input: {
    actorKind: RequestProofActorKind;
    keyId: string;
    proofId: string;
    expiresAtUnixSeconds: number;
  }): Promise<boolean>;
}

type JoseRequestAuthenticatorOptions = {
  keyRegistry: RequestProofKeyRegistry;
  replayStore: RequestProofReplayStore;
  now?: () => Date;
  expectedAudience?: typeof MANDATE_API_AUDIENCE;
  maxLifetimeSeconds?: number;
};

/**
 * ES256 agent proof verifier for the production composition. It binds the
 * identity, current registered key, audience, method, canonical URL, body
 * hash, expiry, and one-time jti before entering the authorization circuit.
 */
export class JoseAgentRequestAuthenticator implements AgentRequestAuthenticator {
  private readonly verifier: JoseRequestProofAuthenticator;

  constructor(options: JoseRequestAuthenticatorOptions) {
    this.verifier = new JoseRequestProofAuthenticator('agent', options);
  }

  async authenticate(input: RequestAuthenticationInput): Promise<AgentAuthenticationResult> {
    const result = await this.verifier.authenticate(input);
    if (!result.ok) {
      return {
        ok: false,
        code:
          result.kind === 'revoked'
            ? 'AGENT_KEY_REVOKED'
            : result.kind === 'unavailable'
              ? 'SERVICE_UNAVAILABLE'
              : result.kind === 'replayed'
                ? 'REQUEST_REPLAYED'
              : result.kind === 'invalid'
                ? 'AGENT_PROOF_INVALID'
                : 'AGENT_AUTH_REQUIRED',
        message: result.message,
      };
    }
    return {
      ok: true,
      actor: { agentId: result.actorId, keyId: result.keyId },
    };
  }
}

/** Merchant service proof verifier; this is distinct from agent identity. */
export class JoseMerchantRequestAuthenticator implements MerchantRequestAuthenticator {
  private readonly verifier: JoseRequestProofAuthenticator;

  constructor(options: JoseRequestAuthenticatorOptions) {
    this.verifier = new JoseRequestProofAuthenticator('merchant', options);
  }

  async authenticate(input: RequestAuthenticationInput): Promise<MerchantAuthenticationResult> {
    const result = await this.verifier.authenticate(input);
    if (!result.ok) {
      return {
        ok: false,
        code:
          result.kind === 'unavailable'
            ? 'SERVICE_UNAVAILABLE'
            : result.kind === 'replayed'
              ? 'REQUEST_REPLAYED'
              : 'MERCHANT_AUTH_REQUIRED',
        message: result.message,
      };
    }
    return {
      ok: true,
      actor: { merchantId: result.actorId, keyId: result.keyId },
    };
  }
}

class JoseRequestProofAuthenticator {
  private readonly now: () => Date;
  private readonly expectedAudience: typeof MANDATE_API_AUDIENCE;
  private readonly maxLifetimeSeconds: number;

  constructor(
    private readonly actorKind: RequestProofActorKind,
    private readonly options: JoseRequestAuthenticatorOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.expectedAudience = options.expectedAudience ?? MANDATE_API_AUDIENCE;
    this.maxLifetimeSeconds = options.maxLifetimeSeconds ?? 60;
  }

  async authenticate(input: RequestAuthenticationInput): Promise<ProofAuthenticationResult> {
    if (input.requiredAudience !== this.expectedAudience) {
      return unavailable('The request-proof verifier audience is misconfigured.');
    }
    const proof = input.request.headers.get(
      this.actorKind === 'agent' ? 'x-agent-request-proof' : 'x-merchant-request-proof',
    );
    if (!proof) {
      return missing('A signed request proof is required.');
    }

    try {
      const header = decodeProtectedHeader(proof);
      if (
        header.alg !== 'ES256' ||
        header.typ !== REQUEST_PROOF_JWS_TYPE ||
        typeof header.kid !== 'string' ||
        header.kid.length === 0
      ) {
        return invalid('The signed request proof is invalid.');
      }
      const registeredKey = await this.options.keyRegistry.resolve({
        actorKind: this.actorKind,
        keyId: header.kid,
      });
      if (!registeredKey || registeredKey.status === 'unknown') {
        return invalid('The signed request proof is invalid.');
      }
      if (registeredKey.status === 'revoked') {
        return revoked('The request-signing key has been revoked.');
      }
      if (registeredKey.status !== 'active') {
        return invalid('The signed request proof is invalid.');
      }

      const verified = await jwtVerify(proof, await importVerificationKey(registeredKey.publicKey), {
        algorithms: ['ES256'],
        audience: this.expectedAudience,
        currentDate: this.now(),
      });
      const claims = AgentRequestProofClaimsSchema.safeParse(verified.payload);
      if (!claims.success || !hasValidRequestBinding(claims.data, input, this.now(), this.maxLifetimeSeconds)) {
        return invalid('The signed request proof is invalid.');
      }
      if (
        claims.data.iss !== registeredKey.actorId ||
        claims.data.sub !== registeredKey.actorId ||
        verified.protectedHeader.kid !== header.kid
      ) {
        return invalid('The signed request proof is invalid.');
      }

      let claimed: boolean;
      try {
        claimed = await this.options.replayStore.claim({
          actorKind: this.actorKind,
          keyId: header.kid,
          proofId: claims.data.jti,
          expiresAtUnixSeconds: claims.data.exp,
        });
      } catch {
        return unavailable('Request-proof replay storage is temporarily unavailable.');
      }
      if (!claimed) {
        return replayed('The signed request proof was already used.');
      }

      return { ok: true, actorId: registeredKey.actorId, keyId: header.kid };
    } catch {
      return invalid('The signed request proof is invalid.');
    }
  }
}

type ProofAuthenticationResult =
  | { ok: true; actorId: string; keyId: string }
  | {
      ok: false;
      kind: 'missing' | 'invalid' | 'replayed' | 'revoked' | 'unavailable';
      message: string;
    };

/** In-memory replay protection for tests only; production needs durable storage. */
export class InMemoryRequestProofReplayStore implements RequestProofReplayStore {
  private readonly entries = new Map<string, number>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async claim(input: {
    actorKind: RequestProofActorKind;
    keyId: string;
    proofId: string;
    expiresAtUnixSeconds: number;
  }): Promise<boolean> {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    for (const [key, expiry] of this.entries) {
      if (expiry <= nowSeconds) {
        this.entries.delete(key);
      }
    }
    const replayKey = `${input.actorKind}:${input.keyId}:${input.proofId}`;
    if (this.entries.has(replayKey)) {
      return false;
    }
    this.entries.set(replayKey, input.expiresAtUnixSeconds);
    return true;
  }
}

function hasValidRequestBinding(
  claims: AgentRequestProofClaims,
  input: RequestAuthenticationInput,
  now: Date,
  maxLifetimeSeconds: number,
): boolean {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  return (
    claims.aud === input.requiredAudience &&
    claims.htm === input.request.method.toUpperCase() &&
    claims.htu === canonicalRequestUrl(input.request) &&
    claims.body_hash === sha256Base64Url(input.rawBody) &&
    claims.iat <= nowSeconds + 5 &&
    claims.exp > nowSeconds &&
    claims.exp - claims.iat <= maxLifetimeSeconds
  );
}

function canonicalRequestUrl(request: Request): string {
  return new URL(request.url).toString();
}

async function importVerificationKey(
  key: RequestProofVerificationKey,
): Promise<CryptoKey | Uint8Array> {
  if (isJwk(key)) {
    return importJWK(key, 'ES256');
  }
  return key;
}

function isJwk(key: RequestProofVerificationKey): key is JWK {
  return typeof key === 'object' && key !== null && 'kty' in key;
}

function missing(message: string): ProofAuthenticationResult {
  return { ok: false, kind: 'missing', message };
}

function invalid(message: string): ProofAuthenticationResult {
  return { ok: false, kind: 'invalid', message };
}

function replayed(message: string): ProofAuthenticationResult {
  return { ok: false, kind: 'replayed', message };
}

function revoked(message: string): ProofAuthenticationResult {
  return { ok: false, kind: 'revoked', message };
}

function unavailable(message: string): ProofAuthenticationResult {
  return { ok: false, kind: 'unavailable', message };
}
