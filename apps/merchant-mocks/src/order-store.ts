import { randomUUID } from 'node:crypto';

import type {
  VerificationResult,
} from '@agentic-mandates/contracts';
import type { MerchantOrderStatus } from './contracts.js';

export type MerchantOrder = {
  merchantId: string;
  merchantOrderRef: string;
  quoteId: string;
  status: MerchantOrderStatus;
  verification?: VerificationResult;
  createdAt: string;
  updatedAt: string;
};

/**
 * An opaque lease held while one request is asking the Mandate service for a
 * decision. It is intentionally merchant-private and never returned by an API
 * route. A durable adapter should persist this with a compare-and-set update.
 */
export type MerchantOrderVerificationClaim = {
  merchantId: string;
  merchantOrderRef: string;
  quoteId: string;
  idempotencyKey: string;
  claimId: string;
};

export type MerchantOrderVerificationClaimResult =
  | { kind: 'claimed'; claim: MerchantOrderVerificationClaim }
  | { kind: 'in_progress' }
  | { kind: 'terminal'; order: MerchantOrder };

export interface MerchantOrderStore {
  createQuoted(order: MerchantOrder): Promise<MerchantOrder>;
  claimVerification(input: {
    merchantId: string;
    merchantOrderRef: string;
    quoteId: string;
    idempotencyKey: string;
  }): Promise<MerchantOrderVerificationClaimResult>;
  completeVerification(
    claim: MerchantOrderVerificationClaim,
    verification: VerificationResult,
    completedAt: string,
  ): Promise<MerchantOrder>;
  abandonVerification(claim: MerchantOrderVerificationClaim): Promise<void>;
  get(merchantId: string, merchantOrderRef: string): Promise<MerchantOrder | undefined>;
}

/**
 * Merchant state deliberately stops at verification. Authorization, capture,
 * void, and all payment-method state remain outside this service.
 */
export class InMemoryMerchantOrderStore implements MerchantOrderStore {
  private readonly orders = new Map<string, StoredMerchantOrder>();

  constructor(
    private readonly claimIdGenerator: () => string = randomUUID,
  ) {}

  async createQuoted(order: MerchantOrder): Promise<MerchantOrder> {
    if (order.status !== 'quoted' || order.verification !== undefined) {
      throw new MerchantOrderConflictError('Only a quote can create a quoted order.');
    }

    const key = this.key(order.merchantId, order.merchantOrderRef);
    const existing = this.orders.get(key);

    if (existing) {
      if (existing.quoteId !== order.quoteId) {
        throw new MerchantOrderConflictError(
          'An order reference cannot be rebound to another quote.',
        );
      }

      return toPublicOrder(existing);
    }

    const snapshot = structuredClone(order);
    this.orders.set(key, snapshot);
    return structuredClone(snapshot);
  }

  /**
   * Claims the order before the remote Mandate call. This gives an adapter one
   * atomic boundary for preventing two distinct idempotency keys from asking
   * for (or later recording) competing verification decisions.
   */
  async claimVerification(input: {
    merchantId: string;
    merchantOrderRef: string;
    quoteId: string;
    idempotencyKey: string;
  }): Promise<MerchantOrderVerificationClaimResult> {
    const key = this.key(input.merchantId, input.merchantOrderRef);
    const existing = this.orders.get(key);

    if (!existing) {
      throw new MerchantOrderConflictError('A verification requires a previously quoted order.');
    }

    if (existing.quoteId !== input.quoteId) {
      throw new MerchantOrderConflictError(
        'An order reference cannot be rebound to another quote.',
      );
    }

    if (isTerminalVerification(existing)) {
      return { kind: 'terminal', order: toPublicOrder(existing) };
    }

    if (existing.verificationClaim) {
      return { kind: 'in_progress' };
    }

    const claim: MerchantOrderVerificationClaim = {
      merchantId: input.merchantId,
      merchantOrderRef: input.merchantOrderRef,
      quoteId: input.quoteId,
      idempotencyKey: input.idempotencyKey,
      claimId: `verify_claim_${this.claimIdGenerator()}`,
    };

    existing.verificationClaim = claim;
    return { kind: 'claimed', claim: structuredClone(claim) };
  }

  async completeVerification(
    claim: MerchantOrderVerificationClaim,
    verification: VerificationResult,
    completedAt: string,
  ): Promise<MerchantOrder> {
    const key = this.key(claim.merchantId, claim.merchantOrderRef);
    const existing = this.orders.get(key);

    if (!existing) {
      throw new MerchantOrderConflictError('A verification requires a previously quoted order.');
    }

    if (existing.quoteId !== claim.quoteId) {
      throw new MerchantOrderConflictError(
        'An order reference cannot be rebound to another quote.',
      );
    }

    if (!sameClaim(existing.verificationClaim, claim)) {
      throw new MerchantOrderConflictError(
        'The verification lease is no longer valid for this order.',
      );
    }

    const snapshot: StoredMerchantOrder = {
      ...existing,
      status: orderStatusForVerification(verification),
      verification: structuredClone(verification),
      updatedAt: completedAt,
    };
    delete snapshot.verificationClaim;
    this.orders.set(key, snapshot);
    return toPublicOrder(snapshot);
  }

  async abandonVerification(claim: MerchantOrderVerificationClaim): Promise<void> {
    const existing = this.orders.get(this.key(claim.merchantId, claim.merchantOrderRef));

    if (existing && sameClaim(existing.verificationClaim, claim)) {
      delete existing.verificationClaim;
    }
  }

  async get(merchantId: string, merchantOrderRef: string): Promise<MerchantOrder | undefined> {
    const order = this.orders.get(this.key(merchantId, merchantOrderRef));
    return order ? toPublicOrder(order) : undefined;
  }

  private key(merchantId: string, merchantOrderRef: string): string {
    return `${merchantId}:${merchantOrderRef}`;
  }
}

type StoredMerchantOrder = MerchantOrder & {
  verificationClaim?: MerchantOrderVerificationClaim;
};

function isTerminalVerification(order: MerchantOrder): boolean {
  return order.status === 'verification_approved' || order.status === 'verification_rejected';
}

/** A merchant may fulfill only after the Mandate receipt reports captured. */
function orderStatusForVerification(verification: VerificationResult): MerchantOrderStatus {
  switch (verification.decision) {
    case 'approved':
      return verification.settlementStatus === 'captured'
        ? 'verification_approved'
        : 'settlement_pending';
    case 'approval_required':
      return 'approval_required';
    case 'rejected':
      return 'verification_rejected';
    default:
      throw new TypeError('Unsupported verification decision.');
  }
}

function sameClaim(
  left: MerchantOrderVerificationClaim | undefined,
  right: MerchantOrderVerificationClaim,
): boolean {
  return Boolean(
    left
      && left.merchantId === right.merchantId
      && left.merchantOrderRef === right.merchantOrderRef
      && left.quoteId === right.quoteId
      && left.idempotencyKey === right.idempotencyKey
      && left.claimId === right.claimId,
  );
}

function toPublicOrder(order: StoredMerchantOrder): MerchantOrder {
  const { verificationClaim: _verificationClaim, ...publicOrder } = order;
  return structuredClone(publicOrder);
}

export class MerchantOrderConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MerchantOrderConflictError';
  }
}
