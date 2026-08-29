import type {
  Mandate,
  PolicyUsageSnapshot,
} from '@agentic-mandates/contracts';
import { sumMinorAmounts } from '@agentic-mandates/domain';

import { statusReason } from './policy.js';
import type {
  BeginCaptureResult,
  CapabilityClaimResult,
  CapabilityIssueInput,
  CapabilityIssueResult,
  FinalizeCaptureResult,
  IdempotencyExecution,
  IdempotencyStore,
  MandateTrustConstraint,
  MandateTrustPolicyStore,
  MandateRevocationResult,
  MandateStateStore,
  RecordPendingAuthorizationResult,
  StoredCapability,
  StoredHttpResponse,
} from './types.js';

/** In-memory contract-extension policy store for tests and demo fixtures only. */
export class InMemoryMandateTrustPolicyStore implements MandateTrustPolicyStore {
  constructor(
    private readonly constraints: ReadonlyMap<string, MandateTrustConstraint> = new Map(),
  ) {}

  async get(input: {
    mandateId: string;
    mandateVersion: number;
  }): Promise<MandateTrustConstraint | undefined> {
    const constraint = this.constraints.get(`${input.mandateId}:${input.mandateVersion}`);
    return constraint ? clone(constraint) : undefined;
  }
}

/**
 * Deterministic in-memory adapters for tests and the demo harness only. A
 * deployed adapter must implement each mutation in a single local database
 * transaction, including the mandate row, usage counters, and capability row.
 */
export class InMemoryMandateStateStore implements MandateStateStore {
  private readonly mandates = new Map<string, Mandate>();
  private readonly usageByMandate = new Map<string, PolicyUsageSnapshot>();
  private readonly capabilities = new Map<string, StoredCapability>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(options: {
    mandates: readonly Mandate[];
    usageByMandate?: ReadonlyMap<string, PolicyUsageSnapshot>;
    capabilities?: readonly StoredCapability[];
  }) {
    for (const mandate of options.mandates) {
      if (this.mandates.has(mandate.id)) {
        throw new Error(`Duplicate mandate id: ${mandate.id}`);
      }
      this.mandates.set(mandate.id, clone(mandate));
      const usage = options.usageByMandate?.get(mandate.id) ?? {
        capturedAmountMinor: 0,
        capturedUses: 0,
      };
      this.usageByMandate.set(mandate.id, clone(usage));
    }

    for (const capability of options.capabilities ?? []) {
      if (this.capabilities.has(capability.payload.id)) {
        throw new Error(`Duplicate capability id: ${capability.payload.id}`);
      }
      this.capabilities.set(capability.payload.id, clone(capability));
    }
  }

  async getMandate(mandateId: string): Promise<Mandate | undefined> {
    const mandate = this.mandates.get(mandateId);
    return mandate ? clone(mandate) : undefined;
  }

  async getUsage(mandateId: string): Promise<PolicyUsageSnapshot> {
    const usage = this.usageByMandate.get(mandateId) ?? {
      capturedAmountMinor: 0,
      capturedUses: 0,
    };
    return clone(usage);
  }

  async getCapability(input: {
    capabilityId: string;
    capabilityHash: string;
  }): Promise<StoredCapability | undefined> {
    const capability = this.capabilities.get(input.capabilityId);
    if (!capability || capability.capabilityHash !== input.capabilityHash) {
      return undefined;
    }
    return clone(capability);
  }

  async issueCapability(input: CapabilityIssueInput): Promise<CapabilityIssueResult> {
    return this.withMandateLock(input.capability.payload.mandateId, async () => {
      const mandate = this.mandates.get(input.capability.payload.mandateId);
      if (!mandate) {
        return { ok: false, reasonCode: 'MANDATE_NOT_FOUND' };
      }

      const statusFailure = statusReason(mandate, new Date(input.now));
      if (statusFailure) {
        return { ok: false, reasonCode: statusFailure };
      }
      if (
        mandate.version !== input.expectedMandateVersion ||
        mandate.id !== input.capability.payload.mandateId ||
        mandate.version !== input.capability.payload.mandateVersion
      ) {
        return { ok: false, reasonCode: 'MANDATE_INACTIVE' };
      }
      if (Date.parse(input.capability.payload.expiresAt) <= Date.parse(input.now)) {
        return { ok: false, reasonCode: 'MANDATE_INACTIVE' };
      }

      this.expireOutstandingCapabilities(mandate.id, input.now);
      if (this.hasOutstandingCapability(mandate.id)) {
        return { ok: false, reasonCode: 'VERIFICATION_IN_PROGRESS' };
      }
      if (this.capabilities.has(input.capability.payload.id)) {
        return { ok: false, reasonCode: 'VERIFICATION_IN_PROGRESS' };
      }

      this.capabilities.set(input.capability.payload.id, clone(input.capability));
      return {
        ok: true,
        mandate: clone(mandate),
        usage: clone(
          this.usageByMandate.get(mandate.id) ?? {
            capturedAmountMinor: 0,
            capturedUses: 0,
          },
        ),
      };
    });
  }

