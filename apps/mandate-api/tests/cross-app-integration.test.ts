import { calculateCanonicalCartHash } from '@agentic-mandates/domain';
import { exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  createPaymentVaultApp,
  InMemoryHostedSetupSessionStore,
  InMemoryMockPaymentScenarioResolver,
  InMemoryPaymentAuthorizationStore,
  InMemoryPaymentMethodStore,
  InMemoryServiceProofReplayStore,
  InMemoryVaultIdempotencyStore,
  JoseServiceJwsAuthenticator,
  DeterministicMockYunoRouter,
  type MockGatewayScenario,
} from '../../payment-vault/src/index.js';
import {
  createMerchantMocksApp,
  HttpMandateVerificationClient,
  JoseMerchantRequestAuthenticator as JoseMerchantEndpointRequestAuthenticator,
  type MerchantRequestProofKey,
  type MerchantRequestProofKeyResolver,
  type MerchantRequestReplayClaim,
  type MerchantRequestReplayClaimResult,
  type MerchantRequestReplayStore,
} from '../../merchant-mocks/src/index.js';
import { InMemoryIdempotencyStore as InMemoryMerchantIdempotencyStore } from '../../merchant-mocks/src/idempotency.js';
import { InMemoryMerchantOrderStore } from '../../merchant-mocks/src/order-store.js';
import { InMemoryQuoteStore } from '../../merchant-mocks/src/quote-store.js';
import { AllowAllMerchantRateLimiter } from '../../merchant-mocks/src/rate-limit.js';
import {
  createAgentClient,
  createEs256RequestProofSigner,
  createMerchantApiClient,
  createMerchantClient,
} from '../../../packages/sdk/src/index.js';

import { createMandateApiApp } from '../src/app.js';
import {
  InMemoryIdempotencyStore,
  InMemoryMandateStateStore,
  InMemoryMandateTrustPolicyStore,
} from '../src/in-memory.js';
import {
  HttpMerchantQuoteSource,
} from '../src/http-merchant-quote-source.js';
import { HttpPaymentVaultClient } from '../src/http-payment-vault-client.js';
import {
  InMemoryRequestProofReplayStore,
  JoseAgentRequestAuthenticator,
  JoseMerchantRequestAuthenticator as JoseMandateMerchantRequestAuthenticator,
  type RequestProofActorKind,
  type RequestProofKeyRegistry,
} from '../src/request-auth.js';
import { createEs256ServiceRequestProofSigner } from '../src/service-request-proof.js';
import type {
  MerchantRegistry,
  PrincipalRequestAuthenticator,
  RegisteredMerchant,
  TaxonomyNormalizer,
} from '../src/types.js';

const CLOCK_NOW = new Date('2026-08-29T12:00:00.000Z');
const MANDATE_BASE_URL = 'https://mandate.integration.test/';
const MERCHANT_BASE_URL = 'https://merchant.integration.test/';
const VAULT_BASE_URL = 'https://vault.integration.test/';

