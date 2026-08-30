import {
  AgentIntentResultSchema,
  ApiErrorSchema,
  IdempotencyKeySchema,
  MerchantVerificationRequestSchema,
  MandateRevocationResponseSchema,
  OpaqueIdSchema,
  PurchaseCapabilityPayloadSchema,
  SubmitPurchaseIntentRequestSchema,
  VerificationResultSchema,
  type AgentIntentResult,
  type Mandate,
  type MerchantVerificationRequest,
  type ReasonCode,
  type VerificationReceiptPayload,
  type VerificationResult,
} from '@agentic-mandates/contracts';
import { requestFingerprint, sha256Base64Url } from '@agentic-mandates/domain';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { mandateStatusForVerification, evaluatePolicy } from './policy.js';
import { signPurchaseCapability, signVerificationReceipt, verifyPurchaseCapability } from './proofs.js';
import { loadVerifiedQuote } from './quote-verification.js';
import type {
  AuthenticationFailure,
  IdempotencyStore,
  MandateApiOptions,
  MerchantVerificationOutcome,
  PaymentAuthorizationResult,
  StoredCapability,
  StoredHttpResponse,
} from './types.js';

const DEFAULT_CAPABILITY_TTL_MS = 2 * 60_000;

type IntentResult = AgentIntentResult;

/**
 * Construct the authorization core only. Callers must inject real request
 * authenticators, registry/quote adapters, state transactions, and a Vault
 * client before deploying it. There are no implicit credentials or approval
 * paths in this module.
 */
