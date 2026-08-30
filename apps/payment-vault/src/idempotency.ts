export type StoredResponseStatus =
  | 200
  | 201
  | 202
  | 400
  | 401
  | 404
  | 409
  | 410
  | 413
  | 422
  | 500
  | 502
  | 503;

export type StoredResponse = {
  status: StoredResponseStatus;
  body: unknown;
};

export type IdempotencyExecution =
  | { kind: 'created'; response: StoredResponse }
  | { kind: 'replayed'; response: StoredResponse }
  | { kind: 'conflict' };

export interface VaultIdempotencyStore {
  execute(
    scope: string,
    idempotencyKey: string,
    fingerprint: string,
    operation: () => Promise<StoredResponse>,
  ): Promise<IdempotencyExecution>;
}

type IdempotencyEntry = {
  fingerprint: string;
  response?: StoredResponse;
  pending?: Promise<StoredResponse>;
};

/**
 * Test adapter only. A runtime adapter must persist keys with a unique
 * constraint scoped to the service actor and endpoint.
 */
export class InMemoryVaultIdempotencyStore implements VaultIdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();

  async execute(
    scope: string,
    idempotencyKey: string,
    fingerprint: string,
    operation: () => Promise<StoredResponse>,
  ): Promise<IdempotencyExecution> {
    const mapKey = `${scope}:${idempotencyKey}`;
    const existing = this.entries.get(mapKey);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return { kind: 'conflict' };
      }

      if (existing.response) {
        return { kind: 'replayed', response: cloneStoredResponse(existing.response) };
      }

      if (existing.pending) {
        const response = await existing.pending;
        return { kind: 'replayed', response: cloneStoredResponse(response) };
      }
    }

    const entry: IdempotencyEntry = { fingerprint };
    const pending = operation();
    entry.pending = pending;
    this.entries.set(mapKey, entry);

    try {
      const response = await pending;
      entry.response = cloneStoredResponse(response);
      delete entry.pending;
      return { kind: 'created', response: cloneStoredResponse(response) };
    } catch (error) {
      if (this.entries.get(mapKey) === entry) {
        this.entries.delete(mapKey);
      }
      throw error;
    }
  }
}

function cloneStoredResponse(response: StoredResponse): StoredResponse {
  return {
    status: response.status,
    body: structuredClone(response.body),
  };
}
