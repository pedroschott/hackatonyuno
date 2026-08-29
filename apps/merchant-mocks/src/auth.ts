import {
  AgentRequestProofClaimsSchema,
  CompactJwsSchema,
  OpaqueIdSchema,
  type AgentRequestProofClaims,
  type ReasonCode,
} from '@agentic-mandates/contracts';
import { sha256Base64Url } from '@agentic-mandates/domain';
import {
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
} from 'jose';

export type MerchantEndpointPurpose = 'search' | 'quote' | 'quote_read' | 'order_verification';

export type MerchantRequestActor =
  | { type: 'agent'; id: string }
  | { type: 'mandate-service'; id: string };

export type MerchantRequestAuthenticationInput = {
  request: Request;
  merchantId: string;
  purpose: MerchantEndpointPurpose;
};

export type MerchantRequestAuthenticationResult =
  | { ok: true; actor: MerchantRequestActor }
  | { ok: false; status: 401 | 403 | 503; code: ReasonCode; message: string };

export interface MerchantRequestAuthenticator {
  authenticate(
    input: MerchantRequestAuthenticationInput,
  ): Promise<MerchantRequestAuthenticationResult>;
}

/**
 * A key is registered by the Mandate service, never self-declared by the
 * incoming JWT. The resolver must return public material only.
 */
export type MerchantRequestProofKey = {
  keyId: string;
  publicJwk: JWK;
  actor: MerchantRequestActor;
  status: 'active' | 'revoked' | 'suspended';
};

export interface MerchantRequestProofKeyResolver {
  getByKeyId(keyId: string): Promise<MerchantRequestProofKey | undefined>;
}

/**
 * This claim must be atomic. A durable implementation should retain the
 * record through `expiresAt` and report replay when another request won.
 */
export type MerchantRequestReplayClaim = {
  namespace: 'merchant-request-proof';
  keyId: string;
  actor: MerchantRequestActor;
  jti: string;
  expiresAt: string;
};

export type MerchantRequestReplayClaimResult =
  | { kind: 'claimed' }
  | { kind: 'replayed' };

export interface MerchantRequestReplayStore {
  claim(input: MerchantRequestReplayClaim): Promise<MerchantRequestReplayClaimResult>;
}

export type JoseMerchantRequestAuthenticatorOptions = {
  keyResolver: MerchantRequestProofKeyResolver;
  replayStore: MerchantRequestReplayStore;
  now?: () => Date;
  /** Defaults to 60 seconds and may not exceed five minutes. */
  maxProofLifetimeSeconds?: number;
  /** Small allowance for clock skew; defaults to five seconds. */
  clockToleranceSeconds?: number;
};

const DEFAULT_MAX_PROOF_LIFETIME_SECONDS = 60;
const MAX_PROOF_LIFETIME_SECONDS = 5 * 60;
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 5;
const REQUEST_PROOF_TYPE = 'application/agentic-mandates-request-proof+jws';

/**
 * Verifies one ES256 request proof bound to the exact HTTP request. Browser
 * cookies are deliberately not accepted at this machine-to-machine boundary.
 */
export class JoseMerchantRequestAuthenticator implements MerchantRequestAuthenticator {
  private readonly now: () => Date;
  private readonly maxProofLifetimeSeconds: number;
  private readonly clockToleranceSeconds: number;

  constructor(private readonly options: JoseMerchantRequestAuthenticatorOptions) {
    this.now = options.now ?? (() => new Date());
    this.maxProofLifetimeSeconds =
      options.maxProofLifetimeSeconds ?? DEFAULT_MAX_PROOF_LIFETIME_SECONDS;
    this.clockToleranceSeconds =
      options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;

    if (
      !Number.isInteger(this.maxProofLifetimeSeconds) ||
      this.maxProofLifetimeSeconds <= 0 ||
      this.maxProofLifetimeSeconds > MAX_PROOF_LIFETIME_SECONDS
    ) {
      throw new Error(
        `maxProofLifetimeSeconds must be an integer between 1 and ${MAX_PROOF_LIFETIME_SECONDS}.`,
      );
    }

    if (
      !Number.isInteger(this.clockToleranceSeconds) ||
      this.clockToleranceSeconds < 0 ||
      this.clockToleranceSeconds > this.maxProofLifetimeSeconds
    ) {
      throw new Error(
        'clockToleranceSeconds must be an integer between zero and maxProofLifetimeSeconds.',
      );
    }
  }

