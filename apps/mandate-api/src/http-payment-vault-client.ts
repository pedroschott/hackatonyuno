import { z } from 'zod';

import { canonicalServiceRequestUrl, type ServiceRequestProofSigner } from './service-request-proof.js';
import type {
  PaymentAuthorizationResult,
  PaymentAuthorizationStatusResult,
  PaymentCaptureResult,
  PaymentVaultClient,
  PaymentVoidResult,
} from './types.js';

export const PAYMENT_VAULT_AUDIENCE = 'payment-vault';

const PaymentAuthorizationStatusSchema = z.enum([
  'authorization_pending',
  'authorized',
  'declined',
  'reconciliation_required',
  'capture_pending',
  'captured',
  'void_pending',
  'voided',
  'failed',
]);

const PaymentAuthorizationSummarySchema = z
  .object({
    id: z.string().min(1).max(160),
    operationId: z.string().min(1).max(128),
    paymentMethodId: z.string().min(1).max(160),
    amountMinor: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    merchantReference: z.string().min(1).max(160),
    status: PaymentAuthorizationStatusSchema,
    gatewayId: z.string().min(1).max(80).optional(),
    reasonCode: z.string().min(1).max(80).optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

const PaymentAuthorizationResponseSchema = z
  .object({ paymentAuthorization: PaymentAuthorizationSummarySchema })
  .strict();

type PaymentAuthorizationSummary = z.infer<typeof PaymentAuthorizationSummarySchema>;

export type HttpPaymentVaultClientOptions = {
  baseUrl: string;
  requestProofSigner: ServiceRequestProofSigner;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

/**
 * The only bridge from the Mandate service into the isolated payment Vault.
 * It accepts and returns opaque identifiers only. Strict response parsing
 * fails closed if a Vault implementation ever adds provider-token or card
 * material to this boundary.
 */
export class HttpPaymentVaultClient implements PaymentVaultClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpPaymentVaultClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    if (!options.requestProofSigner) {
      throw new TypeError('HttpPaymentVaultClient requires a service request proof signer.');
    }
    if (typeof (options.fetch ?? globalThis.fetch) !== 'function') {
      throw new TypeError('HttpPaymentVaultClient requires a Fetch implementation.');
    }
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.timeoutMs = validateTimeout(options.timeoutMs);
  }

  async authorize(input: {
    paymentOperationId: string;
    paymentMethodId: string;
    amountMinor: number;
    currency: string;
    merchantReference: string;
    idempotencyKey: string;
  }): Promise<PaymentAuthorizationResult> {
    const summary = await this.requestAuthorization({
      method: 'POST',
      path: 'internal/v1/payment-authorizations',
      body: {
        operationId: input.paymentOperationId,
        paymentMethodId: input.paymentMethodId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        merchantReference: input.merchantReference,
      },
      idempotencyKey: input.idempotencyKey,
    });
    assertAuthorizationBinding(summary, input);

    switch (summary.status) {
      case 'authorized':
        return { kind: 'authorized', authorizationId: summary.id };
      case 'declined':
        return summary.reasonCode === undefined
          ? { kind: 'declined' }
          : { kind: 'declined', reasonCode: summary.reasonCode };
      default:
        return summary.reasonCode === undefined
          ? { kind: 'reconciliation_required', authorizationId: summary.id }
          : {
              kind: 'reconciliation_required',
              authorizationId: summary.id,
              reasonCode: summary.reasonCode,
            };
    }
  }

  async getAuthorizationStatus(input: {
    authorizationId: string;
    paymentOperationId: string;
  }): Promise<PaymentAuthorizationStatusResult> {
    const summary = await this.requestAuthorization({
      method: 'GET',
      path: `internal/v1/payment-authorizations/${encodeURIComponent(input.authorizationId)}`,
    });
    assertOperationBinding(summary, input);

    switch (summary.status) {
      case 'authorized':
        return { kind: 'authorized', authorizationId: summary.id };
      case 'captured':
        return { kind: 'captured' };
      case 'declined':
        return summary.reasonCode === undefined
          ? { kind: 'declined' }
          : { kind: 'declined', reasonCode: summary.reasonCode };
      case 'failed':
        return summary.reasonCode === undefined
          ? { kind: 'failed' }
          : { kind: 'failed', reasonCode: summary.reasonCode };
      case 'voided':
        return summary.reasonCode === undefined
          ? { kind: 'voided' }
          : { kind: 'voided', reasonCode: summary.reasonCode };
      default:
        return summary.reasonCode === undefined
          ? { kind: 'reconciliation_required', authorizationId: summary.id }
          : {
              kind: 'reconciliation_required',
              authorizationId: summary.id,
              reasonCode: summary.reasonCode,
            };
    }
  }

  async capture(input: {
    authorizationId: string;
    paymentOperationId: string;
    idempotencyKey: string;
  }): Promise<PaymentCaptureResult> {
    const summary = await this.requestAuthorization({
      method: 'POST',
      path: `internal/v1/payment-authorizations/${encodeURIComponent(input.authorizationId)}/capture`,
      body: {},
      idempotencyKey: input.idempotencyKey,
    });
    assertOperationBinding(summary, input);

    switch (summary.status) {
      case 'captured':
        return { kind: 'captured' };
      case 'failed':
        return summary.reasonCode === undefined
          ? { kind: 'failed' }
          : { kind: 'failed', reasonCode: summary.reasonCode };
      default:
        return summary.reasonCode === undefined
          ? { kind: 'reconciliation_required' }
          : { kind: 'reconciliation_required', reasonCode: summary.reasonCode };
    }
  }

  async void(input: {
    authorizationId: string;
    paymentOperationId: string;
    idempotencyKey: string;
  }): Promise<PaymentVoidResult> {
    const summary = await this.requestAuthorization({
      method: 'POST',
      path: `internal/v1/payment-authorizations/${encodeURIComponent(input.authorizationId)}/void`,
      body: {},
      idempotencyKey: input.idempotencyKey,
    });
    assertOperationBinding(summary, input);

    if (summary.status === 'voided') {
      return { kind: 'voided' };
    }
    return summary.reasonCode === undefined
      ? { kind: 'reconciliation_required' }
      : { kind: 'reconciliation_required', reasonCode: summary.reasonCode };
  }

  private async requestAuthorization(input: {
    method: 'GET' | 'POST';
    path: string;
    body?: object;
    idempotencyKey?: string;
  }): Promise<PaymentAuthorizationSummary> {
    const endpoint = canonicalServiceRequestUrl(new URL(input.path, this.baseUrl).toString());
    const serializedBody = input.body === undefined ? undefined : JSON.stringify(input.body);
    const rawBody = new TextEncoder().encode(serializedBody ?? '');
    let proof: string;

    try {
      proof = await this.options.requestProofSigner.sign({
        method: input.method,
        url: endpoint,
        rawBody,
        audience: PAYMENT_VAULT_AUDIENCE,
      });
    } catch {
      throw new PaymentVaultClientError('The Vault service request proof could not be created.');
    }

    let response: Response;
    try {
      const headers = new Headers({
        accept: 'application/json',
        'x-mandate-request-proof': proof,
      });
      if (serializedBody !== undefined) {
        headers.set('content-type', 'application/json');
      }
      if (input.idempotencyKey !== undefined) {
        headers.set('idempotency-key', input.idempotencyKey);
      }
      response = await fetchWithTimeout(this.fetchImplementation, endpoint, {
        method: input.method,
        headers,
        ...(serializedBody === undefined ? {} : { body: serializedBody }),
        redirect: 'error',
      }, this.timeoutMs);
    } catch (error) {
      if (error instanceof PaymentVaultClientError) {
        throw error;
      }
      throw new PaymentVaultClientError('The payment Vault could not be reached.');
    }

    const body = await parseJson(response);
    const parsed = PaymentAuthorizationResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new PaymentVaultClientError(
        `The payment Vault returned an untrusted HTTP ${response.status} response.`,
      );
    }
    return parsed.data.paymentAuthorization;
  }
}

