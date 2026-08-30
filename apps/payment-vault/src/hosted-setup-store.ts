import type { TestPaymentMethodFixture } from './contracts.js';
import { sha256Base64Url } from './canonical.js';
import type { VaultPaymentMethod } from './payment-method-store.js';

export type HostedSetupSessionStatus = 'pending' | 'completed' | 'exchanged' | 'expired';

export type HostedSetupSession = {
  id: string;
  returnUrl: string;
  status: HostedSetupSessionStatus;
  createdAt: string;
  expiresAt: string;
  paymentMethodId?: string;
  setupCodeHash?: string;
  completedAt?: string;
  exchangedAt?: string;
};

export type HostedSetupCompletionResult =
  | { kind: 'completed'; session: HostedSetupSession; setupCode: string }
  | { kind: 'not_found' }
  | { kind: 'expired'; session: HostedSetupSession }
  | { kind: 'not_pending'; session: HostedSetupSession };

export type HostedSetupExchangeResult =
  | { kind: 'exchanged'; session: HostedSetupSession; paymentMethodId: string }
  | { kind: 'not_found' }
  | { kind: 'expired'; session: HostedSetupSession }
  | { kind: 'not_completed'; session: HostedSetupSession }
  | { kind: 'already_exchanged'; session: HostedSetupSession }
  | { kind: 'invalid_code' };

export interface HostedSetupSessionStore {
  create(input: {
    id: string;
    returnUrl: string;
    createdAt: string;
    expiresAt: string;
  }): Promise<HostedSetupSession>;
  get(input: { sessionId: string; now: Date }): Promise<HostedSetupSession | undefined>;
  complete(input: {
    sessionId: string;
    fixture: TestPaymentMethodFixture;
    now: Date;
    setupCode: string;
    createPaymentMethod: () => Promise<VaultPaymentMethod>;
  }): Promise<HostedSetupCompletionResult>;
  exchange(input: {
    sessionId: string;
    setupCode: string;
    now: Date;
  }): Promise<HostedSetupExchangeResult>;
}

/**
 * Test adapter only. A production Vault persists sessions and their code hash
 * in its private schema under a row lock.
 */
export class InMemoryHostedSetupSessionStore implements HostedSetupSessionStore {
  private readonly sessions = new Map<string, HostedSetupSession>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(seed: readonly HostedSetupSession[] = []) {
    for (const session of seed) {
      if (this.sessions.has(session.id)) {
        throw new Error(`Duplicate hosted setup session id: ${session.id}`);
      }
      this.sessions.set(session.id, cloneSession(session));
    }
  }

  async create(input: {
    id: string;
    returnUrl: string;
    createdAt: string;
    expiresAt: string;
  }): Promise<HostedSetupSession> {
    return this.withKeyLock(`session:${input.id}`, async () => {
      if (this.sessions.has(input.id)) {
        throw new Error(`Duplicate hosted setup session id: ${input.id}`);
      }
      const session: HostedSetupSession = {
        id: input.id,
        returnUrl: input.returnUrl,
        status: 'pending',
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      };
      this.sessions.set(session.id, session);
      return cloneSession(session);
    });
  }

  async get(input: {
    sessionId: string;
    now: Date;
  }): Promise<HostedSetupSession | undefined> {
    return this.withKeyLock(`session:${input.sessionId}`, async () => {
      const session = this.sessions.get(input.sessionId);
      if (!session) {
        return undefined;
      }
      const current = expireSessionIfNeeded(session, input.now);
      this.sessions.set(current.id, current);
      return cloneSession(current);
    });
  }

  async complete(input: {
    sessionId: string;
    fixture: TestPaymentMethodFixture;
    now: Date;
    setupCode: string;
    createPaymentMethod: () => Promise<VaultPaymentMethod>;
  }): Promise<HostedSetupCompletionResult> {
    return this.withKeyLock(`session:${input.sessionId}`, async () => {
      const stored = this.sessions.get(input.sessionId);
      if (!stored) {
        return { kind: 'not_found' };
      }
      const session = expireSessionIfNeeded(stored, input.now);
      if (session.status === 'expired') {
        this.sessions.set(session.id, session);
        return { kind: 'expired', session: cloneSession(session) };
      }
      if (session.status !== 'pending') {
        return { kind: 'not_pending', session: cloneSession(session) };
      }

      const paymentMethod = await input.createPaymentMethod();
      const completed: HostedSetupSession = {
        ...session,
        status: 'completed',
        paymentMethodId: paymentMethod.id,
        setupCodeHash: sha256Base64Url(input.setupCode),
        completedAt: input.now.toISOString(),
      };
      this.sessions.set(completed.id, completed);
      return {
        kind: 'completed',
        session: cloneSession(completed),
        setupCode: input.setupCode,
      };
    });
  }

  async exchange(input: {
    sessionId: string;
    setupCode: string;
    now: Date;
  }): Promise<HostedSetupExchangeResult> {
    return this.withKeyLock(`session:${input.sessionId}`, async () => {
      const stored = this.sessions.get(input.sessionId);
      if (!stored) {
        return { kind: 'not_found' };
      }
      const session = expireSessionIfNeeded(stored, input.now);
      if (session.status === 'expired') {
        this.sessions.set(session.id, session);
        return { kind: 'expired', session: cloneSession(session) };
      }
      if (session.status === 'pending') {
        return { kind: 'not_completed', session: cloneSession(session) };
      }
      if (session.status === 'exchanged') {
        return { kind: 'already_exchanged', session: cloneSession(session) };
      }
      const paymentMethodId = session.paymentMethodId;
      if (
        !paymentMethodId ||
        !session.setupCodeHash ||
        session.setupCodeHash !== sha256Base64Url(input.setupCode)
      ) {
        return { kind: 'invalid_code' };
      }

      const exchanged: HostedSetupSession = {
        ...session,
        status: 'exchanged',
        exchangedAt: input.now.toISOString(),
      };
      this.sessions.set(exchanged.id, exchanged);
      return {
        kind: 'exchanged',
        session: cloneSession(exchanged),
        paymentMethodId,
      };
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

function expireSessionIfNeeded(session: HostedSetupSession, now: Date): HostedSetupSession {
  if (session.status === 'pending' || session.status === 'completed') {
    if (Date.parse(session.expiresAt) <= now.getTime()) {
      const { paymentMethodId: _paymentMethodId, setupCodeHash: _setupCodeHash, ...rest } = session;
      return { ...rest, status: 'expired' };
    }
  }
  return session;
}

function cloneSession(session: HostedSetupSession): HostedSetupSession {
  return { ...session };
}
