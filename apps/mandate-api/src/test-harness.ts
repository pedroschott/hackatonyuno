import {
  MerchantQuotePayloadSchema,
  MandateSchema,
  type Mandate,
  type MandatePolicy,
  type MerchantQuote,
} from '@agentic-mandates/contracts';
import {
  calculateCanonicalCartHash,
  calculateMerchantCartHash,
  canonicalJson,
} from '@agentic-mandates/domain';
import { CompactSign, exportJWK, generateKeyPair, importJWK, type JWK } from 'jose';

import { createMandateApiApp } from './app.js';
import {
  InMemoryIdempotencyStore,
  InMemoryMandateStateStore,
  InMemoryMandateTrustPolicyStore,
} from './in-memory.js';
import type {
  AgentRequestAuthenticator,
  AgentAuthenticationResult,
  MandateApiOptions,
  MerchantAuthenticationResult,
  MerchantQuoteSource,
  MerchantRegistry,
  MerchantRequestAuthenticator,
  MerchantTrustTier,
  NormalizeQuoteResult,
  PaymentAuthorizationResult,
  PaymentAuthorizationStatusResult,
  PaymentCaptureResult,
  PaymentVaultClient,
  PaymentVoidResult,
  PrincipalAuthenticationResult,
  PrincipalRequestAuthenticator,
  RegisteredMerchant,
  RequestAuthenticationInput,
  TaxonomyNormalizer,
} from './types.js';

const textEncoder = new TextEncoder();

export const TEST_NOW = '2026-08-29T12:00:00.000Z';

export type TestPaymentScenario =
  | 'captured'
  | 'declined'
  | 'authorization_pending'
  | 'capture_failed';

export type TestQuoteInput = {
  merchantId?: 'merchant-a' | 'merchant-b';
  quoteId?: string;
  merchantOrderRef?: string;
  merchantSku?: string;
  merchantCategoryId?: string;
  canonicalCategoryId?: string;
  unitAmountMinor?: number;
  quantity?: number;
  currency?: 'USD';
  shippingMinor?: number;
  taxMinor?: number;
  expiresAt?: string;
};

export type MandateApiTestHarness = {
  app: ReturnType<typeof createMandateApiApp>;
  clock: MutableClock;
  stateStore: InMemoryMandateStateStore;
  paymentVault: TestPaymentVault;
  mandate: Mandate;
  quotes: InMemoryMerchantQuoteSource;
  addQuote(input?: TestQuoteInput): Promise<MerchantQuote>;
  agentHeaders(agentId?: string): HeadersInit;
  merchantHeaders(merchantId?: string): HeadersInit;
  principalHeaders(principalId?: string): HeadersInit;
};

/**
 * A self-contained fixture for the critical circuit. It intentionally uses
 * header identities only inside tests; production must supply JWS/WebAuthn
 * adapters to createMandateApiApp.
 */
