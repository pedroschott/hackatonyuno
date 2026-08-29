import { describe, expect, it } from 'vitest';

import {
  createPaymentVaultApp,
  type PaymentVaultOptions,
} from '../src/index.js';
import {
  createDemoPaymentVaultApp,
  createMandateServiceRequest,
} from '../src/test-harness.js';

const methodsPath = '/internal/v1/payment-methods/test';
const authorizationsPath = '/internal/v1/payment-authorizations';

type TestApp = {
  request(request: Request): Promise<Response> | Response;
};

type PaymentMethodResponse = {
  paymentMethod: {
    id: string;
    brand: string;
    last4: string;
    status: string;
  };
};

type PaymentAuthorizationResponse = {
  paymentAuthorization: {
    id: string;
    operationId: string;
    paymentMethodId: string;
    amountMinor: number;
    currency: string;
    merchantReference: string;
    status: string;
    gatewayId?: string;
    reasonCode?: string;
  };
};

type HostedSetupSessionResponse = {
  hostedSetupSession: {
    id: string;
    setupUrl: string;
    expiresAt: string;
  };
};

type ApiErrorResponse = {
  error: { code: string };
};

describe('payment vault', () => {
  it('requires a Mandate-service JWS and has no insecure runtime defaults', async () => {
    const { app } = createDemoPaymentVaultApp();
    const unauthenticated = await app.request(methodsPath, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'missing-proof-001',
      },
      body: JSON.stringify({ fixture: 'visa_4242' }),
    });
    expect(unauthenticated.status).toBe(401);
    expect((await unauthenticated.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'SERVICE_PROOF_INVALID' },
    });

    const wrongAudience = await requestVault(app, {
      method: 'POST',
      path: methodsPath,
      body: { fixture: 'visa_4242' },
      idempotencyKey: 'wrong-audience-001',
      audience: 'mandate-api',
    });
    expect(wrongAudience.status).toBe(401);

    const wrongProofType = await requestVault(app, {
      method: 'POST',
      path: methodsPath,
      body: { fixture: 'visa_4242' },
      idempotencyKey: 'wrong-proof-type-001',
      proofType: 'JWT',
    });
    expect(wrongProofType.status).toBe(401);

    expect(() => createPaymentVaultApp({} as PaymentVaultOptions)).toThrow(
      'Payment Vault requires authenticated, isolated, and durable runtime adapters.',
    );
  });

  it('creates an opaque test method without accepting or returning card data', async () => {
    const { app } = createDemoPaymentVaultApp();
    const created = await requestVault(app, {
      method: 'POST',
      path: methodsPath,
      body: { fixture: 'visa_4242' },
      idempotencyKey: 'method-create-001',
    });

    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as PaymentMethodResponse;
    expect(createdBody.paymentMethod).toMatchObject({
      brand: 'visa',
      last4: '4242',
      status: 'active',
    });
    expect(createdBody.paymentMethod.id).toMatch(/^pm_[a-zA-Z0-9_-]{16,}$/);
    expect(JSON.stringify(createdBody)).not.toContain('providerTokenRef');
    expect(JSON.stringify(createdBody)).not.toContain('fixture');

    const replay = await requestVault(app, {
      method: 'POST',
      path: methodsPath,
      body: { fixture: 'visa_4242' },
      idempotencyKey: 'method-create-001',
    });
    expect(replay.status).toBe(201);
    expect((await replay.json()) as PaymentMethodResponse).toEqual(createdBody);

    const rawCardAttempt = await requestVault(app, {
      method: 'POST',
      path: methodsPath,
      body: {
        fixture: 'visa_4242',
        pan: '4242424242424242',
        cvv: '123',
      },
      idempotencyKey: 'raw-card-attempt-001',
    });
    expect(rawCardAttempt.status).toBe(422);
    expect((await rawCardAttempt.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('exchanges a hosted test-fixture selection through a one-time server-side code', async () => {
    const { app } = createDemoPaymentVaultApp();
    const created = await requestVault(app, {
      method: 'POST',
      path: '/internal/v1/hosted-setup-sessions',
      body: { returnUrl: 'https://app.example.test/vault/callback?state=trusted-state' },
      idempotencyKey: 'hosted-session-001',
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as HostedSetupSessionResponse;
    expect(session.hostedSetupSession.id).toMatch(/^hs_[a-zA-Z0-9_-]{16,}$/);
    expect(session.hostedSetupSession.setupUrl).toContain('https://vault.example.test/hosted/');

    const setupUrl = new URL(session.hostedSetupSession.setupUrl);
    const page = await app.request(`${setupUrl.pathname}${setupUrl.search}`);
    expect(page.status).toBe(200);
    const pageHtml = await page.text();
    expect(pageHtml).toContain('Choose a test payment method');
    expect(pageHtml).not.toMatch(/pan|cvv/i);

    const invalidForm = await app.request('/hosted/test-payment-methods/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        session_id: session.hostedSetupSession.id,
        fixture: 'visa_4242',
        pan: '4242424242424242',
      }).toString(),
    });
    expect(invalidForm.status).toBe(422);

    const completed = await app.request('/hosted/test-payment-methods/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        session_id: session.hostedSetupSession.id,
        fixture: 'visa_4242',
      }).toString(),
    });
    expect(completed.status).toBe(303);
    const callback = new URL(completed.headers.get('location')!);
    expect(callback.origin).toBe('https://app.example.test');
    expect(callback.searchParams.get('state')).toBe('trusted-state');
    expect(callback.searchParams.get('setup_session_id')).toBe(session.hostedSetupSession.id);
    const setupCode = callback.searchParams.get('setup_code');
    expect(setupCode).toMatch(/^setup_[a-zA-Z0-9_-]{16,}$/);
    expect(callback.searchParams.get('paymentMethodId')).toBeNull();

    const exchangePath = `/internal/v1/hosted-setup-sessions/${session.hostedSetupSession.id}/exchange`;
    const exchanged = await requestVault(app, {
      method: 'POST',
      path: exchangePath,
      body: { setupCode },
      idempotencyKey: 'hosted-exchange-001',
    });
    expect(exchanged.status).toBe(200);
    const exchangedBody = (await exchanged.json()) as PaymentMethodResponse;
    expect(exchangedBody.paymentMethod).toMatchObject({
      brand: 'visa',
      last4: '4242',
      status: 'active',
    });
    expect(JSON.stringify(exchangedBody)).not.toContain('providerTokenRef');

    const replay = await requestVault(app, {
      method: 'POST',
      path: exchangePath,
      body: { setupCode },
      idempotencyKey: 'hosted-exchange-001',
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()) as PaymentMethodResponse).toEqual(exchangedBody);

    const duplicateExchange = await requestVault(app, {
      method: 'POST',
      path: exchangePath,
      body: { setupCode },
      idempotencyKey: 'hosted-exchange-002',
    });
    expect(duplicateExchange.status).toBe(409);
    expect((await duplicateExchange.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'SETUP_CODE_ALREADY_EXCHANGED' },
    });

    const untrustedCallback = await requestVault(app, {
      method: 'POST',
      path: '/internal/v1/hosted-setup-sessions',
      body: { returnUrl: 'https://attacker.example.test/callback' },
      idempotencyKey: 'hosted-session-untrusted-001',
    });
    expect(untrustedCallback.status).toBe(422);
    expect((await untrustedCallback.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'RETURN_URL_NOT_ALLOWED' },
    });
  });

  it('authorizes and captures a payment exactly once without exposing Vault state', async () => {
    const { app } = createDemoPaymentVaultApp();
    const paymentMethod = await createPaymentMethod(app, 'method-capture-001');

    const authorization = await requestVault(app, {
      method: 'POST',
      path: authorizationsPath,
      body: {
        operationId: 'operation-capture-0001',
        paymentMethodId: paymentMethod.id,
        amountMinor: 1405,
        currency: 'USD',
        merchantReference: 'harvest-order-0001',
      },
      idempotencyKey: 'authorize-capture-001',
    });
    expect(authorization.status).toBe(201);
    const authorized = (await authorization.json()) as PaymentAuthorizationResponse;
    expect(authorized.paymentAuthorization.status).toBe('authorized');
    expect(authorized.paymentAuthorization.gatewayId).toMatch(/^card-gateway-[ab]$/);
    expect(JSON.stringify(authorized)).not.toContain('providerTokenRef');

    const capturePath = `${authorizationsPath}/${authorized.paymentAuthorization.id}/capture`;
    const capture = await requestVault(app, {
      method: 'POST',
      path: capturePath,
      body: {},
      idempotencyKey: 'capture-001',
    });
    expect(capture.status).toBe(200);
    const captured = (await capture.json()) as PaymentAuthorizationResponse;
    expect(captured.paymentAuthorization.status).toBe('captured');

    const replay = await requestVault(app, {
      method: 'POST',
      path: capturePath,
      body: {},
      idempotencyKey: 'capture-001',
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()) as PaymentAuthorizationResponse).toEqual(captured);

    const operationConflict = await requestVault(app, {
      method: 'POST',
      path: authorizationsPath,
      body: {
        operationId: 'operation-capture-0001',
        paymentMethodId: paymentMethod.id,
        amountMinor: 1406,
        currency: 'USD',
        merchantReference: 'harvest-order-0001',
      },
      idempotencyKey: 'operation-conflict-001',
    });
    expect(operationConflict.status).toBe(409);
    expect((await operationConflict.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'PAYMENT_OPERATION_CONFLICT' },
    });
  });

  it('uses deterministic gateway routing and makes authorization timeouts reconcilable', async () => {
    const timeoutOperationId = 'operation-timeout-0001';
    const { app, yunoRouter } = createDemoPaymentVaultApp({
      scenarios: new Map([[timeoutOperationId, 'authorization_timeout']]),
    });
    const paymentMethod = await createPaymentMethod(app, 'method-timeout-001');

    expect(yunoRouter.routeForOperation(timeoutOperationId)).toBe(
      yunoRouter.routeForOperation(timeoutOperationId),
    );
    expect(
      new Set(
        ['operation-gateway-0001', 'operation-gateway-0002', 'operation-gateway-0003'].map(
          (operationId) => yunoRouter.routeForOperation(operationId),
        ),
      ).size,
    ).toBeGreaterThan(1);

    const created = await requestVault(app, {
      method: 'POST',
      path: authorizationsPath,
      body: {
        operationId: timeoutOperationId,
        paymentMethodId: paymentMethod.id,
        amountMinor: 999,
        currency: 'USD',
        merchantReference: 'city-basket-timeout-0001',
      },
      idempotencyKey: 'authorize-timeout-001',
    });
    expect(created.status).toBe(202);
    const pending = (await created.json()) as PaymentAuthorizationResponse;
    expect(pending.paymentAuthorization.status).toBe('reconciliation_required');
    expect(pending.paymentAuthorization.reasonCode).toBe('AUTHORIZATION_STATUS_UNKNOWN');

    const reconciled = await requestVault(app, {
      method: 'GET',
      path: `${authorizationsPath}/${pending.paymentAuthorization.id}`,
    });
    expect(reconciled.status).toBe(200);
    const reconciledBody = (await reconciled.json()) as PaymentAuthorizationResponse;
    expect(reconciledBody.paymentAuthorization.status).toBe('authorized');

    const capture = await requestVault(app, {
      method: 'POST',
      path: `${authorizationsPath}/${pending.paymentAuthorization.id}/capture`,
      body: {},
      idempotencyKey: 'capture-timeout-001',
    });
    expect(capture.status).toBe(200);
    expect((await capture.json()) as PaymentAuthorizationResponse).toMatchObject({
      paymentAuthorization: { status: 'captured' },
    });
  });

  it('persists a capture failure and permits a deterministic void instead of a second capture', async () => {
    const operationId = 'operation-capture-failure-0001';
    const { app } = createDemoPaymentVaultApp({
      scenarios: new Map([[operationId, 'capture_failed']]),
    });
    const paymentMethod = await createPaymentMethod(app, 'method-capture-failure-001');
    const authorization = await createAuthorization(app, paymentMethod.id, operationId);
    const authorizationId = authorization.paymentAuthorization.id;

    const capture = await requestVault(app, {
      method: 'POST',
      path: `${authorizationsPath}/${authorizationId}/capture`,
      body: {},
      idempotencyKey: 'capture-failure-001',
    });
    expect(capture.status).toBe(502);
    expect((await capture.json()) as PaymentAuthorizationResponse).toMatchObject({
      paymentAuthorization: { status: 'failed', reasonCode: 'CAPTURE_FAILED' },
    });

    const repeatCapture = await requestVault(app, {
      method: 'POST',
      path: `${authorizationsPath}/${authorizationId}/capture`,
      body: {},
      idempotencyKey: 'capture-failure-002',
    });
    expect(repeatCapture.status).toBe(409);
    expect((await repeatCapture.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'CAPTURE_PREVIOUSLY_FAILED' },
    });

    const voided = await requestVault(app, {
      method: 'POST',
      path: `${authorizationsPath}/${authorizationId}/void`,
      body: {},
      idempotencyKey: 'void-after-failure-001',
    });
    expect(voided.status).toBe(200);
    expect((await voided.json()) as PaymentAuthorizationResponse).toMatchObject({
      paymentAuthorization: { status: 'voided' },
    });
  });

  it('never lets a void overwrite an in-flight capture result', async () => {
    let signalCaptureStarted!: () => void;
    const captureStarted = new Promise<void>((resolve) => {
      signalCaptureStarted = resolve;
    });
    let releaseCapture!: () => void;
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    const { app } = createDemoPaymentVaultApp({
      mockYunoOptions: {
        beforeCapture: async () => {
          signalCaptureStarted();
          await captureGate;
        },
      },
    });
    const paymentMethod = await createPaymentMethod(app, 'method-capture-void-race-001');
    const authorization = await createAuthorization(
      app,
      paymentMethod.id,
      'operation-capture-void-race-0001',
    );
    const authorizationId = authorization.paymentAuthorization.id;

    const capture = requestVault(app, {
      method: 'POST',
      path: `${authorizationsPath}/${authorizationId}/capture`,
      body: {},
      idempotencyKey: 'capture-void-race-001',
    });
    await captureStarted;

    const voidResponse = await requestVault(app, {
      method: 'POST',
      path: `${authorizationsPath}/${authorizationId}/void`,
      body: {},
      idempotencyKey: 'void-while-capture-001',
    });
    expect(voidResponse.status).toBe(202);
    expect((await voidResponse.json()) as PaymentAuthorizationResponse).toMatchObject({
      paymentAuthorization: { status: 'capture_pending' },
    });

    releaseCapture();
    const captureResponse = await capture;
    expect(captureResponse.status).toBe(200);
    expect((await captureResponse.json()) as PaymentAuthorizationResponse).toMatchObject({
      paymentAuthorization: { status: 'captured' },
    });

    const finalState = await requestVault(app, {
      method: 'GET',
      path: `${authorizationsPath}/${authorizationId}`,
    });
    expect((await finalState.json()) as PaymentAuthorizationResponse).toMatchObject({
      paymentAuthorization: { status: 'captured' },
    });
  });

  it('rejects a replayed JWS even when the request body and idempotency key are valid', async () => {
    const { app } = createDemoPaymentVaultApp();
    const originalRequest = await createMandateServiceRequest({
      method: 'POST',
      path: methodsPath,
      body: { fixture: 'mastercard_4444' },
      idempotencyKey: 'proof-replay-001',
      proofId: 'replayed-service-proof-001',
    });

    const replayRequest = originalRequest.clone();
    const first = await app.request(originalRequest);
    expect(first.status).toBe(201);

    const replay = await app.request(replayRequest);
    expect(replay.status).toBe(401);
    expect((await replay.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'SERVICE_PROOF_REPLAYED' },
    });
  });
});

async function createPaymentMethod(app: TestApp, idempotencyKey: string) {
  const response = await requestVault(app, {
    method: 'POST',
    path: methodsPath,
    body: { fixture: 'visa_4242' },
    idempotencyKey,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as PaymentMethodResponse).paymentMethod;
}

async function createAuthorization(app: TestApp, paymentMethodId: string, operationId: string) {
  const response = await requestVault(app, {
    method: 'POST',
    path: authorizationsPath,
    body: {
      operationId,
      paymentMethodId,
      amountMinor: 1_405,
      currency: 'USD',
      merchantReference: `merchant-${operationId}`,
    },
    idempotencyKey: `authorize-${operationId}`,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as PaymentAuthorizationResponse;
}

async function requestVault(
  app: TestApp,
  input: {
    method: string;
    path: string;
    body?: unknown;
    idempotencyKey?: string;
    audience?: string;
    proofType?: string;
  },
): Promise<Response> {
  const request = await createMandateServiceRequest(input);
  return app.request(request);
}