export function createMandateApiApp(options: MandateApiOptions): Hono {
  assertOptions(options);
  const capabilityTtlMs = options.capabilityTtlMs ?? DEFAULT_CAPABILITY_TTL_MS;
  const app = new Hono();

  app.use(
    '*',
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (context) =>
        apiError(
          options,
          requestIdFor(context.req.raw, options),
          413,
          'REQUEST_TOO_LARGE',
          'The request body exceeds 16 KiB.',
        ),
    }),
  );

  app.get('/health', (context) => jsonResponse({ ok: true }, 200));

  app.post('/v1/agent/intents', async (context) => {
    const requestId = requestIdFor(context.req.raw, options);
    const requestData = await readJsonRequest(context.req.raw);
    if (!requestData.ok) {
      return apiError(options, requestId, requestData.status, requestData.code, requestData.message);
    }

    const authentication = await authenticateAgent(options, context.req.raw, requestData.rawBody);
    if (!authentication.ok) {
      return authenticationError(options, requestId, authentication);
    }

    const input = SubmitPurchaseIntentRequestSchema.safeParse(requestData.body);
    if (!input.success) {
      return apiError(
        options,
        requestId,
        400,
        'INVALID_REQUEST',
        'The purchase intent does not match the public contract.',
      );
    }
    const idempotencyKey = idempotencyKeyFrom(context.req.raw);
    if (!idempotencyKey) {
      return apiError(
        options,
        requestId,
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key is required for a purchase intent.',
      );
    }

    const execution = await executeIdempotently(
      options.intentIdempotencyStore,
      `agent-intent:${authentication.actor.agentId}:${input.data.mandateId}`,
      idempotencyKey,
      requestFingerprint(input.data),
      async () => ({
        status: 200,
        body: await issuePurchaseCapability({
          options,
          request: input.data,
          agentId: authentication.actor.agentId,
          capabilityTtlMs,
        }),
      }),
    );
    if (execution.kind === 'conflict') {
      return apiError(
        options,
        requestId,
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency-Key was already used with a different purchase intent.',
      );
    }
    return storedJsonResponse(execution.response, execution.kind === 'replayed');
  });

  app.post('/v1/merchant/verifications', async (context) => {
    const merchantRequestId = merchantRequestIdFor(context.req.raw);
    const fallbackRequestId = merchantRequestId ?? requestIdFor(context.req.raw, options);
    const requestData = await readJsonRequest(context.req.raw);
    if (!requestData.ok) {
      return apiError(
        options,
        fallbackRequestId,
        requestData.status,
        requestData.code,
        requestData.message,
      );
    }
    if (!merchantRequestId) {
      return apiError(
        options,
        fallbackRequestId,
        400,
        'INVALID_REQUEST',
        'X-Request-Id is required for a merchant verification receipt.',
      );
    }

    const request = parseMerchantVerificationRequest(requestData.body);
    if (!request) {
      return apiError(
        options,
        merchantRequestId,
        400,
        'INVALID_REQUEST',
        'The merchant verification does not match the public contract.',
      );
    }
    const authentication = await authenticateMerchant(options, context.req.raw, requestData.rawBody);
    if (!authentication.ok) {
      return authenticationError(options, merchantRequestId, authentication);
    }
    if (authentication.actor.merchantId !== request.merchantId) {
      return apiError(
        options,
        merchantRequestId,
        403,
        'ACTOR_NOT_ALLOWED',
        'The authenticated merchant cannot verify for another merchant.',
      );
    }
    const idempotencyKey = idempotencyKeyFrom(context.req.raw);
    if (!idempotencyKey) {
      return apiError(
        options,
        merchantRequestId,
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key is required for merchant verification.',
      );
    }

    const execution = await executeIdempotently(
      options.verificationIdempotencyStore,
      `merchant-verification:${request.merchantId}:${request.merchantOrderRef}`,
      idempotencyKey,
      requestFingerprint(request),
      async () => ({
        status: 200,
        body: await verifyMerchantPurchase({
          options,
          request,
          requestId: merchantRequestId,
          capabilityTtlMs,
        }),
      }),
    );
    if (execution.kind === 'conflict') {
      return apiError(
        options,
        merchantRequestId,
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency-Key was already used with a different merchant verification.',
      );
    }
    return storedJsonResponse(execution.response, execution.kind === 'replayed');
  });

  app.post('/v1/mandates/:mandateId/revocations', async (context) => {
    const requestId = requestIdFor(context.req.raw, options);
    const mandateId = OpaqueIdSchema.safeParse(context.req.param('mandateId'));
    if (!mandateId.success) {
      return apiError(options, requestId, 400, 'INVALID_REQUEST', 'The mandate ID is invalid.');
    }

    const rawBody = new Uint8Array(await context.req.raw.arrayBuffer());
    const authentication = await authenticatePrincipal(options, context.req.raw, rawBody);
    if (!authentication.ok) {
      return authenticationError(options, requestId, authentication);
    }

    let result;
    try {
      result = await options.stateStore.revokeMandate({
        mandateId: mandateId.data,
        principalId: authentication.actor.principalId,
        now: options.now().toISOString(),
      });
    } catch {
      return apiError(
        options,
        requestId,
        503,
        'SERVICE_UNAVAILABLE',
        'Mandate revocation is temporarily unavailable.',
      );
    }
    if (!result.ok) {
      return apiError(
        options,
        requestId,
        result.reasonCode === 'MANDATE_NOT_FOUND' ? 404 : 403,
        result.reasonCode,
        result.reasonCode === 'MANDATE_NOT_FOUND'
          ? 'The mandate was not found.'
          : 'The authenticated principal cannot revoke this mandate.',
      );
    }
    await Promise.all(
      result.authorizationsToVoid.map(async (authorization) =>
        safelyVoidAuthorization(options, authorization),
      ),
    );
    return jsonResponse(
      MandateRevocationResponseSchema.parse({
        mandateId: result.mandate.id,
        status: result.mandate.status,
        revokedAt: result.mandate.revokedAt,
      }),
      200,
    );
  });

  app.post('/internal/v1/recurrence/tick', async (context) => {
    const requestId = requestIdFor(context.req.raw, options);
    const authHeader = context.req.raw.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

    if (!options.schedulerBearerSecret || !token || token !== options.schedulerBearerSecret) {
      return apiError(
        options,
        requestId,
        401,
        'ACTOR_NOT_ALLOWED',
        'A valid scheduler bearer token is required.',
      );
    }

    try {
      const outcome = options.recurrenceScheduler
        ? await options.recurrenceScheduler.tick({ now: options.now() })
        : { executedCount: 0, runs: [] };

      return jsonResponse(
        {
          ok: true,
          executedCount: outcome.executedCount,
          runs: outcome.runs,
        },
        200,
      );
    } catch (error) {
      console.error('Recurrence tick execution error', error);
      return apiError(
        options,
        requestId,
        500,
        'INTERNAL_ERROR',
        'Recurrence tick failed to execute.',
      );
    }
  });

  app.notFound((context) =>
    apiError(
      options,
      requestIdFor(context.req.raw, options),
      404,
      'ROUTE_NOT_FOUND',
      'The requested route does not exist.',
    ),
  );

  app.onError((error, context) => {
    console.error('Mandate API unexpected error', error);
    return apiError(
      options,
      requestIdFor(context.req.raw, options),
      500,
      'INTERNAL_ERROR',
      'The Mandate API could not process this request.',
    );
  });

  return app;
}