export async function createMandateApiTestHarness(options: {
  mandate?: Partial<Omit<Mandate, 'policy'>> & { policy?: Partial<MandatePolicy> };
  paymentScenario?: TestPaymentScenario;
  minimumMerchantTrustTier?: MerchantTrustTier;
  merchantATrustTier?: MerchantTrustTier;
  merchantBTrustTier?: MerchantTrustTier;
  schedulerBearerSecret?: string;
  recurrenceScheduler?: import('./types.js').RecurrenceScheduler;
  now?: string;
} = {}): Promise<MandateApiTestHarness> {
  const clock = new MutableClock(options.now ?? TEST_NOW);
  const [merchantAKeys, merchantBKeys, capabilityKeys, receiptKeys] = await Promise.all([
    createEcKeys(),
    createEcKeys(),
    createEcKeys(),
    createEcKeys(),
  ]);
  const registry = new InMemoryMerchantRegistry([
    registeredMerchant(
      'merchant-a',
      'https://merchant-a.test/v1/agents-pay/',
      merchantAKeys.publicJwk,
      options.merchantATrustTier ?? 'standard',
    ),
    registeredMerchant(
      'merchant-b',
      'https://merchant-b.test/v1/agents-pay/',
      merchantBKeys.publicJwk,
      options.merchantBTrustTier ?? 'standard',
    ),
  ]);
  const quotes = new InMemoryMerchantQuoteSource(
    new Map([
      ['merchant-a', merchantAKeys.privateJwk],
      ['merchant-b', merchantBKeys.privateJwk],
    ]),
  );
  const taxonomy = new InMemoryTaxonomyNormalizer();
  taxonomy.set('merchant-a', 'local.rice', 'food.pantry.rice');
  taxonomy.set('merchant-b', 'local.rice', 'food.pantry.rice');

  const mandate = createTestMandate(clock, options.mandate);
  const stateStore = new InMemoryMandateStateStore({ mandates: [mandate] });
  const trustPolicyStore = new InMemoryMandateTrustPolicyStore(
    new Map([
      [
        `${mandate.id}:${mandate.version}`,
        { minimumMerchantTrustTier: options.minimumMerchantTrustTier ?? 'low' },
      ],
    ]),
  );
  const paymentVault = new TestPaymentVault(options.paymentScenario ?? 'captured');
  let idCounter = 0;
  const apiOptions: MandateApiOptions = {
    agentAuthenticator: new TestAgentAuthenticator(),
    merchantAuthenticator: new TestMerchantAuthenticator(),
    principalAuthenticator: new TestPrincipalAuthenticator(),
    merchantRegistry: registry,
    merchantQuoteSource: quotes,
    taxonomyNormalizer: taxonomy,
    stateStore,
    trustPolicyStore,
    intentIdempotencyStore: new InMemoryIdempotencyStore(),
    verificationIdempotencyStore: new InMemoryIdempotencyStore(),
    paymentVault,
    capabilitySigningKey: {
      keyId: 'capability-key-1',
      privateJwk: capabilityKeys.privateJwk,
    },
    capabilityVerificationKeys: new Map([['capability-key-1', capabilityKeys.publicJwk]]),
    receiptSigningKey: {
      keyId: 'receipt-key-1',
      privateJwk: receiptKeys.privateJwk,
    },
    now: clock.now,
    idGenerator: (prefix) => `${prefix}${++idCounter}`,
    schedulerBearerSecret: options.schedulerBearerSecret,
    recurrenceScheduler: options.recurrenceScheduler,
  };

  return {
    app: createMandateApiApp(apiOptions),
    clock,
    stateStore,
    paymentVault,
    mandate,
    quotes,
    addQuote: async (input = {}) => {
      const merchantId = input.merchantId ?? 'merchant-a';
      taxonomy.set(
        merchantId,
        input.merchantCategoryId ?? 'local.rice',
        input.canonicalCategoryId ?? 'food.pantry.rice',
      );
      const quote = await quotes.resign(await createTestQuote(clock, input));
      quotes.set(merchantId, quote);
      return quote;
    },
    agentHeaders: (agentId = mandate.agentId) => ({ 'x-test-agent-id': agentId }),
    merchantHeaders: (merchantId = 'merchant-a') => ({ 'x-test-merchant-id': merchantId }),
    principalHeaders: (principalId = mandate.principalId) => ({
      'x-test-principal-id': principalId,
    }),
  };
}

export class MutableClock {
  private value: Date;

  constructor(now: string) {
    this.value = new Date(now);
  }

  now = (): Date => new Date(this.value);

  set(now: string): void {
    this.value = new Date(now);
  }

  advance(milliseconds: number): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }
}

export class InMemoryMerchantQuoteSource implements MerchantQuoteSource {
  private readonly values = new Map<string, MerchantQuote>();

  constructor(private readonly signingKeys: ReadonlyMap<string, JWK>) {}

  async getQuote(input: {
    merchant: RegisteredMerchant;
    quoteId: string;
  }): Promise<unknown | undefined> {
    const quote = this.values.get(this.key(input.merchant.merchantId, input.quoteId));
    return quote ? structuredClone(quote) : undefined;
  }

  set(merchantId: string, quote: MerchantQuote): void {
    if (quote.merchantId !== merchantId) {
      throw new Error('Fixture quote merchant does not match its storage key.');
    }
    this.values.set(this.key(merchantId, quote.id), structuredClone(quote));
  }

  async resign(quote: MerchantQuote): Promise<MerchantQuote> {
    const privateJwk = this.signingKeys.get(quote.merchantId);
    if (!privateJwk) {
      throw new Error('No fixture signing key exists for this merchant.');
    }
    return signQuote(quote, privateJwk);
  }

  private key(merchantId: string, quoteId: string): string {
    return `${merchantId}:${quoteId}`;
  }
}

export class InMemoryTaxonomyNormalizer implements TaxonomyNormalizer {
  private readonly mappings = new Map<string, string>();

  set(merchantId: string, merchantCategoryId: string, canonicalCategoryId: string): void {
    this.mappings.set(`${merchantId}:${merchantCategoryId}`, canonicalCategoryId);
  }