describe('cross-app AgentPay integration', () => {
  it('settles through the isolated Vault and keeps payment data outside the merchant boundary', async () => {
    const fixture = await createCrossAppFixture();
    const merchantClient = createMerchantApiClient({
      baseUrl: `${MERCHANT_BASE_URL}merchants/harvest-market/`,
      merchantId: fixture.merchant.id,
      requestProofSigner: fixture.agentRequestProofSigner,
      fetch: fixture.fetch,
      idGenerator: fixture.sdkIdGenerator,
    });
    const agentClient = createAgentClient({
      baseUrl: MANDATE_BASE_URL,
      requestProofSigner: fixture.agentRequestProofSigner,
      fetch: fixture.fetch,
      idGenerator: fixture.sdkIdGenerator,
    });

    const search = await merchantClient.search(
      { query: 'rice', limit: 1 },
      { requestId: 'request-search-001' },
    );
    expect(search.offers).toHaveLength(1);

    const quote = await merchantClient.createQuote(
      { items: [{ merchantSku: search.offers[0]!.merchantSku, quantity: 1 }] },
      { idempotencyKey: 'quote-integration-001', requestId: 'request-quote-001' },
    );

    const intent = await agentClient.submitPurchaseIntent(
      {
        mandateId: fixture.mandateId,
        merchantId: fixture.merchant.id,
        quoteId: quote.id,
      },
      { idempotencyKey: 'intent-integration-001', requestId: 'request-intent-001' },
    );
    expect(intent).toMatchObject({
      decision: 'approved',
      reasonCode: 'AUTHORIZED',
      mandateStatus: 'active',
    });
    expect(intent.purchaseCapability).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);

    const order = await merchantClient.verifyOrder(
      {
        merchantOrderRef: quote.merchantOrderRef,
        quoteId: quote.id,
        purchaseCapability: intent.purchaseCapability!,
      },
      { idempotencyKey: 'order-integration-001', requestId: 'request-order-001' },
    );

    expect(order.order).toMatchObject({
      merchantId: fixture.merchant.id,
      merchantOrderRef: quote.merchantOrderRef,
      quoteId: quote.id,
      status: 'verification_approved',
      verification: {
        decision: 'approved',
        reasonCode: 'AUTHORIZED',
        mandateStatus: 'active',
        settlementStatus: 'captured',
      },
    });
    expect(order.order.verification?.paymentOperationId).toMatch(/^op_/);
    expect(order.order.verification?.verificationReceipt).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);

    const merchantPayload = JSON.stringify(order);
    expect(merchantPayload).not.toContain('paymentMethodId');
    expect(merchantPayload).not.toContain(fixture.paymentMethod.id);
    expect(merchantPayload).not.toContain('providerTokenRef');
    expect(merchantPayload).not.toContain(fixture.paymentMethod.providerTokenRef);

    const receivedByMerchant = fixture.merchantRequests.map((request) => request.body).join('\n');
    expect(receivedByMerchant).not.toContain('paymentMethodId');
    expect(receivedByMerchant).not.toContain(fixture.paymentMethod.id);
    expect(receivedByMerchant).not.toContain(fixture.paymentMethod.providerTokenRef);
    expect(fixture.vaultRequests.map((request) => request.path)).toEqual([
      '/internal/v1/payment-authorizations',
      expect.stringMatching(/^\/internal\/v1\/payment-authorizations\/pa_.+\/capture$/),
    ]);

    const staleMerchantRetry = createMerchantClient({
      baseUrl: MANDATE_BASE_URL,
      requestProofSigner: fixture.merchantRequestProofSigner,
      fetch: fixture.fetch,
      idGenerator: fixture.sdkIdGenerator,
    });
    const replay = await staleMerchantRetry.verifyPurchase(
      {
        merchantId: fixture.merchant.id,
        merchantOrderRef: quote.merchantOrderRef,
        quoteId: quote.id,
        purchaseCapability: intent.purchaseCapability!,
      },
      { idempotencyKey: 'mandate-replay-001', requestId: 'request-replay-001' },
    );
    expect(replay).toMatchObject({
      decision: 'rejected',
      reasonCode: 'CAPABILITY_REPLAYED',
      mandateStatus: 'active',
    });
    expect(fixture.vaultRequests).toHaveLength(2);
  });

  it('keeps an authorization timeout non-fulfillable until a later Vault reconciliation captures it', async () => {
    const fixture = await createCrossAppFixture({ paymentScenario: 'authorization_timeout' });
    const merchantClient = createMerchantApiClient({
      baseUrl: `${MERCHANT_BASE_URL}merchants/harvest-market/`,
      merchantId: fixture.merchant.id,
      requestProofSigner: fixture.agentRequestProofSigner,
      fetch: fixture.fetch,
      idGenerator: fixture.sdkIdGenerator,
    });
    const agentClient = createAgentClient({
      baseUrl: MANDATE_BASE_URL,
      requestProofSigner: fixture.agentRequestProofSigner,
      fetch: fixture.fetch,
      idGenerator: fixture.sdkIdGenerator,
    });
    const search = await merchantClient.search(
      { query: 'rice', limit: 1 },
      { requestId: 'request-timeout-search-001' },
    );
    const quote = await merchantClient.createQuote(
      { items: [{ merchantSku: search.offers[0]!.merchantSku, quantity: 1 }] },
      { idempotencyKey: 'quote-timeout-001', requestId: 'request-timeout-quote-001' },
    );
    const intent = await agentClient.submitPurchaseIntent(
      {
        mandateId: fixture.mandateId,
        merchantId: fixture.merchant.id,
        quoteId: quote.id,
      },
      { idempotencyKey: 'intent-timeout-001', requestId: 'request-timeout-intent-001' },
    );

    const pending = await merchantClient.verifyOrder(
      {
        merchantOrderRef: quote.merchantOrderRef,
        quoteId: quote.id,
        purchaseCapability: intent.purchaseCapability!,
      },
      { idempotencyKey: 'order-timeout-001', requestId: 'request-timeout-order-001' },
    );
    expect(pending.order).toMatchObject({
      status: 'settlement_pending',
      verification: {
        decision: 'approved',
        reasonCode: 'PAYMENT_RECONCILIATION_REQUIRED',
        settlementStatus: 'pending',
      },
    });
    expect(fixture.vaultRequests.map((request) => request.path)).toEqual([
      '/internal/v1/payment-authorizations',
    ]);

    const captured = await merchantClient.verifyOrder(
      {
        merchantOrderRef: quote.merchantOrderRef,
        quoteId: quote.id,
        purchaseCapability: intent.purchaseCapability!,
      },
      { idempotencyKey: 'order-timeout-002', requestId: 'request-timeout-order-002' },
    );
    expect(captured.order).toMatchObject({
      status: 'verification_approved',
      verification: {
        decision: 'approved',
        reasonCode: 'AUTHORIZED',
        settlementStatus: 'captured',
      },
    });
    expect(fixture.vaultRequests.map((request) => request.path)).toEqual([
      '/internal/v1/payment-authorizations',
      expect.stringMatching(/^\/internal\/v1\/payment-authorizations\/pa_.+$/),
      expect.stringMatching(/^\/internal\/v1\/payment-authorizations\/pa_.+\/capture$/),
    ]);
    expect(JSON.stringify(captured)).not.toContain('paymentMethodId');
    expect(JSON.stringify(captured)).not.toContain(fixture.paymentMethod.providerTokenRef);
  });
});

