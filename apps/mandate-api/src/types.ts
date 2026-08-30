import type {
  Mandate,
  MerchantQuote,
  NormalizedQuote,
  PolicyUsageSnapshot,
  PurchaseCapabilityPayload,
  ReasonCode,
  SettlementStatus,
} from '@agentic-mandates/contracts';
import type { JWK } from 'jose';

/** The audience required for all agent and merchant requests to this service. */
export const MANDATE_API_AUDIENCE = 'mandate-api';

export type RequestAuthenticationInput = {
  request: Request;
  rawBody: Uint8Array;
  requiredAudience: typeof MANDATE_API_AUDIENCE;
};

export type AuthenticationFailure = {
  ok: false;
  code: Extract<
    ReasonCode,
    | 'AGENT_AUTH_REQUIRED'
    | 'MERCHANT_AUTH_REQUIRED'
    | 'ACTOR_NOT_ALLOWED'
    | 'AGENT_PROOF_INVALID'
    | 'AGENT_KEY_REVOKED'
    | 'MERCHANT_INACTIVE'
    | 'REQUEST_REPLAYED'
    | 'SERVICE_UNAVAILABLE'
  >;
  message: string;
};

export type AgentAuthenticationResult =
  | {
      ok: true;
      actor: {
        agentId: string;
        keyId: string;
      };
    }
  | AuthenticationFailure;

export type MerchantAuthenticationResult =
  | {
      ok: true;
      actor: {
        merchantId: string;
        keyId: string;
      };
    }
  | AuthenticationFailure;

export type PrincipalAuthenticationResult =
  | {
      ok: true;
      actor: {
        principalId: string;
      };
    }
  | AuthenticationFailure;

/**
 * Authentication is intentionally injected. The Hono core never accepts a
 * browser cookie, a static token, or a test identity as a production default.
 */
export interface AgentRequestAuthenticator {
  authenticate(input: RequestAuthenticationInput): Promise<AgentAuthenticationResult>;
}

export interface MerchantRequestAuthenticator {
  authenticate(input: RequestAuthenticationInput): Promise<MerchantAuthenticationResult>;
}

export interface PrincipalRequestAuthenticator {
  authenticate(input: RequestAuthenticationInput): Promise<PrincipalAuthenticationResult>;
}

/** Ordered, Mandate-controlled merchant assurance levels. */
export type MerchantTrustTier = 'low' | 'standard' | 'high';

/**
 * This local policy extension is stored alongside an immutable mandate version
 * until the shared contract migration carries it. It is never supplied by the
 * agent or merchant request.
 */
export type MandateTrustConstraint = {
  minimumMerchantTrustTier: MerchantTrustTier;
};

export interface MandateTrustPolicyStore {
  get(input: {
    mandateId: string;
    mandateVersion: number;
  }): Promise<MandateTrustConstraint | undefined>;
}

/** Registry data is owned by the Mandate service, never self-reported by a merchant. */
export type RegisteredMerchant = {
  merchantId: string;
  status: 'active' | 'inactive';
  trustTier: MerchantTrustTier;
  quoteEndpoint: string;
  quoteVerificationKeys: ReadonlyMap<string, JWK>;
};

export interface MerchantRegistry {
  get(merchantId: string): Promise<RegisteredMerchant | undefined>;
}

/**
 * The concrete adapter fetches a quote from the registry-resolved merchant
 * endpoint with a service proof. This core only accepts the verified boundary
 * as an injection so tests cannot accidentally rely on an unregistered URL.
 */
export interface MerchantQuoteSource {
  getQuote(input: {
    merchant: RegisteredMerchant;
    quoteId: string;
  }): Promise<unknown | undefined>;
}

export type NormalizeQuoteResult =
  | { ok: true; normalized: NormalizedQuote }
  | {
      ok: false;
      code: Extract<ReasonCode, 'UNMAPPED_CATEGORY' | 'SERVICE_UNAVAILABLE'>;
      message: string;
    };

/** A Mandate-owned taxonomy adapter. Merchant categories are input, not policy. */
export interface TaxonomyNormalizer {
  normalize(input: {
    merchant: RegisteredMerchant;
    quote: MerchantQuote;
  }): Promise<NormalizeQuoteResult>;
}

export type StoredCapabilityStatus =
  | 'issued'
  | 'authorized'
  | 'consumed'
  | 'voided'
  | 'expired';

