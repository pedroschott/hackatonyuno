import { randomUUID } from 'node:crypto';

import type {
  PaymentMethodSummary,
  TestPaymentMethodFixture,
} from './contracts.js';

type TestPaymentMethodDefinition = Omit<PaymentMethodSummary, 'id' | 'status'>;

const testPaymentMethodDefinitions: Readonly<Record<TestPaymentMethodFixture, TestPaymentMethodDefinition>> = {
  visa_4242: { brand: 'visa', last4: '4242' },
  mastercard_4444: { brand: 'mastercard', last4: '4444' },
};

/** Private Vault record. It must never be serialized by HTTP handlers. */
export type VaultPaymentMethod = PaymentMethodSummary & {
  fixture: TestPaymentMethodFixture;
  providerTokenRef: string;
  createdAt: string;
};

export interface PaymentMethodStore {
  createTestMethod(input: {
    fixture: TestPaymentMethodFixture;
    createdAt: string;
  }): Promise<VaultPaymentMethod>;
  get(paymentMethodId: string): Promise<VaultPaymentMethod | undefined>;
}

export class InMemoryPaymentMethodStore implements PaymentMethodStore {
  private readonly methods = new Map<string, VaultPaymentMethod>();

  constructor(
    private readonly options: {
      idGenerator?: () => string;
      seed?: readonly VaultPaymentMethod[];
    } = {},
  ) {
    for (const method of options.seed ?? []) {
      this.methods.set(method.id, clonePaymentMethod(method));
    }
  }

  async createTestMethod(input: {
    fixture: TestPaymentMethodFixture;
    createdAt: string;
  }): Promise<VaultPaymentMethod> {
    const definition = testPaymentMethodDefinitions[input.fixture];
    const id = createOpaqueId('pm_', this.options.idGenerator ?? randomUUID);
    const method: VaultPaymentMethod = {
      id,
      ...definition,
      status: 'active',
      fixture: input.fixture,
      providerTokenRef: createOpaqueId('provider_tok_', this.options.idGenerator ?? randomUUID),
      createdAt: input.createdAt,
    };
    this.methods.set(id, clonePaymentMethod(method));
    return clonePaymentMethod(method);
  }

  async get(paymentMethodId: string): Promise<VaultPaymentMethod | undefined> {
    const method = this.methods.get(paymentMethodId);
    return method ? clonePaymentMethod(method) : undefined;
  }
}

export function toPaymentMethodSummary(method: VaultPaymentMethod): PaymentMethodSummary {
  return {
    id: method.id,
    brand: method.brand,
    last4: method.last4,
    status: method.status,
  };
}

function createOpaqueId(prefix: string, idGenerator: () => string): string {
  return `${prefix}${idGenerator().replaceAll('-', '')}`;
}

function clonePaymentMethod(method: VaultPaymentMethod): VaultPaymentMethod {
  return { ...method };
}