type CrossAppFixture = {
  agentRequestProofSigner: ReturnType<typeof createEs256RequestProofSigner>;
  merchantRequestProofSigner: ReturnType<typeof createEs256RequestProofSigner>;
  fetch: typeof globalThis.fetch;
  sdkIdGenerator: (prefix: 'idem_' | 'req_') => string;
  mandateId: string;
  merchant: {
    id: string;
    signingKeyId: string;
    signingPublicJwk: JWK;
  };
  paymentMethod: {
    id: string;
    providerTokenRef: string;
  };
  merchantRequests: Array<{ path: string; body: string }>;
  vaultRequests: Array<{ path: string; body: string }>;
};

async function createCrossAppFixture(options: {
  paymentScenario?: MockGatewayScenario;
} = {}): Promise<CrossAppFixture> {
  const clock = () => new Date(CLOCK_NOW);
  const [agentKey, merchantServiceKey, mandateServiceKey, merchantSigningKey, citySigningKey, capabilityKey, receiptKey] =
    await Promise.all([
      createKeyMaterial(),
      createKeyMaterial(),
      createKeyMaterial(),
      createKeyMaterial(),
      createKeyMaterial(),
      createKeyMaterial(),
      createKeyMaterial(),
    ]);

  const agentId = 'agent-integration';
  const agentKeyId = 'agent-key-integration-001';
  const merchantId = 'harvest-market';
  const merchantServiceKeyId = 'merchant-service-key-001';
  const mandateServiceId = 'mandate-service';
  const mandateServiceKeyId = 'mandate-service-key-001';
  const mandateId = 'mandate-integration-001';
  const principalId = 'principal-integration';

  const merchant = {
    id: merchantId,
    signingKeyId: 'merchant-quote-key-001',
    signingPublicJwk: merchantSigningKey.publicJwk,
  };
  const cityMerchant = {
    id: 'city-basket',
    signingKeyId: 'city-quote-key-001',
    signingPublicJwk: citySigningKey.publicJwk,
  };

  const paymentMethodStore = new InMemoryPaymentMethodStore({
    idGenerator: () => 'integrationpaymentmethod0001',
  });
  const paymentMethod = await paymentMethodStore.createTestMethod({
    fixture: 'visa_4242',
    createdAt: clock().toISOString(),
  });

  const vaultApp = createPaymentVaultApp({
    serviceAuthenticator: new JoseServiceJwsAuthenticator({
      resolveVerificationKey: async (keyId) =>
        keyId === mandateServiceKeyId ? mandateServiceKey.publicJwk : undefined,
      replayStore: new InMemoryServiceProofReplayStore(clock),
      now: clock,
    }),
    paymentMethodStore,
    authorizationStore: new InMemoryPaymentAuthorizationStore(),
    hostedSetupSessionStore: new InMemoryHostedSetupSessionStore(),
    idempotencyStore: new InMemoryVaultIdempotencyStore(),
    yunoRouter: new DeterministicMockYunoRouter(
      new InMemoryMockPaymentScenarioResolver(options.paymentScenario ?? 'approved'),
    ),
    hostedBaseUrl: VAULT_BASE_URL,
    allowedHostedReturnOrigins: ['https://app.integration.test'],
    now: clock,
    idGenerator: countedIdGenerator('vault'),
  });

  const merchantRequestProofSigner = createEs256RequestProofSigner({
    issuer: merchantId,
    keyId: merchantServiceKeyId,
    signingKey: merchantServiceKey.privateKey,
    now: clock,
    proofIdGenerator: countedIdGenerator('merchant_proof'),
  });
  const mandateServiceProofSigner = createEs256ServiceRequestProofSigner({
    issuer: mandateServiceId,
    keyId: mandateServiceKeyId,
    signingKey: mandateServiceKey.privateKey,
    now: clock,
    proofIdGenerator: countedIdGenerator('mandate_proof'),
  });
  const agentRequestProofSigner = createEs256RequestProofSigner({
    issuer: agentId,
    keyId: agentKeyId,
    signingKey: agentKey.privateKey,
    now: clock,
    proofIdGenerator: countedIdGenerator('agent_proof'),
  });

  const routes = new Map<string, (request: Request) => Promise<Response>>();
  const merchantRequests: Array<{ path: string; body: string }> = [];
  const vaultRequests: Array<{ path: string; body: string }> = [];
  const fetch = createInProcessFetch(routes);

  const merchantApp = createMerchantMocksApp({
    requestAuthenticator: new JoseMerchantEndpointRequestAuthenticator({
      keyResolver: new StaticMerchantRequestProofKeyResolver([
        {
          keyId: agentKeyId,
          publicJwk: agentKey.publicJwk,
          actor: { type: 'agent', id: agentId },
          status: 'active',
        },
        {
          keyId: mandateServiceKeyId,
          publicJwk: mandateServiceKey.publicJwk,
          actor: { type: 'mandate-service', id: mandateServiceId },
          status: 'active',
        },
      ]),
      replayStore: new InMemoryMerchantRequestProofReplayStore(),
      now: clock,
    }),
    mandateVerifier: new HttpMandateVerificationClient({
      baseUrl: MANDATE_BASE_URL,
      requestProofSigner: {
        sign: async (input) =>
          merchantRequestProofSigner.sign({
            method: input.method,
            url: input.url,
            rawBody: new TextEncoder().encode(input.body),
            audience: input.audience,
          }),
      },
      receiptKeys: new Map([['mandate-receipt-key-001', receiptKey.publicJwk]]),
      fetch,
      now: clock,
    }),
    signingKeys: new Map([
      [merchant.id, merchantSigningKey.privateJwk],
      [cityMerchant.id, citySigningKey.privateJwk],
    ]),
    merchantDefinitions: [
      merchantDefinition(merchant),
      merchantDefinition(cityMerchant),
    ],
    quoteStore: new InMemoryQuoteStore(),
    quoteIdempotencyStore: new InMemoryMerchantIdempotencyStore(),
    verificationIdempotencyStore: new InMemoryMerchantIdempotencyStore(),
    orderStore: new InMemoryMerchantOrderStore(countedIdGenerator('claim')),
    rateLimiter: new AllowAllMerchantRateLimiter(),
    now: clock,
    idGenerator: countedIdGenerator('merchant'),
  });

  const registeredMerchant: RegisteredMerchant = {
    merchantId: merchant.id,
    status: 'active',
    trustTier: 'high',
    quoteEndpoint: `${MERCHANT_BASE_URL}merchants/${merchant.id}/v1/agents-pay/`,
    quoteVerificationKeys: new Map([[merchant.signingKeyId, merchant.signingPublicJwk]]),
  };
  const registry: MerchantRegistry = {
    async get(requestedMerchantId) {
      return requestedMerchantId === registeredMerchant.merchantId ? registeredMerchant : undefined;
    },
  };
  const taxonomyNormalizer: TaxonomyNormalizer = {
    async normalize(input) {
      const canonicalLineItems = input.quote.lineItems.map((lineItem) => ({
        merchantSku: lineItem.merchantSku,
        canonicalCategoryId: 'food.pantry.rice',
      }));
      const taxonomyVersion = 'taxonomy-integration-001';
      return {
        ok: true,
        normalized: {
          quoteId: input.quote.id,
          merchantId: input.quote.merchantId,
          taxonomyVersion,
          canonicalLineItems,
          canonicalCartHash: calculateCanonicalCartHash({
            quoteId: input.quote.id,
            merchantId: input.quote.merchantId,
            taxonomyVersion,
            merchantCartHash: input.quote.merchantCartHash,
            canonicalLineItems,
          }),
        },
      };
    },
  };
  const principalAuthenticator: PrincipalRequestAuthenticator = {
    async authenticate(input) {
      const principal = input.request.headers.get('x-test-principal-id');
      return principal === principalId
        ? { ok: true, actor: { principalId } }
        : {
            ok: false,
            code: 'ACTOR_NOT_ALLOWED',
            message: 'A test principal identity is required.',
          };
    },
  };

  const mandateApp = createMandateApiApp({
    agentAuthenticator: new JoseAgentRequestAuthenticator({
      keyRegistry: new StaticMandateRequestProofKeyRegistry([
        { actorKind: 'agent', keyId: agentKeyId, actorId: agentId, publicKey: agentKey.publicJwk },
        {
          actorKind: 'merchant',
          keyId: merchantServiceKeyId,
          actorId: merchantId,
          publicKey: merchantServiceKey.publicJwk,
        },
      ]),
      replayStore: new InMemoryRequestProofReplayStore(clock),
      now: clock,
    }),
    merchantAuthenticator: new JoseMandateMerchantRequestAuthenticator({
      keyRegistry: new StaticMandateRequestProofKeyRegistry([
        { actorKind: 'agent', keyId: agentKeyId, actorId: agentId, publicKey: agentKey.publicJwk },
        {
          actorKind: 'merchant',
          keyId: merchantServiceKeyId,
          actorId: merchantId,
          publicKey: merchantServiceKey.publicJwk,
        },
      ]),
      replayStore: new InMemoryRequestProofReplayStore(clock),
      now: clock,
    }),
    principalAuthenticator,
    merchantRegistry: registry,
    merchantQuoteSource: new HttpMerchantQuoteSource({
      requestProofSigner: mandateServiceProofSigner,
      fetch,
    }),
    taxonomyNormalizer,
    stateStore: new InMemoryMandateStateStore({
      mandates: [
        {
          id: mandateId,
          version: 1,
          principalId,
          agentId,
          status: 'active',
          paymentMethodId: paymentMethod.id,
          policy: {
            permittedAgentId: agentId,
            merchantAllowlist: [merchant.id],
            allowedCanonicalCategoryPaths: ['food'],
            maxAmountMinor: 2_000,
            totalBudgetMinor: 5_000,
            currencies: ['USD'],
            maxUses: 2,
            escalationAllowlist: [],
          },
          validFrom: new Date(CLOCK_NOW.getTime() - 60_000).toISOString(),
          validUntil: new Date(CLOCK_NOW.getTime() + 60 * 60_000).toISOString(),
          createdAt: clock().toISOString(),
        },
      ],
    }),
    trustPolicyStore: new InMemoryMandateTrustPolicyStore(
      new Map([[`${mandateId}:1`, { minimumMerchantTrustTier: 'standard' }]]),
    ),
    intentIdempotencyStore: new InMemoryIdempotencyStore(),
    verificationIdempotencyStore: new InMemoryIdempotencyStore(),
    paymentVault: new HttpPaymentVaultClient({
      baseUrl: VAULT_BASE_URL,
      requestProofSigner: mandateServiceProofSigner,
      fetch,
    }),
    capabilitySigningKey: {
      keyId: 'mandate-capability-key-001',
      privateJwk: capabilityKey.privateJwk,
    },
    capabilityVerificationKeys: new Map([
      ['mandate-capability-key-001', capabilityKey.publicJwk],
    ]),
    receiptSigningKey: {
      keyId: 'mandate-receipt-key-001',
      privateJwk: receiptKey.privateJwk,
    },
    now: clock,
    idGenerator: prefixedIdGenerator('mandate'),
  });

  routes.set(new URL(MERCHANT_BASE_URL).origin, async (request) => {
    const copy = request.clone();
    merchantRequests.push({ path: new URL(copy.url).pathname, body: await copy.text() });
    return merchantApp.request(request);
  });
  routes.set(new URL(MANDATE_BASE_URL).origin, async (request) => mandateApp.request(request));
  routes.set(new URL(VAULT_BASE_URL).origin, async (request) => {
    const copy = request.clone();
    vaultRequests.push({ path: new URL(copy.url).pathname, body: await copy.text() });
    return vaultApp.request(request);
  });

  let sdkId = 0;
  return {
    agentRequestProofSigner,
    merchantRequestProofSigner,
    fetch,
    sdkIdGenerator: (prefix) => `${prefix}integration-${++sdkId}`,
    mandateId,
    merchant,
    paymentMethod,
    merchantRequests,
    vaultRequests,
  };
}

