import { randomUUID } from 'node:crypto';

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';

import {
  MANDATE_SERVICE_ID,
  PAYMENT_VAULT_AUDIENCE,
  type AuthenticatedVaultService,
  type ServiceJwsAuthenticator,
} from './auth.js';
import { requestFingerprint } from './canonical.js';
import {
  CreatePaymentAuthorizationRequestSchema,
  CreateHostedSetupSessionRequestSchema,
  CreateTestPaymentMethodRequestSchema,
  EmptyRequestSchema,
  ExchangeHostedSetupSessionRequestSchema,
  HostedSetupSessionIdSchema,
  TestPaymentMethodFixtureSchema,
  type CreatePaymentAuthorizationRequest,
  type PaymentAuthorizationStatus,
  type TestPaymentMethodFixture,
} from './contracts.js';
import {
  type HostedSetupSession,
  type HostedSetupSessionStore,
} from './hosted-setup-store.js';
import {
  type StoredResponse,
  type VaultIdempotencyStore,
} from './idempotency.js';
import {
  type MockYunoCaptureResult,
  type MockYunoRouter,
  type MockYunoStatusResult,
  type MockYunoVoidResult,
} from './mock-yuno.js';
import {
  type PaymentAuthorizationLockResult,
  type PaymentAuthorizationStore,
  type VaultPaymentAuthorization,
  toAuthorizationSummary,
} from './payment-authorization-store.js';
import {
  type PaymentMethodStore,
  toPaymentMethodSummary,
} from './payment-method-store.js';

type AppEnv = {
  Variables: {
    requestId: string;
  };
};

type ErrorStatus = 400 | 401 | 404 | 409 | 410 | 413 | 422 | 500 | 502 | 503;

export type PaymentVaultOptions = {
  serviceAuthenticator: ServiceJwsAuthenticator;
  paymentMethodStore: PaymentMethodStore;
  authorizationStore: PaymentAuthorizationStore;
  hostedSetupSessionStore: HostedSetupSessionStore;
  idempotencyStore: VaultIdempotencyStore;
  yunoRouter: MockYunoRouter;
  hostedBaseUrl: string;
  allowedHostedReturnOrigins: readonly string[];
  hostedSetupTtlMs?: number;
  now?: () => Date;
  idGenerator?: () => string;
};

type PaymentVaultDependencies = Required<
  Pick<
    PaymentVaultOptions,
    | 'serviceAuthenticator'
    | 'paymentMethodStore'
    | 'authorizationStore'
    | 'hostedSetupSessionStore'
    | 'idempotencyStore'
    | 'yunoRouter'
    | 'hostedBaseUrl'
  >
> & {
  allowedHostedReturnOrigins: ReadonlySet<string>;
  hostedSetupTtlMs: number;
  now: () => Date;
  idGenerator: () => string;
};

/**
 * Creates the isolated test-payment Vault. All payment routes require an
 * injected Mandate-service JWS verifier; this factory deliberately has no
 * browser, agent, merchant, or insecure local-auth fallback.
 */
