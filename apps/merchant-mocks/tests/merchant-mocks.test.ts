import { describe, expect, it } from 'vitest';

import {
  createMerchantMocksApp,
  merchantDefinitions,
  verifyMerchantQuoteSignature,
  HttpMandateVerificationClient,
  type MandateVerificationClient,
  type MerchantMocksOptions,
  type MerchantQuote,
} from '../src/index.js';
import {
  createDemoMerchantMocksApp,
  DemoMandateVerificationClient,
  testOnlyMandateReceiptPublicJwk,
} from '../src/test-harness.js';

const agentProof = 'test-agent-proof';
const harvestBasePath = '/merchants/harvest-market/v1/agents-pay';
const cityBasketBasePath = '/merchants/city-basket/v1/agents-pay';

describe('merchant mocks', () => {
  it('serves the discovery document with USD currency and capabilities', async () => {
    const app = createTestApp();

    const response = await app.request('/merchants/autoparts/.well-known/agentpay.json');
    expect(response.status).toBe(200);

    const discovery = await response.json();
    expect(discovery).toEqual({
      protocol: 'agentpay/1.0',
      merchant: { id: 'mrc_autoparts', name: 'AutoParts' },
      checkout_endpoint: '/merchants/autoparts/v1/agents-pay/orders/verification',
      capabilities: ['intent-mandates', 'live-revocation', 'mock-payment'],
      currency: 'USD',
    });
  });

  it('exposes catalogs with distinct local taxonomies and no canonical category', async () => {
    const app = createTestApp();

    const [harvestResponse, cityBasketResponse] = await Promise.all([
      requestJson(app, `${harvestBasePath}/search`, { query: 'rice' }),
      requestJson(app, `${cityBasketBasePath}/search`, { query: 'rice' }),
    ]);

    expect(harvestResponse.status).toBe(200);
    expect(cityBasketResponse.status).toBe(200);

    const harvest = (await harvestResponse.json()) as SearchResponse;
    const cityBasket = (await cityBasketResponse.json()) as SearchResponse;

    expect(harvest.merchantId).toBe('mrc_harvest_market');
    expect(cityBasket.merchantId).toBe('mrc_city_basket');
    expect(harvest.offers[0]?.merchantCategoryId).toBe('pantry.rice-and-grains');
    expect(cityBasket.offers[0]?.merchantCategoryId).toBe('grocery/dry-goods/rice');
    expect(harvest.offers[0]).not.toHaveProperty('canonicalCategoryId');
    expect(cityBasket.offers[0]).not.toHaveProperty('trustTier');
  });

  it('calculates, signs, and returns an immutable merchant quote in USD', async () => {
    const app = createTestApp();
    const createResponse = await requestJson(
      app,
      `${harvestBasePath}/quotes`,
      { items: [{ merchantSku: 'hm-rice-jasmine-2lb', quantity: 1 }] },
      { 'idempotency-key': 'quote-rice-001' },
    );

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as QuoteResponse;

    expect(created.quote.subtotalMinor).toBe(3_490);
    expect(created.quote.shippingMinor).toBe(1_490);
    expect(created.quote.taxMinor).toBe(411);
    expect(created.quote.totalMinor).toBe(5_391);
    expect(created.quote.currency).toBe('USD');
    expect(created.quote.keyId).toBe('harvest-market-2026-08');
    expect(
      await verifyMerchantQuoteSignature(
        created.quote,
        merchantDefinitions[1]!.signingPublicJwk,
      ),
    ).toBe(true);

    const fetchedResponse = await requestJson(
      app,
      `${harvestBasePath}/quotes/${created.quote.id}`,
      undefined,
      {},
      'GET',
    );
    const fetched = (await fetchedResponse.json()) as QuoteResponse;

    expect(fetchedResponse.status).toBe(200);
    expect(fetched.quote).toEqual(created.quote);

    const modifiedQuote = {
      ...created.quote,
      totalMinor: created.quote.totalMinor + 1,
    };
    expect(
      await verifyMerchantQuoteSignature(
        modifiedQuote,
        merchantDefinitions[1]!.signingPublicJwk,
      ),
    ).toBe(false);

    const retryResponse = await requestJson(
      app,
      `${harvestBasePath}/quotes`,
      { items: [{ merchantSku: 'hm-rice-jasmine-2lb', quantity: 1 }] },
      { 'idempotency-key': 'quote-rice-001' },
    );
    expect(retryResponse.status).toBe(201);
    expect((await retryResponse.json()) as QuoteResponse).toEqual(created);
  });

  it('does not trust a client-provided price or omit authentication', async () => {
    const app = createTestApp();

    const unauthenticated = await app.request(`${harvestBasePath}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'rice' }),
    });
    expect(unauthenticated.status).toBe(401);

    const requestWithAmount = await requestJson(
      app,
      `${harvestBasePath}/quotes`,
      {
        items: [{ merchantSku: 'hm-rice-jasmine-2lb', quantity: 1 }],
        totalMinor: 1,
      },
      { 'idempotency-key': 'quote-untrusted-total-001' },
    );
    expect(requestWithAmount.status).toBe(422);
    expect((await requestWithAmount.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('does not provide insecure in-memory production defaults', () => {
    expect(() => createMerchantMocksApp({} as MerchantMocksOptions)).toThrow(
      'Merchant mocks require authenticated, Mandate-verified, durable runtime adapters.',
    );
  });

  it('enforces an injected rate limiter and fails closed when the limiter is unavailable', async () => {
    const rateLimitedApp = createTestApp({
      rateLimiter: {
        check: async () => ({ allowed: false, retryAfterSeconds: 15 }),
      },
    });
    const rateLimited = await requestJson(rateLimitedApp, `${harvestBasePath}/search`, {
      query: 'rice',
    });

    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get('retry-after')).toBe('15');
    expect((await rateLimited.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });

    const unavailableApp = createTestApp({
      rateLimiter: {
        check: async () => {
          throw new Error('rate limiter unavailable');
        },
      },
    });
    const unavailable = await requestJson(unavailableApp, `${harvestBasePath}/search`, {
      query: 'rice',
    });

    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'RATE_LIMIT_UNAVAILABLE' },
    });
  });

  it('returns quote expiry and merchant mismatch deterministically', async () => {
    const app = createTestApp({ demoScenarioControl: { secret: 'test-admin-secret' } });
    const expiredCreate = await requestJson(
      app,
      `${harvestBasePath}/quotes`,
      { items: [{ merchantSku: 'hm-rice-jasmine-2lb', quantity: 1 }] },
      {
        'idempotency-key': 'quote-expired-001',
        'x-demo-quote-scenario': 'expired_quote',
        'x-demo-admin-secret': 'test-admin-secret',
      },
    );
    const expiredQuote = (await expiredCreate.json()) as QuoteResponse;

    const expiredRead = await requestJson(
      app,
      `${harvestBasePath}/quotes/${expiredQuote.quote.id}`,
      undefined,
      {},
      'GET',
    );
    expect(expiredRead.status).toBe(410);
    expect((await expiredRead.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'QUOTE_EXPIRED' },
    });

    const validCreate = await requestJson(
      app,
      `${harvestBasePath}/quotes`,
      { items: [{ merchantSku: 'hm-rice-jasmine-2lb', quantity: 1 }] },
      { 'idempotency-key': 'quote-wrong-merchant-001' },
    );
    const validQuote = (await validCreate.json()) as QuoteResponse;
    const wrongMerchant = await requestJson(
      app,
      `${cityBasketBasePath}/quotes/${validQuote.quote.id}`,
      undefined,
      {},
      'GET',
    );

    expect(wrongMerchant.status).toBe(409);
    expect((await wrongMerchant.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'QUOTE_MERCHANT_MISMATCH' },
    });
  });

  it('allows the Mandate service, not just an agent, to retrieve a registered quote', async () => {
    const app = createTestApp({ expectedMandateServiceProof: 'test-mandate-service-proof' });
    const quoteResponse = await requestJson(
      app,
      `${harvestBasePath}/quotes`,
      { items: [{ merchantSku: 'hm-rice-jasmine-2lb', quantity: 1 }] },
      { 'idempotency-key': 'quote-mandate-read-001' },
    );
    const { quote } = (await quoteResponse.json()) as QuoteResponse;

    const mandateRead = await app.request(`${harvestBasePath}/quotes/${quote.id}`, {
      method: 'GET',
      headers: { 'x-mandate-request-proof': 'test-mandate-service-proof' },
    });

    expect(mandateRead.status).toBe(200);
    expect((await mandateRead.json()) as QuoteResponse).toMatchObject({
      quote: { id: quote.id },
    });
  });

  it('returns an unmapped-category decision through the minimal Mandate bridge', async () => {
    const app = createTestApp({
      mandateVerifier: new DemoMandateVerificationClient({
        scenario: 'unmapped_local_category',
      }),
    });
    const quoteResponse = await requestJson(
      app,
      `${harvestBasePath}/quotes`,
      { items: [{ merchantSku: 'hm-store-credit-50', quantity: 1 }] },
      { 'idempotency-key': 'quote-unmapped-category-001' },
    );
    const { quote } = (await quoteResponse.json()) as QuoteResponse;

    const verificationResponse = await requestJson(
      app,
      `${harvestBasePath}/orders/${quote.merchantOrderRef}/verification`,
      { quoteId: quote.id, purchaseCapability: 'opaque-test-capability' },
      { 'idempotency-key': 'verify-unmapped-category-001' },
    );
    const verification = (await verificationResponse.json()) as VerificationResponse;

    expect(verificationResponse.status).toBe(403);
    expect(verification.order.status).toBe('verification_rejected');
    expect(verification.order.verification.reasonCode).toBe('UNMAPPED_CATEGORY');
    expect(JSON.stringify(verification)).not.toContain('paymentMethod');
    expect(JSON.stringify(verification)).not.toContain('providerToken');
  });

  it('deduplicates concurrent verification and rejects idempotency-key payload changes', async () => {
    const app = createTestApp();
    const quoteResponse = await requestJson(
      app,
      `${harvestBasePath}/quotes`,
      { items: [{ merchantSku: 'hm-rice-jasmine-2lb', quantity: 1 }] },
      { 'idempotency-key': 'quote-verify-idempotency-001' },
    );
    const { quote } = (await quoteResponse.json()) as QuoteResponse;
    const path = `${harvestBasePath}/orders/${quote.merchantOrderRef}/verification`;
    const body = { quoteId: quote.id, purchaseCapability: 'opaque-test-capability' };

    const [first, second] = await Promise.all([
      requestJson(app, path, body, { 'idempotency-key': 'verify-rice-001' }),
      requestJson(app, path, body, { 'idempotency-key': 'verify-rice-001' }),
    ]);
    const [firstBody, secondBody] = (await Promise.all([first.json(), second.json()])) as [
      VerificationResponse,
      VerificationResponse,
    ];

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody).toEqual(secondBody);
    expect(firstBody.order.status).toBe('verification_approved');
    expect(firstBody.order).not.toHaveProperty('paymentMethodId');
    expect(firstBody.order.verification).toHaveProperty('verificationReceipt');

    const changedPayload = await requestJson(
      app,
      path,
      { quoteId: quote.id, purchaseCapability: 'another-capability' },
      { 'idempotency-key': 'verify-rice-001' },
    );
    expect(changedPayload.status).toBe(409);
    expect((await changedPayload.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it.each([
    { firstScenario: 'valid' as const, expectedStatus: 'verification_approved' },
    { firstScenario: 'cart_changed' as const, expectedStatus: 'verification_rejected' },
  ])('preserves a $expectedStatus terminal decision across idempotency keys', async ({
    firstScenario,
    expectedStatus,
  }) => {
    const firstVerifier = new DemoMandateVerificationClient({ scenario: firstScenario });
    const competingVerifier = new DemoMandateVerificationClient();
    let verificationCalls = 0;
    const mandateVerifier: MandateVerificationClient = {
      verify: async (request) => {
        verificationCalls += 1;
        return verificationCalls === 1
          ? firstVerifier.verify(request)
          : competingVerifier.verify(request);
      },
    };
    const app = createTestApp({ mandateVerifier });
    const quoteResponse = await requestJson(
      app,
      `${harvestBasePath}/quotes`,
      { items: [{ merchantSku: 'hm-rice-jasmine-2lb', quantity: 1 }] },
      { 'idempotency-key': 'quote-terminal-preservation-001' },
    );
    const { quote } = (await quoteResponse.json()) as QuoteResponse;
    const path = `${harvestBasePath}/orders/${quote.merchantOrderRef}/verification`;

    const firstVerification = await requestJson(
      app,
      path,
      { quoteId: quote.id, purchaseCapability: 'first-capability' },
      { 'idempotency-key': 'verify-terminal-preservation-001' },
    );
    expect(firstVerification.status).toBe(
      expectedStatus === 'verification_approved' ? 200 : 403,
    );
    expect((await firstVerification.json()) as VerificationResponse).toMatchObject({
      order: { status: expectedStatus },
    });

    const conflictingVerification = await requestJson(
      app,
      path,
      { quoteId: quote.id, purchaseCapability: 'different-capability' },
      { 'idempotency-key': 'verify-terminal-preservation-002' },
    );

    expect(conflictingVerification.status).toBe(409);
    expect((await conflictingVerification.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'ORDER_ALREADY_VERIFIED' },
    });
    expect(verificationCalls).toBe(1);
  });

  it('allows only one concurrent verification attempt across different idempotency keys', async () => {
    const delegate = new DemoMandateVerificationClient();
    let verificationCalls = 0;
    let resolveStarted: () => void = () => undefined;
    let releaseVerification: () => void = () => undefined;
    const verificationStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const verificationReleased = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    const mandateVerifier: MandateVerificationClient = {
      verify: async (request) => {
        verificationCalls += 1;
        resolveStarted();
        await verificationReleased;
        return delegate.verify(request);
      },
    };
    const app = createTestApp({ mandateVerifier });
    const quoteResponse = await requestJson(
      app,
      `${harvestBasePath}/quotes`,
      { items: [{ merchantSku: 'hm-rice-jasmine-2lb', quantity: 1 }] },
      { 'idempotency-key': 'quote-concurrent-verification-001' },
    );
    const { quote } = (await quoteResponse.json()) as QuoteResponse;
    const path = `${harvestBasePath}/orders/${quote.merchantOrderRef}/verification`;
    const body = { quoteId: quote.id, purchaseCapability: 'opaque-test-capability' };

    const firstVerification = requestJson(
      app,
      path,
      body,
      { 'idempotency-key': 'verify-concurrent-001' },
    );
    await verificationStarted;

    const competingVerification = await requestJson(
      app,
      path,
      body,
      { 'idempotency-key': 'verify-concurrent-002' },
    );
    expect(competingVerification.status).toBe(409);
    expect((await competingVerification.json()) as ApiErrorResponse).toMatchObject({
      error: { code: 'VERIFICATION_IN_PROGRESS' },
    });
    expect(verificationCalls).toBe(1);

    releaseVerification();
    const completedVerification = await firstVerification;
    expect(completedVerification.status).toBe(200);
    expect(verificationCalls).toBe(1);
  });

  it('returns only opaque settlement state from a Mandate verification result', async () => {
    const app = createTestApp({
      mandateVerifier: new DemoMandateVerificationClient({
        settlement: {
          paymentOperationId: 'operation_mock_001',
          settlementStatus: 'captured',
        },
      }),
    });
    const quoteResponse = await requestJson(
      app,
      `${harvestBasePath}/quotes`,
      { items: [{ merchantSku: 'hm-rice-jasmine-2lb', quantity: 1 }] },
      { 'idempotency-key': 'quote-settlement-projection-001' },
    );
    const { quote } = (await quoteResponse.json()) as QuoteResponse;
    const verificationResponse = await requestJson(
      app,
      `${harvestBasePath}/orders/${quote.merchantOrderRef}/verification`,
      { quoteId: quote.id, purchaseCapability: 'opaque-test-capability' },
      { 'idempotency-key': 'verify-settlement-projection-001' },
    );
    const verification = await verificationResponse.json();

    expect(verificationResponse.status).toBe(200);
    expect(verification).toMatchObject({
      order: {
        verification: {
          paymentOperationId: 'operation_mock_001',
          settlementStatus: 'captured',
        },
      },
    });
    expect(JSON.stringify(verification)).not.toContain('paymentMethodId');
    expect(JSON.stringify(verification)).not.toContain('providerToken');
  });

  it('does not mark a pending settlement as fulfillable and accepts its later resolution', async () => {
    const pending = new DemoMandateVerificationClient({
      settlement: {
        paymentOperationId: 'operation_pending_001',
        settlementStatus: 'pending',
      },
    });
    const captured = new DemoMandateVerificationClient({
      settlement: {
        paymentOperationId: 'operation_pending_001',
        settlementStatus: 'captured',
      },
    });
    let attempts = 0;
    const app = createTestApp({
      mandateVerifier: {
        verify: async (request) => {
          attempts += 1;
          return attempts === 1 ? pending.verify(request) : captured.verify(request);
        },
      },
    });
    const quoteResponse = await requestJson(
      app,
      `${harvestBasePath}/quotes`,
      { items: [{ merchantSku: 'hm-rice-jasmine-2lb', quantity: 1 }] },
      { 'idempotency-key': 'quote-pending-settlement-001' },
    );
    const { quote } = (await quoteResponse.json()) as QuoteResponse;
    const path = `${harvestBasePath}/orders/${quote.merchantOrderRef}/verification`;
    const body = { quoteId: quote.id, purchaseCapability: 'opaque-test-capability' };

    const first = await requestJson(
      app,
      path,
      body,
      { 'idempotency-key': 'verify-pending-settlement-001' },
    );
    expect(first.status).toBe(202);
    expect((await first.json()) as VerificationResponse).toMatchObject({
      order: {
        status: 'settlement_pending',
        verification: { settlementStatus: 'pending' },
      },
    });

    const resolved = await requestJson(
      app,
      path,
      body,
      { 'idempotency-key': 'verify-pending-settlement-002' },
    );
    expect(resolved.status).toBe(200);
    expect((await resolved.json()) as VerificationResponse).toMatchObject({
      order: {
        status: 'verification_approved',
        verification: { settlementStatus: 'captured' },
      },
    });
  });

  it('keeps a cart-change rejection deterministic and does not capture a payment', async () => {
    const app = createTestApp({
      mandateVerifier: new DemoMandateVerificationClient({ scenario: 'cart_changed' }),
    });
    const quoteResponse = await requestJson(
      app,
      `${cityBasketBasePath}/quotes`,
      { items: [{ merchantSku: 'cb-basmati-pouch-900g', quantity: 1 }] },
      { 'idempotency-key': 'quote-cart-change-001' },
    );
    const { quote } = (await quoteResponse.json()) as QuoteResponse;
    const verificationResponse = await requestJson(
      app,
      `${cityBasketBasePath}/orders/${quote.merchantOrderRef}/verification`,
      { quoteId: quote.id, purchaseCapability: 'capability-bound-to-another-cart' },
      { 'idempotency-key': 'verify-cart-change-001' },
    );

    expect(verificationResponse.status).toBe(403);
    expect((await verificationResponse.json()) as VerificationResponse).toMatchObject({
      order: {
        status: 'verification_rejected',
        verification: { reasonCode: 'CART_CHANGED' },
      },
    });
  });

  it('uses a server-to-server Mandate verification bridge with a bound signed receipt', async () => {
    const signedRequests: Array<{ url: string; body: string }> = [];
    const requests: Array<{ url: string; headers: Headers; body: string }> = [];
    const bridgeRequest = {
      merchantId: 'harvest-market',
      merchantOrderRef: 'order_001',
      quoteId: 'quote_001',
      purchaseCapability: 'opaque-capability',
      idempotencyKey: 'verification-bridge-001',
      requestId: 'req_bridge_001',
    };
    const signedResult = await new DemoMandateVerificationClient({
      now: () => new Date('2026-08-29T12:00:00.000Z'),
    }).verify(bridgeRequest);
    const client = new HttpMandateVerificationClient({
      baseUrl: 'https://mandate.example.test/',
      requestProofSigner: {
        sign: async ({ url, body }) => {
          signedRequests.push({ url, body });
          return 'merchant-service-proof';
        },
      },
      receiptKeys: new Map([
        ['mandate-demo-2026-08', testOnlyMandateReceiptPublicJwk],
      ]),
      now: () => new Date('2026-08-29T12:00:01.000Z'),
      fetch: (async (input, init) => {
        requests.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body: String(init?.body),
        });
        return new Response(
          JSON.stringify(signedResult),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch,
    });

    const result = await client.verify(bridgeRequest);

    expect(result).toMatchObject({
      decision: 'approved',
      verificationReceipt: signedResult.verificationReceipt,
    });
    expect(signedRequests).toEqual([
      {
        url: 'https://mandate.example.test/v1/merchant/verifications',
        body: JSON.stringify(bridgeRequest),
      },
    ]);
    expect(requests[0]?.headers.get('x-merchant-request-proof')).toBe('merchant-service-proof');
    expect(requests[0]?.headers.get('idempotency-key')).toBe('verification-bridge-001');
    expect(requests[0]?.headers.get('x-request-id')).toBe('req_bridge_001');
  });

  it('rejects a Mandate receipt that is signed but bound to another capability', async () => {
    const expectedRequest = {
      merchantId: 'harvest-market',
      merchantOrderRef: 'order_001',
      quoteId: 'quote_001',
      purchaseCapability: 'expected-capability',
      idempotencyKey: 'verification-bridge-002',
      requestId: 'req_bridge_002',
    };
    const resultForAnotherCapability = await new DemoMandateVerificationClient({
      now: () => new Date('2026-08-29T12:00:00.000Z'),
    }).verify({ ...expectedRequest, purchaseCapability: 'other-capability' });
    const client = new HttpMandateVerificationClient({
      baseUrl: 'https://mandate.example.test/',
      requestProofSigner: { sign: async () => 'merchant-service-proof' },
      receiptKeys: new Map([
        ['mandate-demo-2026-08', testOnlyMandateReceiptPublicJwk],
      ]),
      now: () => new Date('2026-08-29T12:00:01.000Z'),
      fetch: (async () =>
        new Response(JSON.stringify(resultForAnotherCapability), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    });

    await expect(client.verify(expectedRequest)).rejects.toMatchObject({
      name: 'MandateVerificationBridgeError',
      status: 502,
    });
  });

  it('rejects a Mandate receipt whose settlement state differs from the response', async () => {
    const request = {
      merchantId: 'harvest-market',
      merchantOrderRef: 'order_001',
      quoteId: 'quote_001',
      purchaseCapability: 'opaque-capability',
      idempotencyKey: 'verification-bridge-004',
      requestId: 'req_bridge_004',
    };
    const signedResult = await new DemoMandateVerificationClient({
      now: () => new Date('2026-08-29T12:00:00.000Z'),
      settlement: {
        paymentOperationId: 'operation_bridge_001',
        settlementStatus: 'captured',
      },
    }).verify(request);
    const client = new HttpMandateVerificationClient({
      baseUrl: 'https://mandate.example.test/',
      requestProofSigner: { sign: async () => 'merchant-service-proof' },
      receiptKeys: new Map([
        ['mandate-demo-2026-08', testOnlyMandateReceiptPublicJwk],
      ]),
      now: () => new Date('2026-08-29T12:00:01.000Z'),
      fetch: (async () =>
        new Response(JSON.stringify({
          ...signedResult,
          settlementStatus: 'failed',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    });

    await expect(client.verify(request)).rejects.toMatchObject({
      name: 'MandateVerificationBridgeError',
      status: 502,
    });
  });

  it('fails closed when the Mandate bridge times out', async () => {
    const client = new HttpMandateVerificationClient({
      baseUrl: 'https://mandate.example.test/',
      requestProofSigner: { sign: async () => 'merchant-service-proof' },
      receiptKeys: new Map(),
      timeoutMs: 10,
      fetch: ((_, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as typeof fetch,
    });

    await expect(
      client.verify({
        merchantId: 'harvest-market',
        merchantOrderRef: 'order_003',
        quoteId: 'quote_003',
        purchaseCapability: 'opaque-capability',
        idempotencyKey: 'verification-bridge-003',
        requestId: 'req_bridge_003',
      }),
    ).rejects.toMatchObject({
      name: 'MandateVerificationBridgeError',
      status: 503,
    });
  });
});

type TestAppOptions = Omit<Parameters<typeof createDemoMerchantMocksApp>[0], 'expectedAgentProof'>;

function createTestApp(
  options: TestAppOptions = {},
) {
  let sequence = 0;

  return createDemoMerchantMocksApp({
    ...options,
    expectedAgentProof: agentProof,
    now: () => new Date('2026-08-29T12:00:00.000Z'),
    idGenerator: () => `test-${++sequence}`,
  });
}

function requestJson(
  app: ReturnType<typeof createDemoMerchantMocksApp>,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  method: 'POST' | 'GET' = 'POST',
) {
  return app.request(path, {
    method,
    headers: {
      'x-agent-request-proof': agentProof,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

type SearchResponse = {
  merchantId: string;
  offers: Array<{
    merchantCategoryId: string;
  }>;
};

type QuoteResponse = {
  quote: MerchantQuote;
};

type ApiErrorResponse = {
  error: { code: string };
};

type VerificationResponse = {
  order: {
    status: string;
    verification: {
      reasonCode: string;
    };
  };
};