/** Private local state; the JWS remains the capability presented to merchants. */
export type StoredCapability = {
  payload: PurchaseCapabilityPayload;
  capabilityHash: string;
  status: StoredCapabilityStatus;
  issuedAt: string;
  authorizationId?: string;
  paymentOperationId?: string;
  captureStartedAt?: string;
  consumedAt?: string;
  voidedAt?: string;
};

export type CapabilityIssueInput = {
  capability: StoredCapability;
  expectedMandateVersion: number;
  now: string;
};

export type CapabilityIssueResult =
  | { ok: true; mandate: Mandate; usage: PolicyUsageSnapshot }
  | {
      ok: false;
      reasonCode: Extract<
        ReasonCode,
        | 'MANDATE_NOT_FOUND'
        | 'MANDATE_INACTIVE'
        | 'MANDATE_PAUSED'
        | 'MANDATE_REVOKED'
        | 'MANDATE_EXPIRED'
        | 'VERIFICATION_IN_PROGRESS'
      >;
    };

export type CapabilityClaimResult =
  | { ok: true; mandate: Mandate; capability: StoredCapability }
  | {
      ok: false;
      reasonCode: Extract<
        ReasonCode,
        | 'MANDATE_NOT_FOUND'
        | 'MANDATE_INACTIVE'
        | 'MANDATE_PAUSED'
        | 'MANDATE_REVOKED'
        | 'MANDATE_EXPIRED'
        | 'CAPABILITY_INVALID'
        | 'CAPABILITY_EXPIRED'
        | 'CAPABILITY_REPLAYED'
        | 'CAPABILITY_REVOKED'
      >;
    };

export type BeginCaptureResult =
  | { ok: true; mandate: Mandate; capability: StoredCapability }
  | {
      ok: false;
      reasonCode: Extract<
        ReasonCode,
        | 'MANDATE_NOT_FOUND'
        | 'MANDATE_INACTIVE'
        | 'MANDATE_PAUSED'
        | 'MANDATE_REVOKED'
        | 'MANDATE_EXPIRED'
        | 'CAPABILITY_INVALID'
        | 'CAPABILITY_REPLAYED'
      >;
    };

export type RecordPendingAuthorizationResult =
  | { ok: true; mandate: Mandate; capability: StoredCapability }
  | {
      ok: false;
      reasonCode: Extract<
        ReasonCode,
        | 'MANDATE_NOT_FOUND'
        | 'MANDATE_INACTIVE'
        | 'MANDATE_PAUSED'
        | 'MANDATE_REVOKED'
        | 'MANDATE_EXPIRED'
        | 'CAPABILITY_INVALID'
        | 'CAPABILITY_REPLAYED'
      >;
    };

export type FinalizeCaptureResult =
  | { ok: true; mandate: Mandate; capability: StoredCapability }
  | {
      ok: false;
      reasonCode: Extract<
        ReasonCode,
        | 'MANDATE_NOT_FOUND'
        | 'MANDATE_REVOKED'
        | 'CAPABILITY_INVALID'
        | 'CAPABILITY_REPLAYED'
      >;
    };

export type MandateRevocationResult =
  | {
      ok: true;
      mandate: Mandate;
      /** Authorized before capture; void is retried idempotently after revocation commits. */
      authorizationsToVoid: ReadonlyArray<{
        authorizationId: string;
        paymentOperationId: string;
      }>;
    }
  | {
      ok: false;
      reasonCode: Extract<ReasonCode, 'MANDATE_NOT_FOUND' | 'ACTOR_NOT_ALLOWED'>;
    };

/**
 * Production implements these state transitions in one local Postgres
 * transaction. Separating the Vault does not permit a distributed ACID claim.
 */
export interface MandateStateStore {
  getMandate(mandateId: string): Promise<Mandate | undefined>;
  getUsage(mandateId: string): Promise<PolicyUsageSnapshot>;
  getCapability(input: {
    capabilityId: string;
    capabilityHash: string;
  }): Promise<StoredCapability | undefined>;
  issueCapability(input: CapabilityIssueInput): Promise<CapabilityIssueResult>;
  claimCapability(input: {
    capabilityId: string;
    capabilityHash: string;
    paymentOperationId: string;
    now: string;
  }): Promise<CapabilityClaimResult>;
  recordPendingAuthorization(input: {
    capabilityId: string;
    capabilityHash: string;
    paymentOperationId: string;
    authorizationId: string;
    now: string;
  }): Promise<RecordPendingAuthorizationResult>;
  beginCapture(input: {
    capabilityId: string;
    paymentOperationId: string;
    authorizationId: string;
    now: string;
  }): Promise<BeginCaptureResult>;
  finalizeCapturedCapability(input: {
    capabilityId: string;
    paymentOperationId: string;
    now: string;
  }): Promise<FinalizeCaptureResult>;
  finalizeFailedCapability(input: {
    capabilityId: string;
    paymentOperationId: string;
    now: string;
  }): Promise<void>;
  revokeMandate(input: {
    mandateId: string;
    principalId: string;
    now: string;
  }): Promise<MandateRevocationResult>;
}