export function createPaymentVaultApp(options: PaymentVaultOptions): Hono<AppEnv> {
  const dependencies: PaymentVaultDependencies = {
    serviceAuthenticator: options.serviceAuthenticator,
    paymentMethodStore: options.paymentMethodStore,
    authorizationStore: options.authorizationStore,
    hostedSetupSessionStore: options.hostedSetupSessionStore,
    idempotencyStore: options.idempotencyStore,
    yunoRouter: options.yunoRouter,
    hostedBaseUrl: options.hostedBaseUrl,
    allowedHostedReturnOrigins: new Set(options.allowedHostedReturnOrigins ?? []),
    hostedSetupTtlMs: options.hostedSetupTtlMs ?? 5 * 60_000,
    now: options.now ?? (() => new Date()),
    idGenerator: options.idGenerator ?? randomUUID,
  };
  validateConfiguration(dependencies);

  const app = new Hono<AppEnv>();
  app.use('*', async (context, next) => {
    const requestId = validRequestId(context.req.header('x-request-id'))
      ? context.req.header('x-request-id')!
      : `req_${dependencies.idGenerator().replaceAll('-', '')}`;
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

  app.get('/health', (context) =>
    context.json({ status: 'ok', service: 'payment-vault', paymentRails: 'test-only' }),
  );

  app.get('/hosted/test-payment-methods/setup', async (context) => {
    const sessionId = context.req.query('session_id');
    if (!sessionId || !HostedSetupSessionIdSchema.safeParse(sessionId).success) {
      return apiError(
        context,
        400,
        'SETUP_SESSION_REQUIRED',
        'A valid hosted setup session is required.',
      );
    }

    const session = await dependencies.hostedSetupSessionStore.get({
      sessionId,
      now: dependencies.now(),
    });
    if (!session) {
      return apiError(
        context,
        404,
        'SETUP_SESSION_NOT_FOUND',
        'The hosted setup session does not exist.',
      );
    }
    if (session.status === 'expired') {
      return apiError(
        context,
        410,
        'SETUP_SESSION_EXPIRED',
        'The hosted setup session has expired.',
      );
    }
    if (session.status !== 'pending') {
      return apiError(
        context,
        409,
        'SETUP_SESSION_ALREADY_COMPLETED',
        'The hosted setup session has already been completed.',
      );
    }

    return context.html(renderHostedSetupPage(session));
  });

  app.post('/hosted/test-payment-methods/setup', async (context) => {
    const form = await parseHostedSetupForm(context);
    if (!form.ok) {
      return form.response;
    }

    const result = await dependencies.hostedSetupSessionStore.complete({
      sessionId: form.value.sessionId,
      fixture: form.value.fixture,
      now: dependencies.now(),
      setupCode: createOpaqueId('setup_', dependencies.idGenerator),
      createPaymentMethod: () =>
        dependencies.paymentMethodStore.createTestMethod({
          fixture: form.value.fixture,
          createdAt: dependencies.now().toISOString(),
        }),
    });

    switch (result.kind) {
      case 'completed':
        return context.redirect(
          callbackUrlForCompletedSetup(result.session, result.setupCode),
          303,
        );
      case 'not_found':
        return apiError(
          context,
          404,
          'SETUP_SESSION_NOT_FOUND',
          'The hosted setup session does not exist.',
        );
      case 'expired':
        return apiError(
          context,
          410,
          'SETUP_SESSION_EXPIRED',
          'The hosted setup session has expired.',
        );
      case 'not_pending':
        return apiError(
          context,
          409,
          'SETUP_SESSION_ALREADY_COMPLETED',
          'The hosted setup session has already been completed.',
        );
    }
  });

  app.post('/internal/v1/hosted-setup-sessions', async (context) => {
    const authenticated = await authenticateMandateService(context, dependencies);
    if (!authenticated.ok) {
      return authenticated.response;
    }
    const idempotencyKey = requireIdempotencyKey(context);
    if (!idempotencyKey.ok) {
      return idempotencyKey.response;
    }
    const parsed = parseJson(
      context,
      authenticated.rawBody,
      CreateHostedSetupSessionRequestSchema,
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    if (!isAllowedHostedReturnUrl(parsed.value.returnUrl, dependencies)) {
      return apiError(
        context,
        422,
        'RETURN_URL_NOT_ALLOWED',
        'The hosted setup return URL is not allowlisted.',
      );
    }

    const execution = await dependencies.idempotencyStore.execute(
      `hosted-setup-sessions:${authenticated.actor.serviceId}`,
      idempotencyKey.value,
      requestFingerprint(parsed.value),
      async () => {
        const now = dependencies.now();
        const session = await dependencies.hostedSetupSessionStore.create({
          id: createOpaqueId('hs_', dependencies.idGenerator),
          returnUrl: parsed.value.returnUrl,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + dependencies.hostedSetupTtlMs).toISOString(),
        });
        return {
          status: 201,
          body: {
            hostedSetupSession: {
              id: session.id,
              setupUrl: hostedSetupUrl(session.id, dependencies),
              expiresAt: session.expiresAt,
            },
          },
        };
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

  app.post('/internal/v1/hosted-setup-sessions/:sessionId/exchange', async (context) => {
    const authenticated = await authenticateMandateService(context, dependencies);
    if (!authenticated.ok) {
      return authenticated.response;
    }
    const idempotencyKey = requireIdempotencyKey(context);
    if (!idempotencyKey.ok) {
      return idempotencyKey.response;
    }
    const parsed = parseJson(
      context,
      authenticated.rawBody,
      ExchangeHostedSetupSessionRequestSchema,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const sessionId = context.req.param('sessionId');
    if (!HostedSetupSessionIdSchema.safeParse(sessionId).success) {
      return apiError(
        context,
        404,
        'SETUP_SESSION_NOT_FOUND',
        'The hosted setup session does not exist.',
      );
    }
    const execution = await dependencies.idempotencyStore.execute(
      `hosted-setup-sessions:${sessionId}:exchange:${authenticated.actor.serviceId}`,
      idempotencyKey.value,
      requestFingerprint(parsed.value),
      () => exchangeHostedSetupSession(context, sessionId, parsed.value.setupCode, dependencies),
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

  app.post('/internal/v1/payment-methods/test', async (context) => {
    const authenticated = await authenticateMandateService(context, dependencies);
    if (!authenticated.ok) {
      return authenticated.response;
    }

    const idempotencyKey = requireIdempotencyKey(context);
    if (!idempotencyKey.ok) {
      return idempotencyKey.response;
    }

    const parsed = parseJson(context, authenticated.rawBody, CreateTestPaymentMethodRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const execution = await dependencies.idempotencyStore.execute(
      `payment-methods:${authenticated.actor.serviceId}`,
      idempotencyKey.value,
      requestFingerprint(parsed.value),
      async () => {
        const method = await dependencies.paymentMethodStore.createTestMethod({
          fixture: parsed.value.fixture,
          createdAt: dependencies.now().toISOString(),
        });
        return {
          status: 201,
          body: { paymentMethod: toPaymentMethodSummary(method) },
        };
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

  app.post('/internal/v1/payment-authorizations', async (context) => {
    const authenticated = await authenticateMandateService(context, dependencies);
    if (!authenticated.ok) {
      return authenticated.response;
    }

    const idempotencyKey = requireIdempotencyKey(context);
    if (!idempotencyKey.ok) {
      return idempotencyKey.response;
    }

    const parsed = parseJson(
      context,
      authenticated.rawBody,
      CreatePaymentAuthorizationRequestSchema,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const execution = await dependencies.idempotencyStore.execute(
      `payment-authorizations:${authenticated.actor.serviceId}`,
      idempotencyKey.value,
      requestFingerprint(parsed.value),
      () => createAuthorization(context, parsed.value, idempotencyKey.value, dependencies),
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

  app.get('/internal/v1/payment-authorizations/:authorizationId', async (context) => {
    const authenticated = await authenticateMandateService(context, dependencies);
    if (!authenticated.ok) {
      return authenticated.response;
    }

    const authorizationId = context.req.param('authorizationId');
    const response = await dependencies.authorizationStore.withAuthorizationLock(
      authorizationId,
      async (current) => {
        if (!current) {
          return {
            value: errorResponse(
              context,
              404,
              'PAYMENT_AUTHORIZATION_NOT_FOUND',
              'The payment authorization does not exist.',
            ),
          };
        }

        if (!shouldReconcileOnRead(current.status)) {
          return { value: authorizationResponse(current) };
        }

        const reconciled = await reconcileAuthorization(current, dependencies);
        return {
          value: authorizationResponse(reconciled),
          next: reconciled,
        };
      },
    );

    return respondStored(context, response);
  });

  app.post('/internal/v1/payment-authorizations/:authorizationId/capture', async (context) => {
    const authenticated = await authenticateMandateService(context, dependencies);
    if (!authenticated.ok) {
      return authenticated.response;
    }

    const idempotencyKey = requireIdempotencyKey(context);
    if (!idempotencyKey.ok) {
      return idempotencyKey.response;
    }
    const parsed = parseJson(context, authenticated.rawBody, EmptyRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const authorizationId = context.req.param('authorizationId');
    const execution = await dependencies.idempotencyStore.execute(
      `payment-authorizations:${authorizationId}:capture:${authenticated.actor.serviceId}`,
      idempotencyKey.value,
      requestFingerprint(parsed.value),
      () => captureAuthorization(context, authorizationId, idempotencyKey.value, dependencies),
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

  app.post('/internal/v1/payment-authorizations/:authorizationId/void', async (context) => {
    const authenticated = await authenticateMandateService(context, dependencies);
    if (!authenticated.ok) {
      return authenticated.response;
    }

    const idempotencyKey = requireIdempotencyKey(context);
    if (!idempotencyKey.ok) {
      return idempotencyKey.response;
    }
    const parsed = parseJson(context, authenticated.rawBody, EmptyRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }

    const authorizationId = context.req.param('authorizationId');
    const execution = await dependencies.idempotencyStore.execute(
      `payment-authorizations:${authorizationId}:void:${authenticated.actor.serviceId}`,
      idempotencyKey.value,
      requestFingerprint(parsed.value),
      () => voidAuthorization(context, authorizationId, idempotencyKey.value, dependencies),
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

  app.notFound((context) =>
    apiError(context, 404, 'ROUTE_NOT_FOUND', 'The requested route does not exist.'),
  );
  app.onError((_error, context) =>
    apiError(context, 500, 'INTERNAL_ERROR', 'The payment Vault could not process the request.'),
  );

  return app;
}

async function exchangeHostedSetupSession(
  context: Context<AppEnv>,
  sessionId: string,
  setupCode: string,
  dependencies: PaymentVaultDependencies,
): Promise<StoredResponse> {
  const result = await dependencies.hostedSetupSessionStore.exchange({
    sessionId,
    setupCode,
    now: dependencies.now(),
  });

  switch (result.kind) {
    case 'not_found':
      return errorResponse(
        context,
        404,
        'SETUP_SESSION_NOT_FOUND',
        'The hosted setup session does not exist.',
      );
    case 'expired':
      return errorResponse(
        context,
        410,
        'SETUP_SESSION_EXPIRED',
        'The hosted setup session has expired.',
      );
    case 'not_completed':
      return errorResponse(
        context,
        409,
        'SETUP_SESSION_NOT_COMPLETED',
        'The hosted setup session has not been completed.',
      );
    case 'already_exchanged':
      return errorResponse(
        context,
        409,
        'SETUP_CODE_ALREADY_EXCHANGED',
        'The hosted setup code was already exchanged.',
      );
    case 'invalid_code':
      return errorResponse(
        context,
        409,
        'SETUP_CODE_INVALID',
        'The hosted setup code is invalid.',
      );
    case 'exchanged': {
      const paymentMethod = await dependencies.paymentMethodStore.get(result.paymentMethodId);
      if (!paymentMethod) {
        return errorResponse(
          context,
          500,
          'PAYMENT_METHOD_LOST',
          'The completed payment method could not be loaded.',
        );
      }
      return {
        status: 200,
        body: { paymentMethod: toPaymentMethodSummary(paymentMethod) },
      };
    }
  }
}

async function createAuthorization(
  context: Context<AppEnv>,
  request: CreatePaymentAuthorizationRequest,
  idempotencyKey: string,
  dependencies: PaymentVaultDependencies,
): Promise<StoredResponse> {
  const paymentMethod = await dependencies.paymentMethodStore.get(request.paymentMethodId);
  if (!paymentMethod) {
    return errorResponse(
      context,
      404,
      'PAYMENT_METHOD_NOT_FOUND',
      'The requested payment method does not exist.',
    );
  }
  if (paymentMethod.status !== 'active') {
    return errorResponse(
      context,
      409,
      'PAYMENT_METHOD_DISABLED',
      'The requested payment method is not active.',
    );
  }

  const timestamp = dependencies.now().toISOString();
  const authorization: VaultPaymentAuthorization = {
    id: createOpaqueId('pa_', dependencies.idGenerator),
    operationId: request.operationId,
    paymentMethodId: request.paymentMethodId,
    amountMinor: request.amountMinor,
    currency: request.currency,
    merchantReference: request.merchantReference,
    status: 'authorization_pending',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const created = await dependencies.authorizationStore.create(authorization);

  if (created.kind === 'conflict') {
    return errorResponse(
      context,
      409,
      'PAYMENT_OPERATION_CONFLICT',
      'This operation id is already bound to a different payment request.',
    );
  }
  if (created.kind === 'existing') {
    return authorizationResponse(created.authorization);
  }

  let yunoResult: Awaited<ReturnType<MockYunoRouter['authorize']>>;
  try {
    yunoResult = await dependencies.yunoRouter.authorize({
      authorizationId: created.authorization.id,
      operationId: created.authorization.operationId,
      providerTokenRef: paymentMethod.providerTokenRef,
      amountMinor: created.authorization.amountMinor,
      currency: created.authorization.currency,
      merchantReference: created.authorization.merchantReference,
      idempotencyKey,
    });
  } catch {
    yunoResult = {
      outcome: 'reconciliation_required',
      gatewayId: 'card-gateway-a',
      reasonCode: 'AUTHORIZATION_STATUS_UNKNOWN',
    };
  }

  return dependencies.authorizationStore.withAuthorizationLock(
    created.authorization.id,
    async (current) => {
      if (!current) {
        return {
          value: errorResponse(
            context,
            500,
            'PAYMENT_AUTHORIZATION_LOST',
            'The payment authorization could not be persisted.',
          ),
        };
      }
      if (current.status !== 'authorization_pending') {
        return { value: authorizationResponse(current) };
      }

      const updated = applyAuthorizationResult(current, yunoResult, dependencies.now());
      return {
        value: authorizationResponse(
          updated,
          updated.status === 'reconciliation_required' ? undefined : 201,
        ),
        next: updated,
      };
    },
  );
}

type CaptureClaim =
  | { kind: 'claimed'; authorization: VaultPaymentAuthorization }
  | { kind: 'response'; response: StoredResponse };

async function captureAuthorization(
  context: Context<AppEnv>,
  authorizationId: string,
  idempotencyKey: string,
  dependencies: PaymentVaultDependencies,
): Promise<StoredResponse> {
  const claim = await dependencies.authorizationStore.withAuthorizationLock(
    authorizationId,
    async (current): Promise<PaymentAuthorizationLockResult<CaptureClaim>> => {
      if (!current) {
        return {
          value: {
            kind: 'response',
            response: errorResponse(
              context,
              404,
              'PAYMENT_AUTHORIZATION_NOT_FOUND',
              'The payment authorization does not exist.',
            ),
          },
        };
      }
      if (current.status === 'captured') {
        return { value: { kind: 'response', response: authorizationResponse(current) } };
      }
      if (current.status === 'capture_pending') {
        return { value: { kind: 'response', response: authorizationResponse(current) } };
      }
      if (current.status !== 'authorized') {
        return {
          value: {
            kind: 'response',
            response: invalidCaptureStateResponse(context, current),
          },
        };
      }

      const pending = transitionAuthorization(current, 'capture_pending', dependencies.now());
      return {
        value: { kind: 'claimed', authorization: pending },
        next: pending,
      };
    },
  );

  if (claim.kind === 'response') {
    return claim.response;
  }

  let yunoResult: MockYunoCaptureResult;
  try {
    yunoResult = await dependencies.yunoRouter.capture({
      authorizationId: claim.authorization.id,
      operationId: claim.authorization.operationId,
      idempotencyKey,
    });
  } catch {
    yunoResult = {
      outcome: 'reconciliation_required',
      gatewayId: claim.authorization.gatewayId ?? 'card-gateway-a',
      reasonCode: 'CAPTURE_STATUS_UNKNOWN',
    };
  }

  return dependencies.authorizationStore.withAuthorizationLock(
    authorizationId,
    async (current) => {
      if (!current) {
        return {
          value: errorResponse(
            context,
            500,
            'PAYMENT_AUTHORIZATION_LOST',
            'The payment authorization could not be persisted.',
          ),
        };
      }
      if (current.status !== 'capture_pending') {
        return { value: authorizationResponse(current) };
      }

      const updated = applyCaptureResult(current, yunoResult, dependencies.now());
      return {
        value: authorizationResponse(updated, statusForCaptureResult(yunoResult)),
        next: updated,
      };
    },
  );
}

type VoidClaim =
  | { kind: 'claimed'; authorization: VaultPaymentAuthorization }
  | { kind: 'response'; response: StoredResponse };

async function voidAuthorization(
  context: Context<AppEnv>,
  authorizationId: string,
  idempotencyKey: string,
  dependencies: PaymentVaultDependencies,
): Promise<StoredResponse> {
  const claim = await dependencies.authorizationStore.withAuthorizationLock(
    authorizationId,
    async (current): Promise<PaymentAuthorizationLockResult<VoidClaim>> => {
      if (!current) {
        return {
          value: {
            kind: 'response',
            response: errorResponse(
              context,
              404,
              'PAYMENT_AUTHORIZATION_NOT_FOUND',
              'The payment authorization does not exist.',
            ),
          },
        };
      }
      if (current.status === 'voided') {
        return { value: { kind: 'response', response: authorizationResponse(current) } };
      }
      if (current.status === 'void_pending') {
        return { value: { kind: 'response', response: authorizationResponse(current) } };
      }
      // A capture has already been handed to the gateway. Do not race a
      // second gateway mutation against it: reconciliation determines the
      // terminal state before any later refund/dispute workflow is considered.
      if (current.status === 'capture_pending') {
        return { value: { kind: 'response', response: authorizationResponse(current) } };
      }
      if (current.status === 'captured') {
        return {
          value: {
            kind: 'response',
            response: errorResponse(
              context,
              409,
              'CAPTURE_ALREADY_FINAL',
              'A captured payment cannot be voided.',
            ),
          },
        };
      }
      if (current.status === 'declined') {
        return {
          value: {
            kind: 'response',
            response: errorResponse(
              context,
              409,
              'NO_AUTHORIZATION_TO_VOID',
              'A declined payment has no authorization to void.',
            ),
          },
        };
      }
      if (current.status === 'authorization_pending') {
        return {
          value: {
            kind: 'response',
            response: errorResponse(
              context,
              409,
              'AUTHORIZATION_PENDING',
              'The authorization result is not available yet.',
            ),
          },
        };
      }

      const pending = transitionAuthorization(current, 'void_pending', dependencies.now());
      return {
        value: { kind: 'claimed', authorization: pending },
        next: pending,
      };
    },
  );

  if (claim.kind === 'response') {
    return claim.response;
  }

  let yunoResult: MockYunoVoidResult;
  try {
    yunoResult = await dependencies.yunoRouter.void({
      authorizationId: claim.authorization.id,
      operationId: claim.authorization.operationId,
      idempotencyKey,
    });
  } catch {
    yunoResult = {
      outcome: 'reconciliation_required',
      gatewayId: claim.authorization.gatewayId ?? 'card-gateway-a',
      reasonCode: 'VOID_STATUS_UNKNOWN',
    };
  }

  return dependencies.authorizationStore.withAuthorizationLock(
    authorizationId,
    async (current) => {
      if (!current) {
        return {
          value: errorResponse(
            context,
            500,
            'PAYMENT_AUTHORIZATION_LOST',
            'The payment authorization could not be persisted.',
          ),
        };
      }
      if (current.status !== 'void_pending') {
        return { value: authorizationResponse(current) };
      }

      const updated = applyVoidResult(current, yunoResult, dependencies.now());
      return {
        value: authorizationResponse(updated, statusForVoidResult(yunoResult)),
        next: updated,
      };
    },
  );
}

async function reconcileAuthorization(
  authorization: VaultPaymentAuthorization,
  dependencies: PaymentVaultDependencies,
): Promise<VaultPaymentAuthorization> {
  let status: MockYunoStatusResult;
  try {
    status = await dependencies.yunoRouter.getAuthorizationStatus({
      authorizationId: authorization.id,
      operationId: authorization.operationId,
    });
  } catch {
    status = {
      outcome: 'unknown',
      gatewayId: authorization.gatewayId ?? 'card-gateway-a',
      reasonCode: 'AUTHORIZATION_STATUS_UNKNOWN',
    };
  }

  if (authorization.status === 'capture_pending' && status.outcome === 'authorized') {
    return authorization;
  }
  if (authorization.status === 'void_pending' && status.outcome === 'authorized') {
    return authorization;
  }

  switch (status.outcome) {
    case 'authorized':
      return transitionAuthorization(
        authorization,
        'authorized',
        dependencies.now(),
        status.gatewayId,
      );
    case 'declined':
      return transitionAuthorization(
        authorization,
        'declined',
        dependencies.now(),
        status.gatewayId,
        status.reasonCode ?? 'GATEWAY_DECLINED',
      );
    case 'captured':
      return transitionAuthorization(
        authorization,
        'captured',
        dependencies.now(),
        status.gatewayId,
      );
    case 'voided':
      return transitionAuthorization(
        authorization,
        'voided',
        dependencies.now(),
        status.gatewayId,
      );
    case 'unknown':
      return transitionAuthorization(
        authorization,
        'reconciliation_required',
        dependencies.now(),
        status.gatewayId,
        status.reasonCode ?? 'AUTHORIZATION_STATUS_UNKNOWN',
      );
  }
}

async function authenticateMandateService(
  context: Context<AppEnv>,
  dependencies: PaymentVaultDependencies,
): Promise<
  | { ok: true; actor: AuthenticatedVaultService; rawBody: Uint8Array }
  | { ok: false; response: Response }
> {
  const rawBody = new Uint8Array(await context.req.raw.clone().arrayBuffer());
  const result = await dependencies.serviceAuthenticator.authenticate({
    request: context.req.raw,
    rawBody,
    requiredAudience: PAYMENT_VAULT_AUDIENCE,
  });

  if (!result.ok) {
    const status: 401 | 503 = result.code === 'AUTHENTICATION_UNAVAILABLE' ? 503 : 401;
    return { ok: false, response: apiError(context, status, result.code, result.message) };
  }

  if (result.actor.serviceId !== MANDATE_SERVICE_ID) {
    return {
      ok: false,
      response: apiError(
        context,
        401,
        'SERVICE_PROOF_INVALID',
        'The Mandate-service request proof is invalid.',
      ),
    };
  }

  return { ok: true, actor: result.actor, rawBody };
}

async function parseHostedSetupForm(
  context: Context<AppEnv>,
): Promise<
  | { ok: true; value: { sessionId: string; fixture: TestPaymentMethodFixture } }
  | { ok: false; response: Response }
> {
  if (!context.req.header('content-type')?.toLowerCase().includes('application/x-www-form-urlencoded')) {
    return {
      ok: false,
      response: apiError(
        context,
        400,
        'CONTENT_TYPE_REQUIRED',
        'Content-Type must be application/x-www-form-urlencoded.',
      ),
    };
  }

  const fields = new URLSearchParams(await context.req.raw.clone().text());
  const allowedFieldNames = new Set(['session_id', 'fixture']);
  const suppliedFieldNames = [...fields.keys()];
  const sessionIds = fields.getAll('session_id');
  const fixtures = fields.getAll('fixture');
  if (
    suppliedFieldNames.some((fieldName) => !allowedFieldNames.has(fieldName)) ||
    sessionIds.length !== 1 ||
    fixtures.length !== 1
  ) {
    return {
      ok: false,
      response: apiError(context, 422, 'INVALID_REQUEST', 'The hosted setup form is invalid.'),
    };
  }

  const sessionId = sessionIds[0];
  const fixture = fixtures[0];
  const parsedSessionId = HostedSetupSessionIdSchema.safeParse(sessionId);
  const parsedFixture = TestPaymentMethodFixtureSchema.safeParse(fixture);
  if (!parsedSessionId.success || !parsedFixture.success) {
    return {
      ok: false,
      response: apiError(context, 422, 'INVALID_REQUEST', 'The hosted setup form is invalid.'),
    };
  }

  return {
    ok: true,
    value: { sessionId: parsedSessionId.data, fixture: parsedFixture.data },
  };
}

function parseJson<T>(
  context: Context<AppEnv>,
  rawBody: Uint8Array,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; response: Response } {
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

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    body = undefined;
  }
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

function isAllowedHostedReturnUrl(
  value: string,
  dependencies: PaymentVaultDependencies,
): boolean {
  try {
    const returnUrl = new URL(value);
    return (
      returnUrl.protocol === 'https:' &&
      dependencies.allowedHostedReturnOrigins.has(returnUrl.origin)
    );
  } catch {
    return false;
  }
}

function hostedSetupUrl(sessionId: string, dependencies: PaymentVaultDependencies): string {
  const url = new URL('/hosted/test-payment-methods/setup', dependencies.hostedBaseUrl);
  url.searchParams.set('session_id', sessionId);
  return url.toString();
}

function callbackUrlForCompletedSetup(session: HostedSetupSession, setupCode: string): string {
  const url = new URL(session.returnUrl);
  url.searchParams.set('setup_session_id', session.id);
  url.searchParams.set('setup_code', setupCode);
  return url.toString();
}

function renderHostedSetupPage(session: HostedSetupSession): string {
  const escapedSessionId = escapeHtml(session.id);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Choose a test payment method</title>
  </head>
  <body>
    <main>
      <h1>Choose a test payment method</h1>
      <p>This hosted test screen only permits the listed fixtures.</p>
      <form method="post" action="/hosted/test-payment-methods/setup">
        <input type="hidden" name="session_id" value="${escapedSessionId}">
        <label for="fixture">Test method</label>
        <select id="fixture" name="fixture" required>
          <option value="visa_4242">Visa ending in 4242</option>
          <option value="mastercard_4444">Mastercard ending in 4444</option>
        </select>
        <button type="submit">Continue</button>
      </form>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function shouldReconcileOnRead(status: PaymentAuthorizationStatus): boolean {
  return (
    status === 'authorization_pending' ||
    status === 'reconciliation_required' ||
    status === 'capture_pending' ||
    status === 'void_pending'
  );
}

function applyAuthorizationResult(
  authorization: VaultPaymentAuthorization,
  result: Awaited<ReturnType<MockYunoRouter['authorize']>>,
  now: Date,
): VaultPaymentAuthorization {
  switch (result.outcome) {
    case 'authorized':
      return transitionAuthorization(authorization, 'authorized', now, result.gatewayId);
    case 'declined':
      return transitionAuthorization(
        authorization,
        'declined',
        now,
        result.gatewayId,
        result.reasonCode ?? 'GATEWAY_DECLINED',
      );
    case 'reconciliation_required':
      return transitionAuthorization(
        authorization,
        'reconciliation_required',
        now,
        result.gatewayId,
        result.reasonCode ?? 'AUTHORIZATION_STATUS_UNKNOWN',
      );
  }
}

function applyCaptureResult(
  authorization: VaultPaymentAuthorization,
  result: MockYunoCaptureResult,
  now: Date,
): VaultPaymentAuthorization {
  switch (result.outcome) {
    case 'captured':
      return transitionAuthorization(authorization, 'captured', now, result.gatewayId);
    case 'failed':
      return transitionAuthorization(
        authorization,
        'failed',
        now,
        result.gatewayId,
        result.reasonCode ?? 'CAPTURE_FAILED',
      );
    case 'reconciliation_required':
      return transitionAuthorization(
        authorization,
        'reconciliation_required',
        now,
        result.gatewayId,
        result.reasonCode ?? 'CAPTURE_STATUS_UNKNOWN',
      );
  }
}

function applyVoidResult(
  authorization: VaultPaymentAuthorization,
  result: MockYunoVoidResult,
  now: Date,
): VaultPaymentAuthorization {
  switch (result.outcome) {
    case 'voided':
      return transitionAuthorization(authorization, 'voided', now, result.gatewayId);
    case 'failed':
      return transitionAuthorization(
        authorization,
        'failed',
        now,
        result.gatewayId,
        result.reasonCode ?? 'VOID_FAILED',
      );
    case 'reconciliation_required':
      return transitionAuthorization(
        authorization,
        'reconciliation_required',
        now,
        result.gatewayId,
        result.reasonCode ?? 'VOID_STATUS_UNKNOWN',
      );
  }
}

function transitionAuthorization(
  authorization: VaultPaymentAuthorization,
  status: PaymentAuthorizationStatus,
  now: Date,
  gatewayId?: 'card-gateway-a' | 'card-gateway-b',
  reasonCode?: string,
): VaultPaymentAuthorization {
  const { gatewayId: existingGatewayId, reasonCode: _existingReasonCode, ...rest } = authorization;
  const next: VaultPaymentAuthorization = {
    ...rest,
    status,
    updatedAt: now.toISOString(),
  };
  const resolvedGatewayId = gatewayId ?? existingGatewayId;
  if (resolvedGatewayId) {
    next.gatewayId = resolvedGatewayId;
  }
  if (reasonCode) {
    next.reasonCode = reasonCode;
  }
  return next;
}

function invalidCaptureStateResponse(
  context: Context<AppEnv>,
  authorization: VaultPaymentAuthorization,
): StoredResponse {
  const code =
    authorization.status === 'reconciliation_required'
      ? 'RECONCILIATION_REQUIRED'
      : authorization.status === 'voided'
        ? 'AUTHORIZATION_VOIDED'
        : authorization.status === 'declined'
          ? 'AUTHORIZATION_DECLINED'
          : authorization.status === 'failed'
            ? 'CAPTURE_PREVIOUSLY_FAILED'
            : 'AUTHORIZATION_NOT_CAPTURABLE';
  return errorResponse(context, 409, code, 'This authorization cannot be captured in its current state.');
}

function authorizationResponse(
  authorization: VaultPaymentAuthorization,
  successStatus?: 200 | 201 | 202 | 502,
): StoredResponse {
  const status =
    successStatus ??
    (authorization.status === 'authorization_pending' ||
    authorization.status === 'reconciliation_required' ||
    authorization.status === 'capture_pending' ||
    authorization.status === 'void_pending'
      ? 202
      : 200);
  return {
    status,
    body: { paymentAuthorization: toAuthorizationSummary(authorization) },
  };
}

function statusForCaptureResult(result: MockYunoCaptureResult): 200 | 202 | 502 {
  switch (result.outcome) {
    case 'captured':
      return 200;
    case 'failed':
      return 502;
    case 'reconciliation_required':
      return 202;
  }
}

function statusForVoidResult(result: MockYunoVoidResult): 200 | 202 | 502 {
  switch (result.outcome) {
    case 'voided':
      return 200;
    case 'failed':
      return 502;
    case 'reconciliation_required':
      return 202;
  }
}

function errorResponse(
  context: Context<AppEnv>,
  status: ErrorStatus,
  code: string,
  message: string,
): StoredResponse {
  return { status, body: apiErrorBody(context, code, message) };
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

function createOpaqueId(prefix: string, idGenerator: () => string): string {
  return `${prefix}${idGenerator().replaceAll('-', '')}`;
}

function validateConfiguration(dependencies: PaymentVaultDependencies): void {
  if (
    !dependencies.serviceAuthenticator ||
    !dependencies.paymentMethodStore ||
    !dependencies.authorizationStore ||
    !dependencies.idempotencyStore ||
    !dependencies.yunoRouter
  ) {
    throw new Error(
      'Payment Vault requires authenticated, isolated, and durable runtime adapters.',
    );
  }
}