function merchantDefinition(input: {
  id: string;
  signingKeyId: string;
  signingPublicJwk: JWK;
}) {
  return {
    id: input.id,
    name: input.id === 'harvest-market' ? 'Harvest Market' : 'City Basket',
    basePath: `/merchants/${input.id}`,
    merchantCatalogVersion: `${input.id}-catalog-001`,
    signingKeyId: input.signingKeyId,
    signingPublicJwk: input.signingPublicJwk,
    pricing: {
      taxBasisPoints: 0,
      flatShippingMinor: 0,
      freeShippingAtMinor: 0,
    },
    catalog: [
      {
        merchantSku: input.id === 'harvest-market' ? 'harvest-rice-001' : 'city-rice-001',
        merchantCategoryId: 'local.rice',
        name: 'Jasmine Rice',
        description: 'Integration test rice.',
        searchTerms: ['rice'],
        unitAmountMinor: 799,
        currency: 'USD' as const,
        availableQuantity: 10,
        attributes: { test: true },
      },
    ],
  };
}

async function createKeyMaterial(): Promise<{
  privateKey: CryptoKey;
  privateJwk: JWK;
  publicJwk: JWK;
}> {
  const pair = await generateKeyPair('ES256', { extractable: true });
  return {
    privateKey: pair.privateKey,
    privateJwk: await exportJWK(pair.privateKey),
    publicJwk: await exportJWK(pair.publicKey),
  };
}

