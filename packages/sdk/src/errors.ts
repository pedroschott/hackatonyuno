import type { ReasonCode } from '@agentic-mandates/contracts';

export type SdkErrorCode = ReasonCode | 'RESPONSE_SCHEMA_INVALID';

export type AgentPayClientErrorOptions = {
  status?: number | undefined;
  requestId?: string | undefined;
  retryAfterSeconds?: number | undefined;
  cause?: unknown;
};

/**
 * A predictable client error. Server-originated failures always preserve the
 * API's stable reason code, so integrations must not branch on text messages.
 */
export class AgentPayClientError extends Error {
  readonly code: SdkErrorCode;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly originalCause: unknown;

  constructor(
    code: SdkErrorCode,
    message: string,
    options: AgentPayClientErrorOptions = {},
  ) {
    super(message);
    this.name = 'AgentPayClientError';
    this.code = code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.originalCause = options.cause;
  }
}

/** A server-declared error with a validated Agentic Mandates reason code. */
export class AgentPayApiError extends AgentPayClientError {
  constructor(
    code: ReasonCode,
    message: string,
    options: AgentPayClientErrorOptions,
  ) {
    super(code, message, options);
    this.name = 'AgentPayApiError';
  }
}

export function isAgentPayClientError(error: unknown): error is AgentPayClientError {
  return error instanceof AgentPayClientError;
}