  async authenticate(
    input: MerchantRequestAuthenticationInput,
  ): Promise<MerchantRequestAuthenticationResult> {
    const selectedProof = selectRequestProof(input.request);
    if (!selectedProof.ok) {
      return selectedProof.failure;
    }

    const compactProof = CompactJwsSchema.safeParse(selectedProof.proof);
    if (!compactProof.success) {
      return invalidProof();
    }

    const keyId = readKeyId(compactProof.data);
    if (!keyId) {
      return invalidProof();
    }

    let registeredKey: MerchantRequestProofKey | undefined;
    try {
      registeredKey = await this.options.keyResolver.getByKeyId(keyId);
    } catch {
      return authenticationUnavailable('The registered request-proof key could not be resolved.');
    }

    if (!registeredKey || registeredKey.keyId !== keyId) {
      return invalidProof();
    }

    if (!isRegisteredActor(registeredKey.actor)) {
      return authenticationUnavailable('The registered request-proof actor is not usable.');
    }

    if (registeredKey.status === 'revoked') {
      return {
        ok: false,
        status: 401,
        code: 'AGENT_KEY_REVOKED',
        message: 'The request-proof signing key has been revoked.',
      };
    }

    if (registeredKey.status !== 'active') {
      return {
        ok: false,
        status: 401,
        code: 'AGENT_KEY_REVOKED',
        message: 'The request-proof signing key is not active.',
      };
    }

    if (registeredKey.actor.type !== selectedProof.actorType) {
      return invalidProof();
    }

    if (!isEs256PublicJwk(registeredKey.publicJwk)) {
      return authenticationUnavailable('The registered request-proof key is not usable.');
    }

    let now: Date;
    try {
      now = this.now();
    } catch {
      return authenticationUnavailable('The request-proof clock is unavailable.');
    }

    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      return authenticationUnavailable('The request-proof clock is unavailable.');
    }

    let claims: AgentRequestProofClaims;
    try {
      const verificationKey = await importJWK(registeredKey.publicJwk, 'ES256');
      const verification = await jwtVerify(compactProof.data, verificationKey, {
        algorithms: ['ES256'],
        audience: merchantRequestProofAudience(input.merchantId),
        issuer: registeredKey.actor.id,
        subject: registeredKey.actor.id,
        requiredClaims: [
          'iss',
          'sub',
          'aud',
          'htm',
          'htu',
          'body_hash',
          'iat',
          'exp',
          'jti',
        ],
        maxTokenAge: this.maxProofLifetimeSeconds,
        currentDate: now,
        clockTolerance: this.clockToleranceSeconds,
      });
      const parsedClaims = AgentRequestProofClaimsSchema.safeParse(verification.payload);

      if (!parsedClaims.success) {
        return invalidProof();
      }

      claims = parsedClaims.data;
    } catch {
      return invalidProof();
    }

    if (
      !(await isRequestBoundProof(
        claims,
        input.request,
        now,
        this.maxProofLifetimeSeconds,
        this.clockToleranceSeconds,
      ))
    ) {
      return invalidProof();
    }

    try {
      const replayResult = await this.options.replayStore.claim({
        namespace: 'merchant-request-proof',
        keyId,
        actor: registeredKey.actor,
        jti: claims.jti,
        expiresAt: new Date(
          (claims.exp + this.clockToleranceSeconds) * 1_000,
        ).toISOString(),
      });

      if (replayResult.kind === 'replayed') {
        return {
          ok: false,
          status: 401,
          code: 'REQUEST_REPLAYED',
          message: 'This request proof has already been used.',
        };
      }
    } catch {
      return authenticationUnavailable('The request-proof replay store is unavailable.');
    }

    return { ok: true, actor: registeredKey.actor };
  }
}

