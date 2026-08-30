import { randomUUID } from 'node:crypto';

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { JWK } from 'jose';
import { z } from 'zod';

import {
  OrderVerificationRequestSchema,
  QuoteRequestSchema,
  SearchRequestSchema,
  type MerchantQuote,
  type MerchantQuotePayload,
  type QuoteRequest,
  type VerificationResult,
} from '@agentic-mandates/contracts';
import { calculateMerchantCartHash, requestFingerprint } from '@agentic-mandates/domain';

import {
  type MerchantRequestAuthenticator,
  type MerchantEndpointPurpose,
  type MerchantRequestActor,
} from './auth.js';
import {
  merchantDefinitions,
  type CatalogProduct,
  type MerchantDefinition,
} from './catalog.js';
import {
  type IdempotencyStore,
  type StoredResponse,
} from './idempotency.js';
import {
  type MandateVerificationClient,
} from './mandate-verifier.js';
import {
  type MerchantOrder,
  type MerchantOrderStore,
  type MerchantOrderVerificationClaim,
  MerchantOrderConflictError,
} from './order-store.js';
import { signMerchantQuote } from './quote-signing.js';
import {
  type QuoteStore,
  isQuoteExpired,
} from './quote-store.js';
import { type MerchantRateLimiter } from './rate-limit.js';

type AppEnv = {
  Variables: {
    requestId: string;
  };
};

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 500 | 503;

type QuoteScenario = 'valid' | 'expired_quote';

export type MerchantMocksOptions = {
  requestAuthenticator: MerchantRequestAuthenticator;
  mandateVerifier: MandateVerificationClient;
  signingKeys: ReadonlyMap<string, JWK>;
  merchantDefinitions?: readonly MerchantDefinition[];
  quoteStore: QuoteStore;
  quoteIdempotencyStore: IdempotencyStore;
  verificationIdempotencyStore: IdempotencyStore;
  orderStore: MerchantOrderStore;
  rateLimiter: MerchantRateLimiter;
  now?: () => Date;
  idGenerator?: () => string;
  quoteTtlMs?: number;
  allowedWebOrigin?: string;
  /** Test-only controls are disabled unless both this option and its header match. */
  demoScenarioControl?: { secret: string };
};

/**
 * Creates two merchant routers under their registered paths. It requires the
 * caller to supply real request authentication, merchant signing keys, and a
 * Mandate bridge; none of those are reimplemented by this service.
 */
export function createMerchantMocksApp(options: MerchantMocksOptions): Hono<AppEnv> {
  const definitions = options.merchantDefinitions ?? merchantDefinitions;
  const dependencies: MerchantMocksDependencies = {
    requestAuthenticator: options.requestAuthenticator,
    mandateVerifier: options.mandateVerifier,
    signingKeys: options.signingKeys,
    quoteStore: options.quoteStore,
    quoteIdempotencyStore: options.quoteIdempotencyStore,
    verificationIdempotencyStore: options.verificationIdempotencyStore,
    orderStore: options.orderStore,
    rateLimiter: options.rateLimiter,
    now: options.now ?? (() => new Date()),
    idGenerator: options.idGenerator ?? randomUUID,
    quoteTtlMs: options.quoteTtlMs ?? 5 * 60_000,
    ...(options.demoScenarioControl
      ? { demoScenarioControl: options.demoScenarioControl }
      : {}),
  };

  validateConfiguration(definitions, dependencies);

  const app = new Hono<AppEnv>();

  app.use('*', async (context, next) => {
    const requestId = validRequestId(context.req.header('x-request-id'))
      ? context.req.header('x-request-id')!
      : `req_${dependencies.idGenerator()}`;
    context.set('requestId', requestId);
    context.header('x-request-id', requestId);
    await next();
  });
  app.use('*', secureHeaders());
  app.use(
    '*',
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (context) =>
        apiError(context, 413, 'REQUEST_TOO_LARGE', 'The request body exceeds 16 KiB.'),
    }),
  );

  if (options.allowedWebOrigin) {
    app.use(
      '*',
      cors({
        origin: options.allowedWebOrigin,
        allowMethods: ['GET', 'POST'],
        allowHeaders: [
          'content-type',
          'idempotency-key',
          'x-agent-request-proof',
          'x-mandate-request-proof',
          'x-request-id',
        ],
      }),
    );
  }

  app.get('/health', (context) =>
    context.json({
      status: 'ok',
      merchants: definitions.map((merchant) => merchant.id),
    }),
  );

  for (const merchant of definitions) {
    app.route(merchant.basePath, createMerchantRouter(merchant, dependencies));
  }

  app.notFound((context) =>
    apiError(context, 404, 'ROUTE_NOT_FOUND', 'The requested route does not exist.'),
  );
  app.onError((_error, context) =>
    apiError(context, 500, 'INTERNAL_ERROR', 'The merchant service could not process the request.'),
  );

  return app;
}