async function issuePurchaseCapability(input: {
  options: MandateApiOptions;
  request: { mandateId: string; merchantId: string; quoteId: string };
  agentId: string;
  capabilityTtlMs: number;
}): Promise<IntentResult> {
  const now = input.options.now();
  const mandate = await getMandate(input.options, input.request.mandateId);
  if (!mandate) {
    return rejectedIntent('MANDATE_NOT_FOUND', undefined, now);
  }

  const merchant = await getMerchant(input.options, input.request.merchantId);
  const verifiedQuote = await loadVerifiedQuote({
    merchant,
    quoteId: input.request.quoteId,
    quoteSource: input.options.merchantQuoteSource,
    taxonomyNormalizer: input.options.taxonomyNormalizer,
    now,
  });
  if (!verifiedQuote.ok) {
    return rejectedIntent(verifiedQuote.reasonCode, mandate, now);
  }
  if (!merchant) {
    return rejectedIntent('MERCHANT_NOT_REGISTERED', mandate, now);
  }

  const trustConstraint = await getTrustConstraint(input.options, mandate);
  if (!trustConstraint) {
    return rejectedIntent('SERVICE_UNAVAILABLE', mandate, now);
  }

  const usage = await input.options.stateStore.getUsage(mandate.id);
  const policy = evaluatePolicy({
    mandate,
    agentId: input.agentId,
    merchantId: input.request.merchantId,
    canonicalCategoryIds: verifiedQuote.value.canonicalCategoryIds,
    amountMinor: verifiedQuote.value.quote.totalMinor,
    currency: verifiedQuote.value.quote.currency,
    merchantTrustTier: merchant.trustTier,
    minimumMerchantTrustTier: trustConstraint.minimumMerchantTrustTier,
    usage,
    now,
  });
  if (policy.decision !== 'approved') {
    return AgentIntentResultSchema.parse({
      decision: policy.decision,
      reasonCode: policy.reasonCode,
      mandateStatus: mandateStatusForVerification(mandate, now),
    });
  }

  const expiresAt = new Date(now.getTime() + input.capabilityTtlMs).toISOString();
  const payload = PurchaseCapabilityPayloadSchema.parse({
    id: generatedId(input.options, 'cap_'),
    mandateId: mandate.id,
    mandateVersion: mandate.version,
    agentId: input.agentId,
    merchantId: verifiedQuote.value.quote.merchantId,
    quoteId: verifiedQuote.value.quote.id,
    canonicalCartHash: verifiedQuote.value.normalized.canonicalCartHash,
    maxAmountMinor: verifiedQuote.value.quote.totalMinor,
    currency: verifiedQuote.value.quote.currency,
    nonce: generatedId(input.options, 'nonce_'),
    expiresAt,
    oneTimeUse: true,
  });
  const purchaseCapability = await signPurchaseCapability(payload, input.options.capabilitySigningKey);
  const issue = await input.options.stateStore.issueCapability({
    capability: {
      payload,
      capabilityHash: sha256Base64Url(purchaseCapability),
      status: 'issued',
      issuedAt: now.toISOString(),
    },
    expectedMandateVersion: mandate.version,
    now: now.toISOString(),
  });
  if (!issue.ok) {
    return rejectedIntent(issue.reasonCode, mandate, now);
  }

  return AgentIntentResultSchema.parse({
    decision: 'approved',
    reasonCode: 'AUTHORIZED',
    mandateStatus: 'active',
    purchaseCapability,
    expiresAt,
  });
}