function createInProcessFetch(
  routes: ReadonlyMap<string, (request: Request) => Promise<Response>>,
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const route = routes.get(new URL(request.url).origin);
    if (!route) {
      throw new TypeError(`No in-process application is registered for ${request.url}.`);
    }
    return route(request);
  };
}

function countedIdGenerator(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}-${String(++sequence).padStart(16, '0')}`;
}

function prefixedIdGenerator(scope: string): (prefix: string) => string {
  let sequence = 0;
  return (prefix) => `${prefix}${scope}-${String(++sequence).padStart(16, '0')}`;
}

type RegisteredMandateProofKey = {
  actorKind: RequestProofActorKind;
  keyId: string;
  actorId: string;
  publicKey: JWK;
};

class StaticMandateRequestProofKeyRegistry implements RequestProofKeyRegistry {
  private readonly keys: ReadonlyMap<string, RegisteredMandateProofKey>;

  constructor(keys: readonly RegisteredMandateProofKey[]) {
    this.keys = new Map(keys.map((key) => [`${key.actorKind}:${key.keyId}`, key]));
  }

  async resolve(input: { actorKind: RequestProofActorKind; keyId: string }) {
    const key = this.keys.get(`${input.actorKind}:${input.keyId}`);
    return key
      ? { status: 'active' as const, actorId: key.actorId, publicKey: key.publicKey }
      : { status: 'unknown' as const };
  }
}

class StaticMerchantRequestProofKeyResolver implements MerchantRequestProofKeyResolver {
  private readonly keys: ReadonlyMap<string, MerchantRequestProofKey>;

  constructor(keys: readonly MerchantRequestProofKey[]) {
    this.keys = new Map(keys.map((key) => [key.keyId, key]));
  }

  async getByKeyId(keyId: string): Promise<MerchantRequestProofKey | undefined> {
    return this.keys.get(keyId);
  }
}

class InMemoryMerchantRequestProofReplayStore implements MerchantRequestReplayStore {
  private readonly claims = new Set<string>();

  async claim(
    input: MerchantRequestReplayClaim,
  ): Promise<MerchantRequestReplayClaimResult> {
    const claim = `${input.keyId}:${input.jti}`;
    if (this.claims.has(claim)) {
      return { kind: 'replayed' };
    }
    this.claims.add(claim);
    return { kind: 'claimed' };
  }
}