  async normalize(input: {
    merchant: RegisteredMerchant;
    quote: MerchantQuote;
  }): Promise<NormalizeQuoteResult> {
    const canonicalLineItems = input.quote.lineItems.map((lineItem) => {
      const canonicalCategoryId = this.mappings.get(
        `${input.merchant.merchantId}:${lineItem.merchantCategoryId}`,
      );
      return canonicalCategoryId
        ? { merchantSku: lineItem.merchantSku, canonicalCategoryId }
        : undefined;
    });
    if (canonicalLineItems.some((lineItem) => !lineItem)) {
      return {
        ok: false,
        code: 'UNMAPPED_CATEGORY',
        message: 'No exact canonical category mapping exists for this merchant category.',
      };
    }

    const lines = canonicalLineItems as Array<{
      merchantSku: string;
      canonicalCategoryId: string;
    }>;
    const taxonomyVersion = 'taxonomy-2026-08';
    return {
      ok: true,
      normalized: {
        quoteId: input.quote.id,
        merchantId: input.quote.merchantId,
        taxonomyVersion,
        canonicalLineItems: lines,
        canonicalCartHash: calculateCanonicalCartHash({
          quoteId: input.quote.id,
          merchantId: input.quote.merchantId,
          taxonomyVersion,
          merchantCartHash: input.quote.merchantCartHash,
          canonicalLineItems: lines,
        }),
      },
    };
  }
}

export class TestPaymentVault implements PaymentVaultClient {
  readonly calls: Array<'authorize' | 'status' | 'capture' | 'void'> = [];

  constructor(private scenario: TestPaymentScenario) {}

  setScenario(scenario: TestPaymentScenario): void {
    this.scenario = scenario;
  }

  async authorize(input: {
    paymentOperationId: string;
    paymentMethodId: string;
    amountMinor: number;
    currency: string;
    merchantReference: string;
    idempotencyKey: string;
  }): Promise<PaymentAuthorizationResult> {
    this.calls.push('authorize');
    if (this.scenario === 'declined') {
      return { kind: 'declined', reasonCode: 'TEST_CARD_DECLINED' };
    }
    if (this.scenario === 'authorization_pending') {
      return {
        kind: 'reconciliation_required',
        authorizationId: `pa_${input.paymentOperationId}`,
        reasonCode: 'TEST_TIMEOUT',
      };
    }
    return { kind: 'authorized', authorizationId: `pa_${input.paymentOperationId}` };
  }

  async getAuthorizationStatus(input: {
    authorizationId: string;
    paymentOperationId: string;
  }): Promise<PaymentAuthorizationStatusResult> {
    this.calls.push('status');
    if (this.scenario === 'declined') {
      return { kind: 'declined', reasonCode: 'TEST_CARD_DECLINED' };
    }
    return { kind: 'authorized', authorizationId: input.authorizationId };
  }

  async capture(_input: {
    authorizationId: string;
    paymentOperationId: string;
    idempotencyKey: string;
  }): Promise<PaymentCaptureResult> {
    this.calls.push('capture');
    if (this.scenario === 'capture_failed') {
      return { kind: 'failed', reasonCode: 'TEST_CAPTURE_FAILED' };
    }
    return { kind: 'captured' };
  }

  async void(_input: {
    authorizationId: string;
    paymentOperationId: string;
    idempotencyKey: string;
  }): Promise<PaymentVoidResult> {
    this.calls.push('void');
    return { kind: 'voided' };
  }
}

export async function createTestQuote(
  clock: MutableClock,
  input: TestQuoteInput = {},
): Promise<MerchantQuote> {
  const merchantId = input.merchantId ?? 'merchant-a';
  const unitAmountMinor = input.unitAmountMinor ?? 799;
  const quantity = input.quantity ?? 1;
  const shippingMinor = input.shippingMinor ?? 0;
  const taxMinor = input.taxMinor ?? 0;
  const issuedAt = clock.now().toISOString();
  const payload = MerchantQuotePayloadSchema.parse({
    id: input.quoteId ?? 'quote-rice-1',
    merchantId,
    merchantOrderRef: input.merchantOrderRef ?? 'order-rice-1',
    issuedAt,
    merchantCatalogVersion: 'catalog-2026-08',
    lineItems: [
      {
        merchantSku: input.merchantSku ?? 'rice-1',
        merchantCategoryId: input.merchantCategoryId ?? 'local.rice',
        name: 'Fixture Rice',
        quantity,
        unitAmountMinor,
        attributes: { fixture: true },
      },
    ],
    subtotalMinor: unitAmountMinor * quantity,
    shippingMinor,
    taxMinor,
    totalMinor: unitAmountMinor * quantity + shippingMinor + taxMinor,
    currency: input.currency ?? 'USD',
    expiresAt:
      input.expiresAt ?? new Date(clock.now().getTime() + 5 * 60_000).toISOString(),
    merchantCartHash: calculateMerchantCartHash({
      merchantId,
      merchantCatalogVersion: 'catalog-2026-08',
      lineItems: [
        {
          merchantSku: input.merchantSku ?? 'rice-1',
          merchantCategoryId: input.merchantCategoryId ?? 'local.rice',
          name: 'Fixture Rice',
          quantity,
          unitAmountMinor,
          attributes: { fixture: true },
        },
      ],
      subtotalMinor: unitAmountMinor * quantity,
      shippingMinor,
      taxMinor,
      totalMinor: unitAmountMinor * quantity + shippingMinor + taxMinor,
      currency: input.currency ?? 'USD',
    }),
    keyId: merchantId === 'merchant-a' ? 'merchant-a-quote-key-1' : 'merchant-b-quote-key-1',
  });

  /* The caller receives a signed quote only after the harness injects its key. */
  return { ...payload, signature: '' };
}