  async claimCapability(input: {
    capabilityId: string;
    capabilityHash: string;
    paymentOperationId: string;
    now: string;
  }): Promise<CapabilityClaimResult> {
    const discovered = this.capabilities.get(input.capabilityId);
    if (!discovered) {
      return { ok: false, reasonCode: 'CAPABILITY_INVALID' };
    }

    return this.withMandateLock(discovered.payload.mandateId, async () => {
      const capability = this.capabilities.get(input.capabilityId);
      if (!capability || capability.capabilityHash !== input.capabilityHash) {
        return { ok: false, reasonCode: 'CAPABILITY_INVALID' };
      }
      const mandate = this.mandates.get(capability.payload.mandateId);
      if (!mandate) {
        return { ok: false, reasonCode: 'MANDATE_NOT_FOUND' };
      }

      const statusFailure = statusReason(mandate, new Date(input.now));
      if (statusFailure) {
        return { ok: false, reasonCode: statusFailure };
      }
      if (capability.payload.mandateVersion !== mandate.version) {
        return { ok: false, reasonCode: 'CAPABILITY_INVALID' };
      }
      if (Date.parse(capability.payload.expiresAt) <= Date.parse(input.now)) {
        capability.status = 'expired';
        this.capabilities.set(capability.payload.id, capability);
        return { ok: false, reasonCode: 'CAPABILITY_EXPIRED' };
      }
      if (capability.status === 'voided') {
        return { ok: false, reasonCode: 'CAPABILITY_REVOKED' };
      }
      if (capability.status !== 'issued') {
        return { ok: false, reasonCode: 'CAPABILITY_REPLAYED' };
      }

      const claimed: StoredCapability = {
        ...capability,
        status: 'authorized',
        paymentOperationId: input.paymentOperationId,
      };
      this.capabilities.set(claimed.payload.id, claimed);
      return { ok: true, mandate: clone(mandate), capability: clone(claimed) };
    });
  }

  async recordPendingAuthorization(input: {
    capabilityId: string;
    capabilityHash: string;
    paymentOperationId: string;
    authorizationId: string;
    now: string;
  }): Promise<RecordPendingAuthorizationResult> {
    const discovered = this.capabilities.get(input.capabilityId);
    if (!discovered) {
      return { ok: false, reasonCode: 'CAPABILITY_INVALID' };
    }

    return this.withMandateLock(discovered.payload.mandateId, async () => {
      const capability = this.capabilities.get(input.capabilityId);
      if (
        !capability
        || capability.capabilityHash !== input.capabilityHash
        || capability.paymentOperationId !== input.paymentOperationId
      ) {
        return { ok: false, reasonCode: 'CAPABILITY_INVALID' };
      }
      const mandate = this.mandates.get(capability.payload.mandateId);
      if (!mandate) {
        return { ok: false, reasonCode: 'MANDATE_NOT_FOUND' };
      }
      const statusFailure = statusReason(mandate, new Date(input.now));
      if (statusFailure) {
        this.voidCapability(capability, input.now);
        return { ok: false, reasonCode: statusFailure };
      }
      if (capability.status !== 'authorized') {
        return { ok: false, reasonCode: 'CAPABILITY_REPLAYED' };
      }
      if (capability.authorizationId && capability.authorizationId !== input.authorizationId) {
        return { ok: false, reasonCode: 'CAPABILITY_REPLAYED' };
      }

      const recorded: StoredCapability = {
        ...capability,
        authorizationId: input.authorizationId,
      };
      this.capabilities.set(recorded.payload.id, recorded);
      return { ok: true, mandate: clone(mandate), capability: clone(recorded) };
    });
  }