/** The audience is deliberately bound to one registered merchant endpoint. */
export function merchantRequestProofAudience(merchantId: string): string {
  return `merchant-api:${merchantId}`;
}

/** Fails closed until the host wires the shared ES256 proof verifier. */
export class RejectingMerchantRequestAuthenticator implements MerchantRequestAuthenticator {
  async authenticate(): Promise<MerchantRequestAuthenticationResult> {
    return {
      ok: false,
      status: 401,
      code: 'AGENT_AUTH_REQUIRED',
      message: 'A registered agent request proof is required.',
    };
  }
}

function selectRequestProof(
  request: Request,
):
  | { ok: true; proof: string; actorType: MerchantRequestActor['type'] }
  | { ok: false; failure: MerchantRequestAuthenticationResult } {
  const agentProof = request.headers.get('x-agent-request-proof')?.trim();
  const mandateServiceProof = request.headers.get('x-mandate-request-proof')?.trim();

  if (agentProof && mandateServiceProof) {
    return {
      ok: false,
      failure: {
        ok: false,
        status: 401,
        code: 'AGENT_PROOF_INVALID',
        message: 'Exactly one request-proof header is required.',
      },
    };
  }

  if (agentProof) {
    return { ok: true, proof: agentProof, actorType: 'agent' };
  }

  if (mandateServiceProof) {
    return { ok: true, proof: mandateServiceProof, actorType: 'mandate-service' };
  }

  return {
    ok: false,
    failure: {
      ok: false,
      status: 401,
      code: 'AGENT_AUTH_REQUIRED',
      message: 'A registered request proof is required.',
    },
  };
}

function readKeyId(proof: string): string | undefined {
  try {
    const header = decodeProtectedHeader(proof);
    const keyId = header.kid;
    if (header.alg !== 'ES256' || header.typ !== REQUEST_PROOF_TYPE) {
      return undefined;
    }

    return typeof keyId === 'string' && OpaqueIdSchema.safeParse(keyId).success
      ? keyId
      : undefined;
  } catch {
    return undefined;
  }
}

function isEs256PublicJwk(jwk: unknown): jwk is JWK {
  if (typeof jwk !== 'object' || jwk === null) {
    return false;
  }

  const candidate = jwk as Partial<JWK>;
  return (
    candidate.kty === 'EC' &&
    candidate.crv === 'P-256' &&
    typeof candidate.x === 'string' &&
    typeof candidate.y === 'string' &&
    candidate.d === undefined &&
    (candidate.alg === undefined || candidate.alg === 'ES256') &&
    (candidate.use === undefined || candidate.use === 'sig')
  );
}

function isRegisteredActor(actor: unknown): actor is MerchantRequestActor {
  return (
    typeof actor === 'object' &&
    actor !== null &&
    'type' in actor &&
    'id' in actor &&
    (actor.type === 'agent' || actor.type === 'mandate-service') &&
    OpaqueIdSchema.safeParse(actor.id).success
  );
}

async function isRequestBoundProof(
  claims: AgentRequestProofClaims,
  request: Request,
  now: Date,
  maxProofLifetimeSeconds: number,
  clockToleranceSeconds: number,
): Promise<boolean> {
  const nowSeconds = Math.floor(now.getTime() / 1_000);

  if (
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    claims.iat > nowSeconds + clockToleranceSeconds ||
    claims.exp - claims.iat > maxProofLifetimeSeconds
  ) {
    return false;
  }

  if (claims.htm !== request.method.toUpperCase() || claims.htu !== request.url) {
    return false;
  }

  try {
    return (await requestBodyHash(request)) === claims.body_hash;
  } catch {
    return false;
  }
}

async function requestBodyHash(request: Request): Promise<string> {
  return sha256Base64Url(new Uint8Array(await request.clone().arrayBuffer()));
}

function invalidProof(): MerchantRequestAuthenticationResult {
  return {
    ok: false,
    status: 401,
    code: 'AGENT_PROOF_INVALID',
    message: 'The request proof is invalid, expired, or does not match this request.',
  };
}

function authenticationUnavailable(message: string): MerchantRequestAuthenticationResult {
  return {
    ok: false,
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    message,
  };
}