function createTestMandate(
  clock: MutableClock,
  overrides: Partial<Omit<Mandate, 'policy'>> & { policy?: Partial<MandatePolicy> } = {},
): Mandate {
  const { policy: policyOverrides, ...mandateOverrides } = overrides;
  const policy: MandatePolicy = {
    permittedAgentId: 'agent-demo',
    merchantAllowlist: ['merchant-a'],
    allowedCanonicalCategoryPaths: ['food'],
    maxAmountMinor: 2_000,
    totalBudgetMinor: 5_000,
    currencies: ['USD'],
    maxUses: 3,
    escalationAllowlist: [],
    ...policyOverrides,
  };
  const mandate: Mandate = {
    id: 'mandate-demo',
    version: 1,
    principalId: 'principal-demo',
    agentId: policy.permittedAgentId,
    status: 'active',
    paymentMethodId: 'pm-demo-4242',
    policy,
    validFrom: new Date(clock.now().getTime() - 60_000).toISOString(),
    validUntil: new Date(clock.now().getTime() + 24 * 60 * 60_000).toISOString(),
    createdAt: clock.now().toISOString(),
    ...mandateOverrides,
  };
  return MandateSchema.parse(mandate);
}

class InMemoryMerchantRegistry implements MerchantRegistry {
  private readonly merchants = new Map<string, RegisteredMerchant>();

  constructor(entries: readonly RegisteredMerchant[]) {
    for (const entry of entries) {
      this.merchants.set(entry.merchantId, entry);
    }
  }

  async get(merchantId: string): Promise<RegisteredMerchant | undefined> {
    return this.merchants.get(merchantId);
  }
}

class TestAgentAuthenticator implements AgentRequestAuthenticator {
  async authenticate(input: RequestAuthenticationInput): Promise<AgentAuthenticationResult> {
    const agentId = input.request.headers.get('x-test-agent-id');
    return agentId
      ? { ok: true, actor: { agentId, keyId: 'test-agent-key' } }
      : { ok: false, code: 'AGENT_AUTH_REQUIRED', message: 'A test agent identity is required.' };
  }
}

class TestMerchantAuthenticator implements MerchantRequestAuthenticator {
  async authenticate(input: RequestAuthenticationInput): Promise<MerchantAuthenticationResult> {
    const merchantId = input.request.headers.get('x-test-merchant-id');
    return merchantId
      ? { ok: true, actor: { merchantId, keyId: 'test-merchant-key' } }
      : { ok: false, code: 'MERCHANT_AUTH_REQUIRED', message: 'A test merchant identity is required.' };
  }
}

class TestPrincipalAuthenticator implements PrincipalRequestAuthenticator {
  async authenticate(input: RequestAuthenticationInput): Promise<PrincipalAuthenticationResult> {
    const principalId = input.request.headers.get('x-test-principal-id');
    return principalId
      ? { ok: true, actor: { principalId } }
      : { ok: false, code: 'ACTOR_NOT_ALLOWED', message: 'A test principal identity is required.' };
  }
}

function registeredMerchant(
  merchantId: string,
  quoteEndpoint: string,
  publicJwk: JWK,
  trustTier: MerchantTrustTier,
): RegisteredMerchant {
  return {
    merchantId,
    status: 'active',
    trustTier,
    quoteEndpoint,
    quoteVerificationKeys: new Map([
      [merchantId === 'merchant-a' ? 'merchant-a-quote-key-1' : 'merchant-b-quote-key-1', publicJwk],
    ]),
  };
}

async function createEcKeys(): Promise<{ privateJwk: JWK; publicJwk: JWK }> {
  const pair = await generateKeyPair('ES256', { extractable: true });
  return {
    privateJwk: await exportJWK(pair.privateKey),
    publicJwk: await exportJWK(pair.publicKey),
  };
}

async function signQuote(unsignedQuote: MerchantQuote, privateJwk: JWK): Promise<MerchantQuote> {
  const { signature: _signature, ...payload } = unsignedQuote;
  const key = await importJWK(privateJwk, 'ES256');
  const signature = await new CompactSign(textEncoder.encode(canonicalJson(payload)))
    .setProtectedHeader({
      alg: 'ES256',
      kid: payload.keyId,
      typ: 'application/agents-pay-quote+jws',
    })
    .sign(key);
  return { ...payload, signature };
}
