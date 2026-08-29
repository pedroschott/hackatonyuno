import {
  AgentIntentResultSchema,
  ApiErrorSchema,
  CompactJwsSchema,
  IdempotencyKeySchema,
  MerchantQuoteRequestSchema,
  MerchantQuoteResponseSchema,
  MerchantVerificationRequestSchema,
  MerchantSearchRequestSchema,
  MerchantSearchResponseSchema,
  OpaqueIdSchema,
  OrderVerificationRequestSchema,
  SubmitPurchaseIntentRequestSchema,
  VerificationResultSchema,
  type AgentIntentResult as ContractAgentIntentResult,
  type MerchantQuote,
  type MerchantQuoteRequest,
  type MerchantVerificationRequest,
  type MerchantSearchRequest,
  type MerchantSearchResponse,
  type OrderVerificationRequest,
  type SubmitPurchaseIntentRequest,
  type VerificationResult,
} from '@agentic-mandates/contracts';
import { z } from 'zod';

import { AgentPayApiError, AgentPayClientError } from './errors.js';
import {
  canonicalRequestUrl,
  type RequestProofSigner,
} from './proof.js';

const textEncoder = new TextEncoder();
const DEFAULT_MANDATE_API_AUDIENCE = 'mandate-api';
const AGENT_PROOF_HEADER = 'x-agent-request-proof';
const MERCHANT_PROOF_HEADER = 'x-merchant-request-proof';

const MerchantOrderStatusSchema = z.enum([
  'quoted',
  'verification_approved',
  'verification_rejected',
  'approval_required',
]);

const MerchantOrderVerificationResponseSchema = z
  .object({
    order: z
      .object({
        merchantId: OpaqueIdSchema,
        merchantOrderRef: OpaqueIdSchema,
        quoteId: OpaqueIdSchema,
        status: MerchantOrderStatusSchema,
        createdAt: z.string().datetime({ offset: true }),
        updatedAt: z.string().datetime({ offset: true }),
        verification: VerificationResultSchema.optional(),
      })
      .strict(),
  })
  .strict();

export type AgentIntentResult = ContractAgentIntentResult;
export type MerchantOrderStatus = z.infer<typeof MerchantOrderStatusSchema>;
export type MerchantOrderVerification = z.infer<typeof MerchantOrderVerificationResponseSchema>;

export type ClientRequestOptions = {
  /** Reuse only for a retry of the exact same mutation. */
  idempotencyKey?: string;
  /** Correlates the request with the merchant/Mandate evidence timeline. */
  requestId?: string;
  /** A server-provided challenge for an endpoint that requires a proof nonce. */
  nonce?: string;
};

export type SharedClientOptions = {
  baseUrl: string;
  requestProofSigner: RequestProofSigner;
  fetch?: typeof globalThis.fetch;
  idGenerator?: (prefix: 'idem_' | 'req_') => string;
};

export type AgentClientOptions = SharedClientOptions & {
  /** Defaults to the documented Mandate API audience. */
  audience?: string;
};

export type MerchantApiClientOptions = SharedClientOptions & {
  /** The Mandate-registry merchant ID bound to this endpoint. */
  merchantId: string;
};

export type MerchantClientOptions = SharedClientOptions & {
  /** Defaults to the documented Mandate API audience. */
  audience?: string;
};

export type VerifyMerchantOrderInput = OrderVerificationRequest & {
  merchantOrderRef: string;
};

export type AgentClient = {
  submitPurchaseIntent(
    request: SubmitPurchaseIntentRequest,
    options?: ClientRequestOptions,
  ): Promise<AgentIntentResult>;
};

/** Agent-facing client for one merchant's `agents-pay` API. */
export type MerchantApiClient = {
  search(
    request: MerchantSearchRequest,
    options?: Omit<ClientRequestOptions, 'idempotencyKey'>,
  ): Promise<MerchantSearchResponse>;
  createQuote(
    request: MerchantQuoteRequest,
    options?: ClientRequestOptions,
  ): Promise<MerchantQuote>;
  getQuote(
    quoteId: string,
    options?: Omit<ClientRequestOptions, 'idempotencyKey'>,
  ): Promise<MerchantQuote>;
  verifyOrder(
    request: VerifyMerchantOrderInput,
    options?: ClientRequestOptions,
  ): Promise<MerchantOrderVerification>;
};

