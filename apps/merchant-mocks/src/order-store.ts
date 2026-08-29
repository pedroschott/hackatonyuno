import type {
  MerchantOrderStatus,
  VerificationResult,
} from './contracts.js';

export type MerchantOrder = {
  merchantId: string;
  merchantOrderRef: string;
  quoteId: string;
  status: MerchantOrderStatus;
  verification?: VerificationResult;
  createdAt: string;
  updatedAt: string;
};

export interface MerchantOrderStore {
  createQuoted(order: MerchantOrder): MerchantOrder;
  recordVerification(order: MerchantOrder): MerchantOrder;
  get(merchantId: string, merchantOrderRef: string): MerchantOrder | undefined;
}

/**
 * Merchant state deliberately stops at verification. Authorization, capture,
 * void, and all payment-method state remain outside this service.
 */
export class InMemoryMerchantOrderStore implements MerchantOrderStore {
  private readonly orders = new Map<string, MerchantOrder>();

  createQuoted(order: MerchantOrder): MerchantOrder {
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

      return structuredClone(existing);
    }

    const snapshot = structuredClone(order);
    this.orders.set(key, snapshot);
    return structuredClone(snapshot);
  }

  recordVerification(order: MerchantOrder): MerchantOrder {
    const key = this.key(order.merchantId, order.merchantOrderRef);
    const existing = this.orders.get(key);

    if (!existing) {
      throw new MerchantOrderConflictError('A verification requires a previously quoted order.');
    }

    if (existing.quoteId !== order.quoteId) {
      throw new MerchantOrderConflictError(
        'An order reference cannot be rebound to another quote.',
      );
    }

    const snapshot = structuredClone({
      ...order,
      createdAt: existing.createdAt,
    });
    this.orders.set(key, snapshot);
    return structuredClone(snapshot);
  }

  get(merchantId: string, merchantOrderRef: string): MerchantOrder | undefined {
    const order = this.orders.get(this.key(merchantId, merchantOrderRef));
    return order ? structuredClone(order) : undefined;
  }

  private key(merchantId: string, merchantOrderRef: string): string {
    return `${merchantId}:${merchantOrderRef}`;
  }
}

export class MerchantOrderConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MerchantOrderConflictError';
  }
}