async function verifyMerchantPurchase(input: {
  options: MandateApiOptions;
  request: MerchantVerificationRequest;
  requestId: string;
  capabilityTtlMs: number;
}): Promise<VerificationResult> {
  const now = input.options.now();
  const capabilityHash = sha256Base64Url(input.request.purchaseCapability);
  const verifiedCapability = await verifyPurchaseCapability({
    capability: input.request.purchaseCapability,
    verificationKeys: input.options.capabilityVerificationKeys,
    now,
  });
  if (!verifiedCapability.ok) {
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      outcome: rejectedOutcome(verifiedCapability.reasonCode),
      mandate: undefined,
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }
  const capability = verifiedCapability.payload;
  if (capability.merchantId !== input.request.merchantId) {
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      outcome: rejectedOutcome('MERCHANT_MISMATCH'),
      mandate: await getMandate(input.options, capability.mandateId),
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }
  if (capability.quoteId !== input.request.quoteId) {
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      outcome: rejectedOutcome('ORDER_QUOTE_MISMATCH'),
      mandate: await getMandate(input.options, capability.mandateId),
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }

  const merchant = await getMerchant(input.options, input.request.merchantId);
  const verifiedQuote = await loadVerifiedQuote({
    merchant,
    quoteId: input.request.quoteId,
    quoteSource: input.options.merchantQuoteSource,
    taxonomyNormalizer: input.options.taxonomyNormalizer,
    now,
  });
  if (!verifiedQuote.ok) {
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      outcome: rejectedOutcome(verifiedQuote.reasonCode),
      mandate: await getMandate(input.options, capability.mandateId),
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }
  if (!merchant) {
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      outcome: rejectedOutcome('MERCHANT_NOT_REGISTERED'),
      mandate: await getMandate(input.options, capability.mandateId),
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }
  if (verifiedQuote.value.quote.merchantOrderRef !== input.request.merchantOrderRef) {
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      outcome: rejectedOutcome('ORDER_QUOTE_MISMATCH'),
      mandate: await getMandate(input.options, capability.mandateId),
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }
  if (
    capability.canonicalCartHash !== verifiedQuote.value.normalized.canonicalCartHash ||
    capability.currency !== verifiedQuote.value.quote.currency ||
    capability.maxAmountMinor !== verifiedQuote.value.quote.totalMinor
  ) {
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      outcome: rejectedOutcome('CART_CHANGED'),
      mandate: await getMandate(input.options, capability.mandateId),
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }

  const currentMandate = await getMandate(input.options, capability.mandateId);
  if (!currentMandate) {
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      outcome: rejectedOutcome('MANDATE_NOT_FOUND'),
      mandate: undefined,
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }
  const trustConstraint = await getTrustConstraint(input.options, currentMandate);
  if (!trustConstraint) {
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      outcome: rejectedOutcome('SERVICE_UNAVAILABLE'),
      mandate: currentMandate,
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }
  const currentUsage = await input.options.stateStore.getUsage(currentMandate.id);
  const currentPolicy = evaluatePolicy({
    mandate: currentMandate,
    agentId: capability.agentId,
    merchantId: input.request.merchantId,
    canonicalCategoryIds: verifiedQuote.value.canonicalCategoryIds,
    amountMinor: verifiedQuote.value.quote.totalMinor,
    currency: verifiedQuote.value.quote.currency,
    merchantTrustTier: merchant.trustTier,
    minimumMerchantTrustTier: trustConstraint.minimumMerchantTrustTier,
    usage: currentUsage,
    now,
  });
  if (currentPolicy.decision !== 'approved') {
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      outcome: rejectedOutcome(currentPolicy.reasonCode),
      mandate: currentMandate,
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }

  const storedCapability = await input.options.stateStore.getCapability({
    capabilityId: capability.id,
    capabilityHash,
  });
  if (
    storedCapability?.status === 'authorized' &&
    storedCapability.paymentOperationId !== undefined
  ) {
    return reconcilePendingVerification({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      capabilityId: capability.id,
      storedCapability,
      mandate: currentMandate,
      amountMinor: verifiedQuote.value.quote.totalMinor,
      currency: verifiedQuote.value.quote.currency,
      merchantReference: `${input.request.merchantId}:${input.request.merchantOrderRef}`,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }

  const paymentOperationId = generatedId(input.options, 'op_');
  const claim = await input.options.stateStore.claimCapability({
    capabilityId: capability.id,
    capabilityHash,
    paymentOperationId,
    now: now.toISOString(),
  });
  if (!claim.ok) {
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      outcome: rejectedOutcome(claim.reasonCode),
      mandate: await getMandate(input.options, capability.mandateId),
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }

  let authorization: PaymentAuthorizationResult;
  try {
    authorization = await input.options.paymentVault.authorize({
      paymentOperationId,
      paymentMethodId: claim.mandate.paymentMethodId,
      amountMinor: verifiedQuote.value.quote.totalMinor,
      currency: verifiedQuote.value.quote.currency,
      merchantReference: `${input.request.merchantId}:${input.request.merchantOrderRef}`,
      idempotencyKey: `authorize:${paymentOperationId}`,
    });
  } catch {
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash,
      outcome: pendingOutcome('PAYMENT_RECONCILIATION_REQUIRED', paymentOperationId),
      mandate: claim.mandate,
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }
  return settleAuthorizationResult({
    options: input.options,
    request: input.request,
    requestId: input.requestId,
    capabilityHash,
    capabilityId: capability.id,
    paymentOperationId,
    mandate: claim.mandate,
    authorization,
    capabilityTtlMs: input.capabilityTtlMs,
  });
}

async function reconcilePendingVerification(input: {
  options: MandateApiOptions;
  request: MerchantVerificationRequest;
  requestId: string;
  capabilityHash: string;
  capabilityId: string;
  storedCapability: StoredCapability;
  mandate: Mandate;
  amountMinor: number;
  currency: string;
  merchantReference: string;
  capabilityTtlMs: number;
}): Promise<VerificationResult> {
  const paymentOperationId = input.storedCapability.paymentOperationId!;
  const authorizationId = input.storedCapability.authorizationId;

  if (!authorizationId) {
    let authorization: PaymentAuthorizationResult;
    try {
      authorization = await input.options.paymentVault.authorize({
        paymentOperationId,
        paymentMethodId: input.mandate.paymentMethodId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        merchantReference: input.merchantReference,
        idempotencyKey: `authorize:${paymentOperationId}`,
      });
    } catch {
      return pendingVerificationResult({ ...input, paymentOperationId }, input.mandate);
    }
    return settleAuthorizationResult({ ...input, paymentOperationId, authorization });
  }

  let status;
  try {
    status = await input.options.paymentVault.getAuthorizationStatus({
      authorizationId,
      paymentOperationId,
    });
  } catch {
    return pendingVerificationResult({ ...input, paymentOperationId }, input.mandate);
  }

  switch (status.kind) {
    case 'authorized':
      return captureAuthorizedPayment({ ...input, paymentOperationId, authorizationId });
    case 'captured':
      return finalizeCapturedPayment({ ...input, paymentOperationId });
    case 'declined':
    case 'voided':
      await input.options.stateStore.finalizeFailedCapability({
        capabilityId: input.capabilityId,
        paymentOperationId,
        now: input.options.now().toISOString(),
      });
      return signedVerificationResult({
        options: input.options,
        request: input.request,
        requestId: input.requestId,
        capabilityHash: input.capabilityHash,
        outcome: rejectedOutcome('PAYMENT_AUTHORIZATION_DECLINED', paymentOperationId, 'failed'),
        mandate: input.mandate,
        now: input.options.now(),
        capabilityTtlMs: input.capabilityTtlMs,
      });
    case 'failed': {
      const voidResult = await safelyVoidAuthorization(input.options, {
        authorizationId,
        paymentOperationId,
      });
      if (voidResult !== 'voided') {
        return pendingVerificationResult({ ...input, paymentOperationId }, input.mandate);
      }
      await input.options.stateStore.finalizeFailedCapability({
        capabilityId: input.capabilityId,
        paymentOperationId,
        now: input.options.now().toISOString(),
      });
      return signedVerificationResult({
        options: input.options,
        request: input.request,
        requestId: input.requestId,
        capabilityHash: input.capabilityHash,
        outcome: rejectedOutcome('PAYMENT_CAPTURE_FAILED', paymentOperationId, 'failed'),
        mandate: input.mandate,
        now: input.options.now(),
        capabilityTtlMs: input.capabilityTtlMs,
      });
    }
    case 'reconciliation_required':
      return pendingVerificationResult({ ...input, paymentOperationId }, input.mandate);
  }
}

async function settleAuthorizationResult(input: {
  options: MandateApiOptions;
  request: MerchantVerificationRequest;
  requestId: string;
  capabilityHash: string;
  capabilityId: string;
  paymentOperationId: string;
  mandate: Mandate;
  authorization: PaymentAuthorizationResult;
  capabilityTtlMs: number;
}): Promise<VerificationResult> {
  const now = input.options.now();
  if (input.authorization.kind === 'declined') {
    await input.options.stateStore.finalizeFailedCapability({
      capabilityId: input.capabilityId,
      paymentOperationId: input.paymentOperationId,
      now: now.toISOString(),
    });
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash: input.capabilityHash,
      outcome: rejectedOutcome(
        'PAYMENT_AUTHORIZATION_DECLINED',
        input.paymentOperationId,
        'failed',
      ),
      mandate: input.mandate,
      now,
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }
  if (input.authorization.kind === 'reconciliation_required') {
    if (!input.authorization.authorizationId) {
      return pendingVerificationResult(input, input.mandate);
    }
    const recorded = await input.options.stateStore.recordPendingAuthorization({
      capabilityId: input.capabilityId,
      capabilityHash: input.capabilityHash,
      paymentOperationId: input.paymentOperationId,
      authorizationId: input.authorization.authorizationId,
      now: now.toISOString(),
    });
    if (!recorded.ok) {
      const voidResult = await safelyVoidAuthorization(input.options, {
        authorizationId: input.authorization.authorizationId,
        paymentOperationId: input.paymentOperationId,
      });
      return signedVerificationResult({
        options: input.options,
        request: input.request,
        requestId: input.requestId,
        capabilityHash: input.capabilityHash,
        outcome:
          voidResult === 'voided'
            ? rejectedOutcome(recorded.reasonCode, input.paymentOperationId, 'failed')
            : pendingOutcome('PAYMENT_RECONCILIATION_REQUIRED', input.paymentOperationId),
        mandate: await getMandate(input.options, input.mandate.id),
        now: input.options.now(),
        capabilityTtlMs: input.capabilityTtlMs,
      });
    }
    return pendingVerificationResult(input, recorded.mandate);
  }

  return captureAuthorizedPayment({
    ...input,
    authorizationId: input.authorization.authorizationId,
  });
}

async function captureAuthorizedPayment(input: {
  options: MandateApiOptions;
  request: MerchantVerificationRequest;
  requestId: string;
  capabilityHash: string;
  capabilityId: string;
  paymentOperationId: string;
  mandate: Mandate;
  authorizationId: string;
  capabilityTtlMs: number;
}): Promise<VerificationResult> {
  const captureStart = await input.options.stateStore.beginCapture({
    capabilityId: input.capabilityId,
    paymentOperationId: input.paymentOperationId,
    authorizationId: input.authorizationId,
    now: input.options.now().toISOString(),
  });
  if (!captureStart.ok) {
    if (captureStart.reasonCode === 'CAPABILITY_REPLAYED') {
      return pendingVerificationResult(input, input.mandate);
    }
    const voidResult = await safelyVoidAuthorization(input.options, {
      authorizationId: input.authorizationId,
      paymentOperationId: input.paymentOperationId,
    });
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash: input.capabilityHash,
      outcome:
        voidResult === 'voided'
          ? rejectedOutcome(captureStart.reasonCode, input.paymentOperationId, 'failed')
          : pendingOutcome('PAYMENT_RECONCILIATION_REQUIRED', input.paymentOperationId),
      mandate: await getMandate(input.options, input.mandate.id),
      now: input.options.now(),
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }

  let capture;
  try {
    capture = await input.options.paymentVault.capture({
      authorizationId: input.authorizationId,
      paymentOperationId: input.paymentOperationId,
      idempotencyKey: `capture:${input.paymentOperationId}`,
    });
  } catch {
    return pendingVerificationResult(input, captureStart.mandate);
  }
  if (capture.kind === 'reconciliation_required') {
    return pendingVerificationResult(input, captureStart.mandate);
  }
  if (capture.kind === 'failed') {
    const voidResult = await safelyVoidAuthorization(input.options, {
      authorizationId: input.authorizationId,
      paymentOperationId: input.paymentOperationId,
    });
    if (voidResult !== 'voided') {
      return pendingVerificationResult(input, captureStart.mandate);
    }
    await input.options.stateStore.finalizeFailedCapability({
      capabilityId: input.capabilityId,
      paymentOperationId: input.paymentOperationId,
      now: input.options.now().toISOString(),
    });
    return signedVerificationResult({
      options: input.options,
      request: input.request,
      requestId: input.requestId,
      capabilityHash: input.capabilityHash,
      outcome: rejectedOutcome('PAYMENT_CAPTURE_FAILED', input.paymentOperationId, 'failed'),
      mandate: captureStart.mandate,
      now: input.options.now(),
      capabilityTtlMs: input.capabilityTtlMs,
    });
  }

  return finalizeCapturedPayment({ ...input, mandate: captureStart.mandate });
}

async function finalizeCapturedPayment(input: {
  options: MandateApiOptions;
  request: MerchantVerificationRequest;
  requestId: string;
  capabilityHash: string;
  capabilityId: string;
  paymentOperationId: string;
  mandate: Mandate;
  capabilityTtlMs: number;
}): Promise<VerificationResult> {
  const captured = await input.options.stateStore.finalizeCapturedCapability({
    capabilityId: input.capabilityId,
    paymentOperationId: input.paymentOperationId,
    now: input.options.now().toISOString(),
  });
  if (!captured.ok) {
    return pendingVerificationResult(input, input.mandate);
  }
  return signedVerificationResult({
    options: input.options,
    request: input.request,
    requestId: input.requestId,
    capabilityHash: input.capabilityHash,
    outcome: approvedOutcome(input.paymentOperationId),
    mandate: captured.mandate,
    now: input.options.now(),
    capabilityTtlMs: input.capabilityTtlMs,
  });
}

function pendingVerificationResult(
  input: {
    options: MandateApiOptions;
    request: MerchantVerificationRequest;
    requestId: string;
    capabilityHash: string;
    paymentOperationId: string;
    capabilityTtlMs: number;
  },
  mandate: Mandate,
): Promise<VerificationResult> {
  return signedVerificationResult({
    options: input.options,
    request: input.request,
    requestId: input.requestId,
    capabilityHash: input.capabilityHash,
    outcome: pendingOutcome('PAYMENT_RECONCILIATION_REQUIRED', input.paymentOperationId),
    mandate,
    now: input.options.now(),
    capabilityTtlMs: input.capabilityTtlMs,
  });
}

async function signedVerificationResult(input: {
  options: MandateApiOptions;
  request: MerchantVerificationRequest;
  requestId: string;
  capabilityHash: string;
  outcome: MerchantVerificationOutcome;
  mandate: Mandate | undefined;
  now: Date;
  capabilityTtlMs: number;
}): Promise<VerificationResult> {
  const issuedAt = input.now.toISOString();
  const expiresAt =
    input.outcome.settlementStatus === 'pending'
      ? new Date(input.now.getTime() + input.capabilityTtlMs).toISOString()
      : undefined;
  const receipt: VerificationReceiptPayload = {
    verificationId: generatedId(input.options, 'verify_'),
    merchantId: input.request.merchantId,
    merchantOrderRef: input.request.merchantOrderRef,
    quoteId: input.request.quoteId,
    capabilityHash: input.capabilityHash,
    requestId: input.requestId,
    decision: input.outcome.decision,
    reasonCode: input.outcome.reasonCode,
    mandateStatus: mandateStatusForVerification(input.mandate, input.now),
    issuedAt,
    ...(expiresAt ? { expiresAt } : {}),
    keyId: input.options.receiptSigningKey.keyId,
    ...(input.outcome.paymentOperationId && input.outcome.settlementStatus
      ? {
          paymentOperationId: input.outcome.paymentOperationId,
          settlementStatus: input.outcome.settlementStatus,
        }
      : {}),
  };
  const verificationReceipt = await signVerificationReceipt(
    receipt,
    input.options.receiptSigningKey,
  );
  return VerificationResultSchema.parse({
    decision: receipt.decision,
    reasonCode: receipt.reasonCode,
    verificationId: receipt.verificationId,
    mandateStatus: receipt.mandateStatus,
    ...(receipt.expiresAt ? { expiresAt: receipt.expiresAt } : {}),
    verificationReceipt,
    ...(receipt.paymentOperationId && receipt.settlementStatus
      ? {
          paymentOperationId: receipt.paymentOperationId,
          settlementStatus: receipt.settlementStatus,
        }
      : {}),
  });
}

function approvedOutcome(paymentOperationId: string): MerchantVerificationOutcome {
  return {
    decision: 'approved',
    reasonCode: 'AUTHORIZED',
    paymentOperationId,
    settlementStatus: 'captured',
  };
}

function pendingOutcome(
  reasonCode: Extract<ReasonCode, 'PAYMENT_RECONCILIATION_REQUIRED' | 'PAYMENT_PENDING'>,
  paymentOperationId: string,
): MerchantVerificationOutcome {
  return {
    decision: 'approved',
    reasonCode,
    paymentOperationId,
    settlementStatus: 'pending',
  };
}

function rejectedOutcome(
  reasonCode: ReasonCode,
  paymentOperationId?: string,
  settlementStatus?: 'failed',
): MerchantVerificationOutcome {
  return {
    decision: 'rejected',
    reasonCode,
    ...(paymentOperationId && settlementStatus ? { paymentOperationId, settlementStatus } : {}),
  };
}

function rejectedIntent(reasonCode: ReasonCode, mandate: Mandate | undefined, now: Date): IntentResult {
  return AgentIntentResultSchema.parse({
    decision: 'rejected',
    reasonCode,
    mandateStatus: mandateStatusForVerification(mandate, now),
  });
}

async function safelyVoidAuthorization(
  options: MandateApiOptions,
  input: { authorizationId: string; paymentOperationId: string },
): Promise<'voided' | 'pending'> {
  try {
    const result = await options.paymentVault.void({
      authorizationId: input.authorizationId,
      paymentOperationId: input.paymentOperationId,
      idempotencyKey: `void:${input.paymentOperationId}`,
    });
    return result.kind === 'voided' ? 'voided' : 'pending';
  } catch {
    return 'pending';
  }
}

async function getMandate(
  options: MandateApiOptions,
  mandateId: string,
): Promise<Mandate | undefined> {
  try {
    return await options.stateStore.getMandate(mandateId);
  } catch {
    return undefined;
  }
}

async function getMerchant(options: MandateApiOptions, merchantId: string) {
  try {
    return await options.merchantRegistry.get(merchantId);
  } catch {
    return undefined;
  }
}

async function getTrustConstraint(options: MandateApiOptions, mandate: Mandate) {
  try {
    return await options.trustPolicyStore.get({
      mandateId: mandate.id,
      mandateVersion: mandate.version,
    });
  } catch {
    return undefined;
  }
}

async function authenticateAgent(
  options: MandateApiOptions,
  request: Request,
  rawBody: Uint8Array,
) {
  try {
    return await options.agentAuthenticator.authenticate({
      request,
      rawBody,
      requiredAudience: 'mandate-api',
    });
  } catch {
    return unavailableAuthentication('Agent authentication is temporarily unavailable.');
  }
}

async function authenticateMerchant(
  options: MandateApiOptions,
  request: Request,
  rawBody: Uint8Array,
) {
  try {
    return await options.merchantAuthenticator.authenticate({
      request,
      rawBody,
      requiredAudience: 'mandate-api',
    });
  } catch {
    return unavailableAuthentication('Merchant authentication is temporarily unavailable.');
  }
}

async function authenticatePrincipal(
  options: MandateApiOptions,
  request: Request,
  rawBody: Uint8Array,
) {
  try {
    return await options.principalAuthenticator.authenticate({
      request,
      rawBody,
      requiredAudience: 'mandate-api',
    });
  } catch {
    return unavailableAuthentication('Principal authentication is temporarily unavailable.');
  }
}

function unavailableAuthentication(message: string): AuthenticationFailure {
  return { ok: false, code: 'SERVICE_UNAVAILABLE', message };
}

function authenticationError(
  options: MandateApiOptions,
  requestId: string,
  failure: AuthenticationFailure,
): Response {
  const status =
    failure.code === 'SERVICE_UNAVAILABLE'
      ? 503
      : failure.code === 'ACTOR_NOT_ALLOWED' || failure.code === 'MERCHANT_INACTIVE'
        ? 403
        : 401;
  return apiError(options, requestId, status, failure.code, failure.message);
}

async function executeIdempotently(
  store: IdempotencyStore,
  scope: string,
  idempotencyKey: string,
  fingerprint: string,
  operation: () => Promise<StoredHttpResponse>,
) {
  try {
    return await store.execute(scope, idempotencyKey, fingerprint, operation);
  } catch {
    return {
      kind: 'created' as const,
      response: {
        status: 503,
        body: ApiErrorSchema.parse({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Idempotency storage is temporarily unavailable.',
            requestId: 'idempotency-unavailable',
          },
        }),
      },
    };
  }
}

async function readJsonRequest(request: Request): Promise<
  | { ok: true; rawBody: Uint8Array; body: unknown }
  | {
      ok: false;
      status: 400 | 415;
      code: 'CONTENT_TYPE_REQUIRED' | 'MALFORMED_REQUEST';
      message: string;
    }
> {
  const contentType = request.headers.get('content-type');
  if (!contentType?.toLowerCase().includes('application/json')) {
    return {
      ok: false,
      status: 415,
      code: 'CONTENT_TYPE_REQUIRED',
      message: 'Content-Type application/json is required.',
    };
  }
  const rawBody = new Uint8Array(await request.arrayBuffer());
  try {
    return {
      ok: true,
      rawBody,
      body: JSON.parse(new TextDecoder().decode(rawBody)),
    };
  } catch {
    return {
      ok: false,
      status: 400,
      code: 'MALFORMED_REQUEST',
      message: 'The request body must be valid JSON.',
    };
  }
}

function parseMerchantVerificationRequest(body: unknown): MerchantVerificationRequest | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const parsed = MerchantVerificationRequestSchema.safeParse({
    merchantId: body.merchantId,
    merchantOrderRef: body.merchantOrderRef,
    quoteId: body.quoteId,
    purchaseCapability: body.purchaseCapability,
  });
  return parsed.success ? parsed.data : undefined;
}