export class PaymentVaultClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentVaultClientError';
  }
}

function assertAuthorizationBinding(
  summary: PaymentAuthorizationSummary,
  input: {
    paymentOperationId: string;
    paymentMethodId: string;
    amountMinor: number;
    currency: string;
    merchantReference: string;
  },
): void {
  if (
    summary.operationId !== input.paymentOperationId
    || summary.paymentMethodId !== input.paymentMethodId
    || summary.amountMinor !== input.amountMinor
    || summary.currency !== input.currency
    || summary.merchantReference !== input.merchantReference
  ) {
    throw new PaymentVaultClientError('The payment Vault response was not bound to the authorization request.');
  }
}

function assertOperationBinding(
  summary: PaymentAuthorizationSummary,
  input: { authorizationId: string; paymentOperationId: string },
): void {
  if (summary.id !== input.authorizationId || summary.operationId !== input.paymentOperationId) {
    throw new PaymentVaultClientError('The payment Vault response was not bound to the payment operation.');
  }
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('baseUrl must be an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError('baseUrl must be an absolute HTTP(S) URL without credentials, a query, or a fragment.');
  }
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname += '/';
  }
  return canonicalServiceRequestUrl(parsed.toString());
}

function validateTimeout(value: number | undefined): number {
  const timeoutMs = value ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new TypeError('timeoutMs must be a positive integer no greater than 30000.');
  }
  return timeoutMs;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    return undefined;
  }
}

async function fetchWithTimeout(
  fetchImplementation: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImplementation(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