export type StoredHttpResponse = {
  status: number;
  body: unknown;
};

export type IdempotencyExecution =
  | { kind: 'created'; response: StoredHttpResponse }
  | { kind: 'replayed'; response: StoredHttpResponse }
  | { kind: 'conflict' };

export interface IdempotencyStore {
  execute(
    scope: string,
    idempotencyKey: string,
    fingerprint: string,
    operation: () => Promise<StoredHttpResponse>,
  ): Promise<IdempotencyExecution>;
}

export type PaymentAuthorizationResult =
  | { kind: 'authorized'; authorizationId: string }
  | { kind: 'declined'; reasonCode?: string }
  | { kind: 'reconciliation_required'; authorizationId?: string; reasonCode?: string };

/**
 * A Vault status read is the recovery step after an uncertain authorization
 * or capture response. It is never exposed to a merchant as Vault state.
 */
export type PaymentAuthorizationStatusResult =
  | { kind: 'authorized'; authorizationId: string }
  | { kind: 'captured' }
  | { kind: 'declined'; reasonCode?: string }
  | { kind: 'failed'; reasonCode?: string }
  | { kind: 'voided'; reasonCode?: string }
  | { kind: 'reconciliation_required'; authorizationId: string; reasonCode?: string };

export type PaymentCaptureResult =
  | { kind: 'captured' }
  | { kind: 'failed'; reasonCode?: string }
  | { kind: 'reconciliation_required'; reasonCode?: string };

export type PaymentVoidResult =
  | { kind: 'voided' }
  | { kind: 'reconciliation_required'; reasonCode?: string };

/**
 * The local core sees an opaque payment method ID and an opaque authorization
 * ID only. The concrete HTTP adapter owns its service proof and calls the
 * isolated Payment Vault; it must never expose a Vault token to this service.
 */
export interface PaymentVaultClient {
  authorize(input: {
    paymentOperationId: string;
    paymentMethodId: string;
    amountMinor: number;
    currency: string;
    merchantReference: string;
    idempotencyKey: string;
  }): Promise<PaymentAuthorizationResult>;
  getAuthorizationStatus(input: {
    authorizationId: string;
    paymentOperationId: string;
  }): Promise<PaymentAuthorizationStatusResult>;
  capture(input: {
    authorizationId: string;
    paymentOperationId: string;
    idempotencyKey: string;
  }): Promise<PaymentCaptureResult>;
  void(input: {
    authorizationId: string;
    paymentOperationId: string;
    idempotencyKey: string;
  }): Promise<PaymentVoidResult>;
}

export type SigningKey = {
  keyId: string;
  privateJwk: JWK;
};

export type MandateApiOptions = {
  agentAuthenticator: AgentRequestAuthenticator;
  merchantAuthenticator: MerchantRequestAuthenticator;
  principalAuthenticator: PrincipalRequestAuthenticator;
  merchantRegistry: MerchantRegistry;
  merchantQuoteSource: MerchantQuoteSource;
  taxonomyNormalizer: TaxonomyNormalizer;
  stateStore: MandateStateStore;
  trustPolicyStore: MandateTrustPolicyStore;
  intentIdempotencyStore: IdempotencyStore;
  verificationIdempotencyStore: IdempotencyStore;
  paymentVault: PaymentVaultClient;
  capabilitySigningKey: SigningKey;
  capabilityVerificationKeys: ReadonlyMap<string, JWK>;
  receiptSigningKey: SigningKey;
  now: () => Date;
  idGenerator: (prefix: string) => string;
  capabilityTtlMs?: number;
};

export type MerchantVerificationOutcome = {
  decision: 'approved' | 'rejected';
  reasonCode: ReasonCode;
  settlementStatus?: SettlementStatus;
  paymentOperationId?: string;
};