type MerchantMocksDependencies = {
  requestAuthenticator: MerchantRequestAuthenticator;
  mandateVerifier: MandateVerificationClient;
  signingKeys: ReadonlyMap<string, JWK>;
  quoteStore: QuoteStore;
  quoteIdempotencyStore: IdempotencyStore;
  verificationIdempotencyStore: IdempotencyStore;
  orderStore: MerchantOrderStore;
  rateLimiter: MerchantRateLimiter;
  now: () => Date;
  idGenerator: () => string;
  quoteTtlMs: number;
  demoScenarioControl?: { secret: string };
};

function createMerchantRouter(
  merchant: MerchantDefinition,
  dependencies: MerchantMocksDependencies,
): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get('/.well-known/agentpay.json', (context) =>
    context.json({
      protocol: 'agentpay/1.0',
      merchant: { id: merchant.id, name: merchant.name },
      checkout_endpoint: `${merchant.basePath}/v1/agents-pay/orders/verification`,
      capabilities: ['intent-mandates', 'live-revocation', 'mock-payment'],
      currency: 'USD',
    }),
  );

  router.post('/v1/agents-pay/search', async (context) => {
    const authenticationFailure = await requireMerchantRequestAuthentication(
      context,
      merchant.id,
      'search',
      ['agent'],
      dependencies,
    );

    if (authenticationFailure) {
      return authenticationFailure;
    }

    const parsed = await parseJson(context, SearchRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const query = normalizeSearchQuery(parsed.value.query);
    const limit = parsed.value.limit ?? 10;
    const offers = merchant.catalog
      .filter((product) => productMatchesSearch(product, query))
      .slice(0, limit)
      .map((product) => ({
        merchantSku: product.merchantSku,
        merchantCategoryId: product.merchantCategoryId,
        name: product.name,
        description: product.description,
        unitAmountMinor: product.unitAmountMinor,
        currency: product.currency,
        availableQuantity: product.availableQuantity,
        attributes: product.attributes,
      }));

    return context.json({
      merchantId: merchant.id,
      merchantName: merchant.name,
      merchantCatalogVersion: merchant.merchantCatalogVersion,
      offers,
    });
  });

  router.post('/v1/agents-pay/quotes', async (context) => {
    const authenticationFailure = await requireMerchantRequestAuthentication(
      context,
      merchant.id,
      'quote',
      ['agent'],
      dependencies,
    );

    if (authenticationFailure) {
      return authenticationFailure;
    }

    const idempotencyKey = requireIdempotencyKey(context);
    if (!idempotencyKey.ok) {
      return idempotencyKey.response;
    }

    const parsed = await parseJson(context, QuoteRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const quoteScenario = readQuoteScenario(context, dependencies);
    if (quoteScenario instanceof ScenarioControlError) {
      return apiError(context, 403, quoteScenario.code, quoteScenario.message);
    }

    const execution = await dependencies.quoteIdempotencyStore.execute(
      `quote:${merchant.id}`,
      idempotencyKey.value,
      requestFingerprint(parsed.value),
      async () => {
        try {
          const quote = await createQuote(
            merchant,
            parsed.value,
            quoteScenario,
            dependencies,
          );
          await dependencies.quoteStore.save(quote);
          await dependencies.orderStore.createQuoted({
            merchantId: merchant.id,
            merchantOrderRef: quote.merchantOrderRef,
            quoteId: quote.id,
            status: 'quoted',
            createdAt: quote.issuedAt,
            updatedAt: quote.issuedAt,
          });
          return { status: 201, body: { quote } };
        } catch (error) {
          if (error instanceof QuoteConstructionError) {
            return {
              status: 422,
              body: apiErrorBody(context, error.code, error.message),
            };
          }

          if (error instanceof MerchantOrderConflictError) {
            return {
              status: 409,
              body: apiErrorBody(context, 'ORDER_REFERENCE_CONFLICT', error.message),
            };
          }

          throw error;
        }
      },
    );

    if (execution.kind === 'conflict') {
      return apiError(
        context,
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used with a different request body.',
      );
    }

    return respondStored(context, execution.response);
  });

  router.get('/v1/agents-pay/quotes/:quoteId', async (context) => {
    const authenticationFailure = await requireMerchantRequestAuthentication(
      context,
      merchant.id,
      'quote_read',
      ['agent', 'mandate-service'],
      dependencies,
    );

    if (authenticationFailure) {
      return authenticationFailure;
    }

    const quote = await dependencies.quoteStore.get(context.req.param('quoteId'));
    if (!quote) {
      return apiError(context, 404, 'QUOTE_NOT_FOUND', 'The quote does not exist.');
    }

    if (quote.merchantId !== merchant.id) {
      return apiError(
        context,
        409,
        'QUOTE_MERCHANT_MISMATCH',
        'The quote belongs to a different merchant endpoint.',
      );
    }

    if (isQuoteExpired(quote, dependencies.now())) {
      return apiError(context, 410, 'QUOTE_EXPIRED', 'The quote has expired.');
    }

    return context.json({ quote });
  });

  router.post('/v1/agents-pay/orders/:merchantOrderRef/verification', async (context) => {
    const authenticationFailure = await requireMerchantRequestAuthentication(
      context,
      merchant.id,
      'order_verification',
      ['agent'],
      dependencies,
    );

    if (authenticationFailure) {
      return authenticationFailure;
    }

    const idempotencyKey = requireIdempotencyKey(context);
    if (!idempotencyKey.ok) {
      return idempotencyKey.response;
    }

    const parsed = await parseJson(context, OrderVerificationRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const merchantOrderRef = context.req.param('merchantOrderRef');
    const quote = await dependencies.quoteStore.get(parsed.value.quoteId);
    if (!quote) {
      return apiError(context, 404, 'QUOTE_NOT_FOUND', 'The quote does not exist.');
    }

    if (quote.merchantId !== merchant.id) {
      return apiError(
        context,
        409,
        'QUOTE_MERCHANT_MISMATCH',
        'The quote belongs to a different merchant endpoint.',
      );
    }

    if (quote.merchantOrderRef !== merchantOrderRef) {
      return apiError(
        context,
        409,
        'ORDER_QUOTE_MISMATCH',
        'The order reference is not bound to the supplied quote.',
      );
    }

    const execution = await dependencies.verificationIdempotencyStore.execute(
      `verification:${merchant.id}:${merchantOrderRef}`,
      idempotencyKey.value,
      requestFingerprint(parsed.value),
      async () => {
        let claim: MerchantOrderVerificationClaim | undefined;

        try {
          const claimResult = await dependencies.orderStore.claimVerification({
            merchantId: merchant.id,
            merchantOrderRef,
            quoteId: quote.id,
            idempotencyKey: idempotencyKey.value,
          });

          if (claimResult.kind === 'terminal') {
            return {
              status: 409,
              body: apiErrorBody(
                context,
                'ORDER_ALREADY_VERIFIED',
                'A terminal verification decision is already stored for this order.',
              ),
            };
          }

          if (claimResult.kind === 'in_progress') {
            return {
              status: 409,
              body: apiErrorBody(
                context,
                'VERIFICATION_IN_PROGRESS',
                'Another verification request is already in progress for this order.',
              ),
            };
          }

          claim = claimResult.claim;

          if (isQuoteExpired(quote, dependencies.now())) {
            await dependencies.orderStore.abandonVerification(claim);
            claim = undefined;
            return {
              status: 410,
              body: apiErrorBody(context, 'QUOTE_EXPIRED', 'The quote has expired.'),
            };
          }

          const verification = await dependencies.mandateVerifier.verify({
            merchantId: merchant.id,
            merchantOrderRef,
            quoteId: quote.id,
            purchaseCapability: parsed.value.purchaseCapability,
            idempotencyKey: idempotencyKey.value,
            requestId: context.get('requestId'),
          });
          const order = await dependencies.orderStore.completeVerification(
            claim,
            verification,
            dependencies.now().toISOString(),
          );
          claim = undefined;

          return {
            status: statusForVerification(verification),
            body: { order: toPublicOrder(order) },
          };
        } catch (error) {
          if (claim) {
            await dependencies.orderStore.abandonVerification(claim).catch(() => undefined);
          }

          if (error instanceof MerchantOrderConflictError) {
            return {
              status: 409,
              body: apiErrorBody(context, 'ORDER_REFERENCE_CONFLICT', error.message),
            };
          }

          return {
            status: 503,
            body: apiErrorBody(
              context,
              'MANDATE_VERIFICATION_UNAVAILABLE',
              'The Mandate verification service did not return a usable result.',
            ),
          };
        }

      },
    );

    if (execution.kind === 'conflict') {
      return apiError(
        context,
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used with a different request body.',
      );
    }

    return respondStored(context, execution.response);
  });

  return router;
}

async function requireMerchantRequestAuthentication(
  context: Context<AppEnv>,
  merchantId: string,
  purpose: MerchantEndpointPurpose,
  allowedActors: readonly MerchantRequestActor['type'][],
  dependencies: MerchantMocksDependencies,
): Promise<Response | undefined> {
  const result = await dependencies.requestAuthenticator.authenticate({
    request: context.req.raw,
    merchantId,
    purpose,
  });

  if (result.ok) {
    if (!allowedActors.includes(result.actor.type)) {
      return apiError(
        context,
        403,
        'ACTOR_NOT_ALLOWED',
        'This authenticated actor is not allowed to call this merchant endpoint.',
      );
    }

    try {
      const rateLimit = await dependencies.rateLimiter.check({
        request: context.req.raw,
        merchantId,
        purpose,
        actor: result.actor,
      });

      if (rateLimit.allowed) {
        return undefined;
      }

      if (rateLimit.retryAfterSeconds) {
        context.header('retry-after', String(rateLimit.retryAfterSeconds));
      }

      return apiError(
        context,
        429,
        'RATE_LIMITED',
        'Too many requests were made for this merchant endpoint.',
      );
    } catch {
      return apiError(
        context,
        503,
        'RATE_LIMIT_UNAVAILABLE',
        'Rate-limit verification is temporarily unavailable.',
      );
    }
  }

  return apiError(context, result.status, result.code, result.message);
}

async function parseJson<T>(
  context: Context<AppEnv>,
  schema: z.ZodType<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  if (!context.req.header('content-type')?.toLowerCase().includes('application/json')) {
    return {
      ok: false,
      response: apiError(
        context,
        400,
        'CONTENT_TYPE_REQUIRED',
        'Content-Type must be application/json.',
      ),
    };
  }

  const body: unknown = await context.req.json().catch(() => undefined);
  const result = schema.safeParse(body);

  if (!result.success) {
    return {
      ok: false,
      response: apiError(context, 422, 'INVALID_REQUEST', 'The request body is invalid.'),
    };
  }

  return { ok: true, value: result.data };
}

function requireIdempotencyKey(
  context: Context<AppEnv>,
): { ok: true; value: string } | { ok: false; response: Response } {
  const value = context.req.header('idempotency-key')?.trim();

  if (!value || value.length > 200) {
    return {
      ok: false,
      response: apiError(
        context,
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'A non-empty Idempotency-Key of at most 200 characters is required.',
      ),
    };
  }

  return { ok: true, value };
}

function readQuoteScenario(
  context: Context<AppEnv>,
  dependencies: MerchantMocksDependencies,
): QuoteScenario | ScenarioControlError {
  const requestedScenario = context.req.header('x-demo-quote-scenario');

  if (!requestedScenario) {
    return 'valid';
  }

  if (
    !dependencies.demoScenarioControl ||
    context.req.header('x-demo-admin-secret') !== dependencies.demoScenarioControl.secret
  ) {
    return new ScenarioControlError(
      'DEMO_SCENARIO_FORBIDDEN',
      'Demo quote scenarios require the configured local demo control.',
    );
  }

  if (requestedScenario === 'expired_quote') {
    return requestedScenario;
  }

  return new ScenarioControlError(
    'DEMO_SCENARIO_UNKNOWN',
    'The requested demo quote scenario is not supported.',
  );
}

async function createQuote(
  merchant: MerchantDefinition,
  request: QuoteRequest,
  scenario: QuoteScenario,
  dependencies: MerchantMocksDependencies,
): Promise<MerchantQuote> {
  const requestedQuantities = new Map<string, number>();

  for (const item of request.items) {
    requestedQuantities.set(
      item.merchantSku,
      (requestedQuantities.get(item.merchantSku) ?? 0) + item.quantity,
    );
  }

  const lineItems = [...requestedQuantities.entries()]
    .sort(([firstSku], [secondSku]) => firstSku.localeCompare(secondSku))
    .map(([merchantSku, quantity]) => quoteLineItem(merchant, merchantSku, quantity));
  const subtotalMinor = lineItems.reduce(
    (total, item) => total + item.unitAmountMinor * item.quantity,
    0,
  );
  const shippingMinor =
    subtotalMinor >= merchant.pricing.freeShippingAtMinor
      ? 0
      : merchant.pricing.flatShippingMinor;
  const taxMinor = Math.round(
    ((subtotalMinor + shippingMinor) * merchant.pricing.taxBasisPoints) / 10_000,
  );
  const totalMinor = subtotalMinor + shippingMinor + taxMinor;

  if (![subtotalMinor, shippingMinor, taxMinor, totalMinor].every(Number.isSafeInteger)) {
    throw new QuoteConstructionError(
      'AMOUNT_OUT_OF_RANGE',
      'The quote amount cannot be represented safely.',
    );
  }

  const now = dependencies.now();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + (scenario === 'expired_quote' ? -1 : dependencies.quoteTtlMs),
  ).toISOString();
  const keyId = merchant.signingKeyId;
  const quoteWithoutCartHash: Omit<MerchantQuotePayload, 'merchantCartHash'> = {
    id: `quote_${dependencies.idGenerator()}`,
    merchantId: merchant.id,
    merchantOrderRef: `order_${dependencies.idGenerator()}`,
    issuedAt,
    merchantCatalogVersion: merchant.merchantCatalogVersion,
    lineItems,
    subtotalMinor,
    shippingMinor,
    taxMinor,
    totalMinor,
    currency: 'USD',
    expiresAt,
    keyId,
  };
  const payload: MerchantQuotePayload = {
    ...quoteWithoutCartHash,
    merchantCartHash: calculateMerchantCartHash(quoteWithoutCartHash),
  };
  const signingKey = dependencies.signingKeys.get(merchant.id);

  if (!signingKey) {
    throw new Error(`No signing key is configured for merchant ${merchant.id}.`);
  }

  return signMerchantQuote(payload, signingKey);
}

function quoteLineItem(
  merchant: MerchantDefinition,
  merchantSku: string,
  quantity: number,
): MerchantQuotePayload['lineItems'][number] {
  const product = merchant.catalog.find((candidate) => candidate.merchantSku === merchantSku);

  if (!product) {
    throw new QuoteConstructionError(
      'SKU_NOT_FOUND',
      `The merchant does not offer SKU ${merchantSku}.`,
    );
  }

  if (quantity > product.availableQuantity) {
    throw new QuoteConstructionError(
      'INSUFFICIENT_INVENTORY',
      `SKU ${merchantSku} has insufficient inventory.`,
    );
  }

  return {
    merchantSku: product.merchantSku,
    merchantCategoryId: product.merchantCategoryId,
    name: product.name,
    quantity,
    unitAmountMinor: product.unitAmountMinor,
    attributes: product.attributes,
  };
}

function productMatchesSearch(product: CatalogProduct, normalizedQuery: string): boolean {
  const searchableText = [product.name, product.description, ...product.searchTerms]
    .join(' ')
    .toLocaleLowerCase();
  return normalizedQuery.split(' ').every((term) => searchableText.includes(term));
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll(/\s+/g, ' ');
}

function statusForVerification(verification: VerificationResult): 200 | 202 | 403 {
  switch (verification.decision) {
    case 'approved':
      return verification.settlementStatus === 'captured' ? 200 : 202;
    case 'approval_required':
      return 202;
    case 'rejected':
      return 403;
  }
}

function toPublicOrder(order: MerchantOrder) {
  const verification = order.verification;

  return {
    merchantId: order.merchantId,
    merchantOrderRef: order.merchantOrderRef,
    quoteId: order.quoteId,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    verification: verification
      ? {
          decision: verification.decision,
          reasonCode: verification.reasonCode,
          verificationId: verification.verificationId,
          mandateStatus: verification.mandateStatus,
          verificationReceipt: verification.verificationReceipt,
          expiresAt: verification.expiresAt,
          ...(verification.paymentOperationId && verification.settlementStatus
            ? {
                paymentOperationId: verification.paymentOperationId,
                settlementStatus: verification.settlementStatus,
              }
            : {}),
        }
      : undefined,
  };
}

function apiError(
  context: Context<AppEnv>,
  status: ErrorStatus,
  code: string,
  message: string,
): Response {
  return context.json(apiErrorBody(context, code, message), status);
}

function apiErrorBody(context: Context<AppEnv>, code: string, message: string) {
  return {
    error: {
      code,
      message,
      requestId: context.get('requestId'),
    },
  };
}

function respondStored(context: Context<AppEnv>, response: StoredResponse): Response {
  return context.json(response.body, response.status);
}

function validRequestId(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{8,128}$/.test(value));
}

