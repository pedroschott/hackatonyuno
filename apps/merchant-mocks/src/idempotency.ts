import { canonicalJson } from './canonical.js';

export type StoredResponse = {
  status: 200 | 201 | 202 | 403 | 409 | 410 | 422 | 500 | 503;
  body: unknown;
};

export type IdempotencyExecution =
  | { kind: 'new'; response: StoredResponse }
  | { kind: 'replay'; response: StoredResponse }
  | { kind: 'conflict' };

export interface IdempotencyStore {
  execute(
    scope: string,
    idempotencyKey: string,
    fingerprint: string,
    operation: () => Promise<StoredResponse>,
  ): Promise<IdempotencyExecution>;
}

/**
 * The pending promise makes same-key concurrent retries share one operation.
 * A production implementation belongs in the Mandate/merchant database with a
 * unique constraint; this in-memory implementation makes the behavior testable.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();

  async execute(
    scope: string,
    idempotencyKey: string,
    fingerprint: string,
    operation: () => Promise<StoredResponse>,
  ): Promise<IdempotencyExecution> {
    const key = canonicalJson([scope, idempotencyKey]);
    const existing = this.entries.get(key);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return { kind: 'conflict' };
      }

      return {
        kind: 'replay',
        response: cloneStoredResponse(await existing.result),
      };
    }

    let resolveResult: (response: StoredResponse) => void;
    const result = new Promise<StoredResponse>((resolve) => {
      resolveResult = resolve;
    });
    this.entries.set(key, { fingerprint, result });

    try {
      const response = cloneStoredResponse(await operation());
      resolveResult!(response);
      return { kind: 'new', response: cloneStoredResponse(response) };
    } catch (error) {
      this.entries.delete(key);
      resolveResult!({
        status: 500,
        body: { error: 'idempotency operation failed before a response was stored' },
      });
      throw error;
    }
  }
}

type IdempotencyEntry = {
  fingerprint: string;
  result: Promise<StoredResponse>;
};

function cloneStoredResponse(response: StoredResponse): StoredResponse {
  return structuredClone(response);
}