/** Merchant-service client for the Mandate verification handoff. */
export type MerchantClient = {
  verifyPurchase(
    request: MerchantVerificationRequest,
    options?: ClientRequestOptions,
  ): Promise<VerificationResult>;
};

/**
 * Creates a client for agent-authenticated Mandate API endpoints. Principal
 * revocation and passkey actions deliberately remain in the browser BFF and
 * are not exposed to an autonomous agent.
 */
export function createAgentClient(options: AgentClientOptions): AgentClient {
  const client = createHttpClient({
    ...options,
    audience: options.audience ?? DEFAULT_MANDATE_API_AUDIENCE,
    requestProofHeader: AGENT_PROOF_HEADER,
  });

  return {
    async submitPurchaseIntent(request, requestOptions = {}) {
      const body = parseRequest(SubmitPurchaseIntentRequestSchema, request);
      return client.request({
        method: 'POST',
        path: 'v1/agent/intents',
        body,
        mutation: true,
        options: requestOptions,
        responseSchema: AgentIntentResultSchema,
      });
    },
  };
}

/**
 * Creates a client for the merchant-to-Mandate verification handoff. This is
 * a service-to-service call and therefore uses the merchant-proof header.
 */
export function createMerchantClient(options: MerchantClientOptions): MerchantClient {
  const client = createHttpClient({
    ...options,
    audience: options.audience ?? DEFAULT_MANDATE_API_AUDIENCE,
    requestProofHeader: MERCHANT_PROOF_HEADER,
  });

  return {
    async verifyPurchase(request, requestOptions = {}) {
      const body = parseRequest(MerchantVerificationRequestSchema, request);
      return client.request({
        method: 'POST',
        path: 'v1/merchant/verifications',
        body,
        mutation: true,
        options: requestOptions,
        responseSchema: VerificationResultSchema,
      });
    },
  };
}

/** Creates an agent-facing client for one merchant's `agents-pay` API. */
export function createMerchantApiClient(options: MerchantApiClientOptions): MerchantApiClient {
  const merchantId = parseRequest(OpaqueIdSchema, options.merchantId);
  const client = createHttpClient({
    ...options,
    audience: `merchant-api:${merchantId}`,
    requestProofHeader: AGENT_PROOF_HEADER,
  });

  return {
    async search(request, requestOptions = {}) {
      const body = parseRequest(MerchantSearchRequestSchema, request);
      const response = await client.request({
        method: 'POST',
        path: 'v1/agents-pay/search',
        body,
        mutation: false,
        options: requestOptions,
        responseSchema: MerchantSearchResponseSchema,
      });
      assertMerchantMatch(response.merchantId, merchantId);
      return response;
    },
    async createQuote(request, requestOptions = {}) {
      const body = parseRequest(MerchantQuoteRequestSchema, request);
      const response = await client.request({
        method: 'POST',
        path: 'v1/agents-pay/quotes',
        body,
        mutation: true,
        options: requestOptions,
        responseSchema: MerchantQuoteResponseSchema,
      });
      assertMerchantMatch(response.quote.merchantId, merchantId);
      return response.quote;
    },
    async getQuote(quoteId, requestOptions = {}) {
      const parsedQuoteId = parseRequest(OpaqueIdSchema, quoteId);
      const response = await client.request({
        method: 'GET',
        path: `v1/agents-pay/quotes/${encodeURIComponent(parsedQuoteId)}`,
        mutation: false,
        options: requestOptions,
        responseSchema: MerchantQuoteResponseSchema,
      });
      assertMerchantMatch(response.quote.merchantId, merchantId);
      return response.quote;
    },
    async verifyOrder(request, requestOptions = {}) {
      const merchantOrderRef = parseRequest(OpaqueIdSchema, request.merchantOrderRef);
      const body = parseRequest(OrderVerificationRequestSchema, {
        quoteId: request.quoteId,
        purchaseCapability: request.purchaseCapability,
      });
      const response = await client.request({
        method: 'POST',
        path: `v1/agents-pay/orders/${encodeURIComponent(merchantOrderRef)}/verification`,
        body,
        mutation: true,
        options: requestOptions,
        responseSchema: MerchantOrderVerificationResponseSchema,
      });
      assertMerchantMatch(response.order.merchantId, merchantId);
      return response;
    },
  };
}