function idempotencyKeyFrom(request: Request): string | undefined {
  const parsed = IdempotencyKeySchema.safeParse(request.headers.get('idempotency-key'));
  return parsed.success ? parsed.data : undefined;
}

function merchantRequestIdFor(request: Request): string | undefined {
  const parsed = OpaqueIdSchema.safeParse(request.headers.get('x-request-id'));
  return parsed.success ? parsed.data : undefined;
}

function requestIdFor(request: Request, options: MandateApiOptions): string {
  const supplied = OpaqueIdSchema.safeParse(request.headers.get('x-request-id'));
  return supplied.success ? supplied.data : generatedId(options, 'req_');
}

function generatedId(options: MandateApiOptions, prefix: string): string {
  const generated = OpaqueIdSchema.safeParse(options.idGenerator(prefix));
  if (!generated.success) {
    throw new Error(`The configured idGenerator returned an invalid ${prefix} identifier.`);
  }
  return generated.data;
}

function apiError(
  _options: MandateApiOptions,
  requestId: string,
  status: number,
  code: ReasonCode,
  message: string,
): Response {
  return jsonResponse(
    ApiErrorSchema.parse({
      error: { code, message, requestId },
    }),
    status,
  );
}

function storedJsonResponse(response: StoredHttpResponse, replayed: boolean): Response {
  return jsonResponse(response.body, response.status, replayed ? { 'x-idempotent-replay': 'true' } : {});
}

function jsonResponse(
  value: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      ...headers,
    },
  });
}

function assertOptions(options: MandateApiOptions): void {
  const required = [
    options.agentAuthenticator,
    options.merchantAuthenticator,
    options.principalAuthenticator,
    options.merchantRegistry,
    options.merchantQuoteSource,
    options.taxonomyNormalizer,
    options.stateStore,
    options.trustPolicyStore,
    options.intentIdempotencyStore,
    options.verificationIdempotencyStore,
    options.paymentVault,
    options.capabilitySigningKey,
    options.capabilityVerificationKeys,
    options.receiptSigningKey,
    options.now,
    options.idGenerator,
  ];
  if (required.some((dependency) => !dependency)) {
    throw new Error('Mandate API requires explicit runtime dependencies.');
  }
  const ttl = options.capabilityTtlMs ?? DEFAULT_CAPABILITY_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 15 * 60_000) {
    throw new Error('capabilityTtlMs must be a positive integer no longer than fifteen minutes.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