  async beginCapture(input: {
    capabilityId: string;
    paymentOperationId: string;
    authorizationId: string;
    now: string;
  }): Promise<BeginCaptureResult> {
    const discovered = this.capabilities.get(input.capabilityId);
    if (!discovered) {
      return { ok: false, reasonCode: 'CAPABILITY_INVALID' };
    }

    return this.withMandateLock(discovered.payload.mandateId, async () => {
      const capability = this.capabilities.get(input.capabilityId);
      if (!capability || capability.paymentOperationId !== input.paymentOperationId) {
        return { ok: false, reasonCode: 'CAPABILITY_INVALID' };
      }
      const mandate = this.mandates.get(capability.payload.mandateId);
      if (!mandate) {
        return { ok: false, reasonCode: 'MANDATE_NOT_FOUND' };
      }
      const statusFailure = statusReason(mandate, new Date(input.now));
      if (statusFailure) {
        this.voidCapability(capability, input.now);
        return { ok: false, reasonCode: statusFailure };
      }
      if (capability.status !== 'authorized') {
        return { ok: false, reasonCode: 'CAPABILITY_REPLAYED' };
      }
      if (capability.captureStartedAt) {
        return { ok: false, reasonCode: 'CAPABILITY_REPLAYED' };
      }

      const captureStarted: StoredCapability = {
        ...capability,
        authorizationId: input.authorizationId,
        captureStartedAt: input.now,
      };
      this.capabilities.set(captureStarted.payload.id, captureStarted);
      return { ok: true, mandate: clone(mandate), capability: clone(captureStarted) };
    });
  }

  async finalizeCapturedCapability(input: {
    capabilityId: string;
    paymentOperationId: string;
    now: string;
  }): Promise<FinalizeCaptureResult> {
    const discovered = this.capabilities.get(input.capabilityId);
    if (!discovered) {
      return { ok: false, reasonCode: 'CAPABILITY_INVALID' };
    }

    return this.withMandateLock(discovered.payload.mandateId, async () => {
      const capability = this.capabilities.get(input.capabilityId);
      if (!capability || capability.paymentOperationId !== input.paymentOperationId) {
        return { ok: false, reasonCode: 'CAPABILITY_INVALID' };
      }
      const mandate = this.mandates.get(capability.payload.mandateId);
      if (!mandate) {
        return { ok: false, reasonCode: 'MANDATE_NOT_FOUND' };
      }
      // A confirmed Vault status may arrive after a network timeout. In that
      // case the gateway is authoritative even if this process did not record
      // the local capture start before losing the response.
      if (capability.status !== 'authorized' || !capability.authorizationId) {
        return { ok: false, reasonCode: 'CAPABILITY_REPLAYED' };
      }

      /*
       * If capture began before revocation committed, a confirmed gateway
       * capture remains a post-capture event. The caller records it and the
       * principal flow may open a dispute/refund; it must not pretend a debit
       * can be undone locally.
       */
      const usage = this.usageByMandate.get(mandate.id) ?? {
        capturedAmountMinor: 0,
        capturedUses: 0,
      };
      const capturedUsage: PolicyUsageSnapshot = {
        capturedAmountMinor: sumMinorAmounts(
          usage.capturedAmountMinor,
          capability.payload.maxAmountMinor,
        ),
        capturedUses: usage.capturedUses + 1,
      };
      const consumed: StoredCapability = {
        ...capability,
        status: 'consumed',
        consumedAt: input.now,
      };
      this.usageByMandate.set(mandate.id, capturedUsage);
      this.capabilities.set(consumed.payload.id, consumed);
      return { ok: true, mandate: clone(mandate), capability: clone(consumed) };
    });
  }

  async finalizeFailedCapability(input: {
    capabilityId: string;
    paymentOperationId: string;
    now: string;
  }): Promise<void> {
    const discovered = this.capabilities.get(input.capabilityId);
    if (!discovered) {
      return;
    }

    await this.withMandateLock(discovered.payload.mandateId, async () => {
      const capability = this.capabilities.get(input.capabilityId);
      if (!capability || capability.paymentOperationId !== input.paymentOperationId) {
        return;
      }
      if (capability.status === 'consumed') {
        return;
      }
      this.voidCapability(capability, input.now);
    });
  }