type RequestProofHeader = typeof AGENT_PROOF_HEADER | typeof MERCHANT_PROOF_HEADER;

type InternalHttpClientOptions = SharedClientOptions & {
  audience: string;
  requestProofHeader: RequestProofHeader;
};

type SdkRequest<T> = {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  mutation: boolean;
  options: ClientRequestOptions;
  responseSchema: z.ZodType<T>;
};

function createHttpClient(options: InternalHttpClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const audience = parseAudience(options.audience);
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  if (typeof fetchImplementation !== 'function') {
    throw new AgentPayClientError(
      'SERVICE_UNAVAILABLE',
      'A Fetch implementation is required to create an AgentPay client.',
    );
  }

  return {
    async request<T>(request: SdkRequest<T>): Promise<T> {
      const url = endpointUrl(baseUrl, request.path);
      const serializedBody = request.body === undefined ? undefined : serializeBody(request.body);
      const rawBody = textEncoder.encode(serializedBody ?? '');
      const requestId = createRequestId(request.options.requestId, options.idGenerator);
      const headers = new Headers({
        accept: 'application/json',
        'x-request-id': requestId,
      });

      if (serializedBody !== undefined) {
        headers.set('content-type', 'application/json');
      }
      if (request.mutation) {
        headers.set(
          'idempotency-key',
          createIdempotencyKey(request.options.idempotencyKey, options.idGenerator),
        );
      }

      let proof: string;
      try {
        proof = await options.requestProofSigner.sign({
          method: request.method,
          url,
          rawBody,
          audience,
          ...(request.options.nonce === undefined ? {} : { nonce: request.options.nonce }),
        });
      } catch (error) {
        throw new AgentPayClientError(
          'AGENT_PROOF_INVALID',
          'The request proof could not be created.',
          { cause: error },
        );
      }

      if (!isCompactJws(proof)) {
        throw new AgentPayClientError(
          'AGENT_PROOF_INVALID',
          'The configured request proof signer returned an invalid compact JWS.',
        );
      }
      headers.set(options.requestProofHeader, proof);

      let response: Response;
      try {
        response = await fetchImplementation(url, {
          method: request.method,
          headers,
          ...(serializedBody === undefined ? {} : { body: serializedBody }),
          redirect: 'error',
        });
      } catch (error) {
        throw new AgentPayClientError(
          'SERVICE_UNAVAILABLE',
          'The AgentPay endpoint could not be reached.',
          { cause: error },
        );
      }

      const responseBody = await parseResponseJson(response);
      if (!response.ok) {
        throwServerOrProtocolError(response, responseBody);
      }

      const parsed = request.responseSchema.safeParse(responseBody);
      if (!parsed.success) {
        throw new AgentPayClientError(
          'RESPONSE_SCHEMA_INVALID',
          'The AgentPay endpoint returned an unexpected successful response.',
          {
            status: response.status,
            requestId: response.headers.get('x-request-id') ?? undefined,
          },
        );
      }
      return parsed.data;
    },
  };
}

function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AgentPayClientError(
      'INVALID_REQUEST',
      'The request does not match the AgentPay contract.',
    );
  }
  return parsed.data;
}