function validateConfiguration(
  definitions: readonly MerchantDefinition[],
  dependencies: MerchantMocksDependencies,
): void {
  if (definitions.length < 2) {
    throw new Error('Merchant mocks require at least two merchant definitions.');
  }

  if (dependencies.quoteTtlMs <= 0) {
    throw new Error('quoteTtlMs must be greater than zero.');
  }

  if (
    !dependencies.requestAuthenticator ||
    !dependencies.mandateVerifier ||
    !dependencies.signingKeys ||
    !dependencies.quoteStore ||
    !dependencies.quoteIdempotencyStore ||
    !dependencies.verificationIdempotencyStore ||
    !dependencies.orderStore
    || !dependencies.rateLimiter
  ) {
    throw new Error(
      'Merchant mocks require authenticated, Mandate-verified, durable runtime adapters.',
    );
  }

  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const merchant of definitions) {
    if (ids.has(merchant.id) || paths.has(merchant.basePath)) {
      throw new Error('Merchant IDs and base paths must be unique.');
    }

    if (!dependencies.signingKeys.has(merchant.id)) {
      throw new Error(`No signing key is configured for merchant ${merchant.id}.`);
    }

    ids.add(merchant.id);
    paths.add(merchant.basePath);
  }
}

class QuoteConstructionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'QuoteConstructionError';
  }
}

class ScenarioControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ScenarioControlError';
  }
}