  async revokeMandate(input: {
    mandateId: string;
    principalId: string;
    now: string;
  }): Promise<MandateRevocationResult> {
    return this.withMandateLock(input.mandateId, async () => {
      const mandate = this.mandates.get(input.mandateId);
      if (!mandate) {
        return { ok: false, reasonCode: 'MANDATE_NOT_FOUND' };
      }
      if (mandate.principalId !== input.principalId) {
        return { ok: false, reasonCode: 'ACTOR_NOT_ALLOWED' };
      }
      const revoked: Mandate = mandate.status === 'revoked'
        ? mandate
        : {
            ...mandate,
            status: 'revoked',
            revokedAt: input.now,
          };
      this.mandates.set(revoked.id, revoked);
      const authorizationsToVoid: Array<{
        authorizationId: string;
        paymentOperationId: string;
      }> = [];
      for (const capability of this.capabilities.values()) {
        if (capability.payload.mandateId !== revoked.id) {
          continue;
        }
        if (capability.status === 'issued') {
          this.voidCapability(capability, input.now);
          continue;
        }
        if (
          (capability.status === 'authorized' && !capability.captureStartedAt) ||
          capability.status === 'voided'
        ) {
          if (capability.status !== 'voided') {
            this.voidCapability(capability, input.now);
          }
          if (capability.authorizationId && capability.paymentOperationId) {
            authorizationsToVoid.push({
              authorizationId: capability.authorizationId,
              paymentOperationId: capability.paymentOperationId,
            });
          }
        }
      }
      return { ok: true, mandate: clone(revoked), authorizationsToVoid };
    });
  }

  private expireOutstandingCapabilities(mandateId: string, now: string): void {
    const nowMilliseconds = Date.parse(now);
    for (const capability of this.capabilities.values()) {
      if (
        capability.payload.mandateId === mandateId &&
        capability.status === 'issued' &&
        Date.parse(capability.payload.expiresAt) <= nowMilliseconds
      ) {
        capability.status = 'expired';
        this.capabilities.set(capability.payload.id, capability);
      }
    }
  }

  private hasOutstandingCapability(mandateId: string): boolean {
    return [...this.capabilities.values()].some(
      (capability) =>
        capability.payload.mandateId === mandateId &&
        (capability.status === 'issued' || capability.status === 'authorized'),
    );
  }

  private voidCapability(capability: StoredCapability, now: string): void {
    this.capabilities.set(capability.payload.id, {
      ...capability,
      status: 'voided',
      voidedAt: now,
    });
  }

  private async withMandateLock<T>(mandateId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(mandateId) ?? Promise.resolve();
    let release!: () => void;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.then(() => completion);
    this.locks.set(mandateId, current);
    await previous;

    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(mandateId) === current) {
        this.locks.delete(mandateId);
      }
    }
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<
    string,
    {
      fingerprint: string;
      response?: StoredHttpResponse;
      pending?: Promise<StoredHttpResponse>;
    }
  >();

  async execute(
    scope: string,
    idempotencyKey: string,
    fingerprint: string,
    operation: () => Promise<StoredHttpResponse>,
  ): Promise<IdempotencyExecution> {
    const mapKey = `${scope}:${idempotencyKey}`;
    const existing = this.entries.get(mapKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return { kind: 'conflict' };
      }
      if (existing.response) {
        return { kind: 'replayed', response: clone(existing.response) };
      }
      if (existing.pending) {
        return { kind: 'replayed', response: clone(await existing.pending) };
      }
    }

    const entry: {
      fingerprint: string;
      response?: StoredHttpResponse;
      pending?: Promise<StoredHttpResponse>;
    } = { fingerprint };
    const pending = operation();
    entry.pending = pending;
    this.entries.set(mapKey, entry);

    try {
      const response = await pending;
      entry.response = clone(response);
      delete entry.pending;
      return { kind: 'created', response: clone(response) };
    } catch (error) {
      if (this.entries.get(mapKey) === entry) {
        this.entries.delete(mapKey);
      }
      throw error;
    }
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