function serializeBody(body: unknown): string {
  try {
    const serialized = JSON.stringify(body);
    if (serialized === undefined) {
      throw new TypeError('JSON body serialization returned undefined.');
    }
    return serialized;
  } catch (error) {
    throw new AgentPayClientError(
      'INVALID_REQUEST',
      'The request body cannot be serialized as JSON.',
      { cause: error },
    );
  }
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new AgentPayClientError('INVALID_REQUEST', 'baseUrl must be an absolute URL.', {
      cause: error,
    });
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new AgentPayClientError(
      'INVALID_REQUEST',
      'baseUrl must be an absolute HTTP(S) URL without credentials.',
    );
  }
  if (parsed.search || parsed.hash) {
    throw new AgentPayClientError(
      'INVALID_REQUEST',
      'baseUrl cannot contain a query string or fragment.',
    );
  }
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname += '/';
  }
  return canonicalRequestUrl(parsed.toString());
}

function endpointUrl(baseUrl: string, path: string): string {
  return canonicalRequestUrl(new URL(path, baseUrl).toString());
}

function parseAudience(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || value !== value.trim()) {
    throw new AgentPayClientError(
      'INVALID_REQUEST',
      'audience must be a non-empty trimmed string of at most 160 characters.',
    );
  }
  return value;
}

function assertMerchantMatch(actualMerchantId: string, expectedMerchantId: string): void {
  if (actualMerchantId !== expectedMerchantId) {
    throw new AgentPayClientError(
      'MERCHANT_ENDPOINT_MISMATCH',
      'The merchant endpoint returned data for a different merchant.',
    );
  }
}

function createRequestId(
  supplied: string | undefined,
  idGenerator: SharedClientOptions['idGenerator'],
): string {
  const value = supplied ?? generatedId('req_', idGenerator);
  const validForMerchant = /^[A-Za-z0-9_-]{8,128}$/.test(value);
  if (!validForMerchant) {
    throw new AgentPayClientError(
      'INVALID_REQUEST',
      'requestId must use 8 to 128 URL-safe letters, digits, underscores, or hyphens.',
    );
  }
  return value;
}

function createIdempotencyKey(
  supplied: string | undefined,
  idGenerator: SharedClientOptions['idGenerator'],
): string {
  const value = supplied ?? generatedId('idem_', idGenerator);
  const parsed = IdempotencyKeySchema.safeParse(value);
  if (!parsed.success || parsed.data.length > 200) {
    throw new AgentPayClientError(
      'INVALID_REQUEST',
      'idempotencyKey must be a non-empty string of at most 200 characters.',
    );
  }
  return parsed.data;
}

function generatedId(
  prefix: 'idem_' | 'req_',
  idGenerator: SharedClientOptions['idGenerator'],
): string {
  const generated = idGenerator?.(prefix) ?? defaultId(prefix);
  const parsed = OpaqueIdSchema.safeParse(generated);
  if (!parsed.success) {
    throw new AgentPayClientError(
      'INVALID_REQUEST',
      'The configured idGenerator returned an invalid identifier.',
    );
  }
  return parsed.data;
}

function defaultId(prefix: 'idem_' | 'req_'): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new AgentPayClientError(
      'SERVICE_UNAVAILABLE',
      'Web Crypto randomUUID is required to generate request identifiers.',
    );
  }
  return `${prefix}${globalThis.crypto.randomUUID()}`;
}

async function parseResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function throwServerOrProtocolError(response: Response, responseBody: unknown): never {
  const apiError = ApiErrorSchema.safeParse(responseBody);
  if (apiError.success) {
    throw new AgentPayApiError(apiError.data.error.code, apiError.data.error.message, {
      status: response.status,
      requestId: apiError.data.error.requestId,
      retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
    });
  }

  throw new AgentPayClientError(
    'RESPONSE_SCHEMA_INVALID',
    `The AgentPay endpoint returned an unexpected HTTP ${response.status} response.`,
    {
      status: response.status,
      requestId: response.headers.get('x-request-id') ?? undefined,
      retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
    },
  );
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isCompactJws(value: string): boolean {
  return CompactJwsSchema.safeParse(value).success;
}
