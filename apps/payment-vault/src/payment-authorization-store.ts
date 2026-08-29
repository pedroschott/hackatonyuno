import type { PaymentAuthorizationStatus } from './contracts.js';

export type VaultPaymentAuthorization = {
  id: string;
  operationId: string;
  paymentMethodId: string;
  amountMinor: number;
  currency: string;
  merchantReference: string;
  status: PaymentAuthorizationStatus;
  gatewayId?: 'card-gateway-a' | 'card-gateway-b';
  reasonCode?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreatePaymentAuthorizationInput = VaultPaymentAuthorization;

export type PaymentAuthorizationCreateResult =
  | { kind: 'created'; authorization: VaultPaymentAuthorization }
  | { kind: 'existing'; authorization: VaultPaymentAuthorization }
  | { kind: 'conflict' };

export type PaymentAuthorizationLockResult<T> =
  | { value: T; next: VaultPaymentAuthorization }
  | { value: T; next?: never };

export interface PaymentAuthorizationStore {
  create(input: CreatePaymentAuthorizationInput): Promise<PaymentAuthorizationCreateResult>;
  get(authorizationId: string): Promise<VaultPaymentAuthorization | undefined>;
  withAuthorizationLock<T>(
    authorizationId: string,
    operation: (
      current: VaultPaymentAuthorization | undefined,
    ) => Promise<PaymentAuthorizationLockResult<T>>,
  ): Promise<T>;
}

/**
 * Test adapter only. A production implementation must use a database lock on
 * the authorization and a unique operation_id constraint.
 */
export class InMemoryPaymentAuthorizationStore implements PaymentAuthorizationStore {
  private readonly authorizations = new Map<string, VaultPaymentAuthorization>();
  private readonly authorizationIdsByOperation = new Map<string, string>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(seed: readonly VaultPaymentAuthorization[] = []) {
    for (const authorization of seed) {
      if (this.authorizations.has(authorization.id)) {
        throw new Error(`Duplicate payment authorization id: ${authorization.id}`);
      }
      if (this.authorizationIdsByOperation.has(authorization.operationId)) {
        throw new Error(`Duplicate payment operation id: ${authorization.operationId}`);
      }
      this.authorizations.set(authorization.id, cloneAuthorization(authorization));
      this.authorizationIdsByOperation.set(authorization.operationId, authorization.id);
    }
  }

  async create(input: CreatePaymentAuthorizationInput): Promise<PaymentAuthorizationCreateResult> {
    return this.withKeyLock(`operation:${input.operationId}`, async () => {
      const existingId = this.authorizationIdsByOperation.get(input.operationId);
      if (existingId) {
        const existing = this.authorizations.get(existingId);
        if (!existing) {
          throw new Error('Payment authorization index is inconsistent.');
        }
        return sameAuthorizationRequest(existing, input)
          ? { kind: 'existing', authorization: cloneAuthorization(existing) }
          : { kind: 'conflict' };
      }

      if (this.authorizations.has(input.id)) {
        throw new Error(`Duplicate payment authorization id: ${input.id}`);
      }

      const stored = cloneAuthorization(input);
      this.authorizations.set(stored.id, stored);
      this.authorizationIdsByOperation.set(stored.operationId, stored.id);
      return { kind: 'created', authorization: cloneAuthorization(stored) };
    });
  }

  async get(authorizationId: string): Promise<VaultPaymentAuthorization | undefined> {
    const authorization = this.authorizations.get(authorizationId);
    return authorization ? cloneAuthorization(authorization) : undefined;
  }

  async withAuthorizationLock<T>(
    authorizationId: string,
    operation: (
      current: VaultPaymentAuthorization | undefined,
    ) => Promise<PaymentAuthorizationLockResult<T>>,
  ): Promise<T> {
    return this.withKeyLock(`authorization:${authorizationId}`, async () => {
      const current = this.authorizations.get(authorizationId);
      const outcome = await operation(current ? cloneAuthorization(current) : undefined);
      if (outcome.next) {
        if (outcome.next.id !== authorizationId) {
          throw new Error('A payment authorization lock cannot change the authorization id.');
        }
        this.authorizations.set(authorizationId, cloneAuthorization(outcome.next));
      }
      return outcome.value;
    });
  }

  private async withKeyLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.then(() => completion);
    this.locks.set(key, current);
    await previous;

    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === current) {
        this.locks.delete(key);
      }
    }
  }
}

export function toAuthorizationSummary(
  authorization: VaultPaymentAuthorization,
): Omit<VaultPaymentAuthorization, never> {
  const summary: VaultPaymentAuthorization = {
    id: authorization.id,
    operationId: authorization.operationId,
    paymentMethodId: authorization.paymentMethodId,
    amountMinor: authorization.amountMinor,
    currency: authorization.currency,
    merchantReference: authorization.merchantReference,
    status: authorization.status,
    createdAt: authorization.createdAt,
    updatedAt: authorization.updatedAt,
  };

  if (authorization.gatewayId) {
    summary.gatewayId = authorization.gatewayId;
  }
  if (authorization.reasonCode) {
    summary.reasonCode = authorization.reasonCode;
  }
  return summary;
}

function sameAuthorizationRequest(
  left: VaultPaymentAuthorization,
  right: CreatePaymentAuthorizationInput,
): boolean {
  return (
    left.paymentMethodId === right.paymentMethodId &&
    left.amountMinor === right.amountMinor &&
    left.currency === right.currency &&
    left.merchantReference === right.merchantReference
  );
}

function cloneAuthorization(
  authorization: VaultPaymentAuthorization,
): VaultPaymentAuthorization {
  return { ...authorization };
}
