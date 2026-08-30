import type { JWK } from 'jose';

import type {
  ReasonCode,
  SettlementStatus,
  VerificationResult,
} from '@agentic-mandates/contracts';
import { requestFingerprint, sha256Base64Url } from '@agentic-mandates/domain';

import {
  type MerchantRequestAuthenticationInput,
  type MerchantRequestAuthenticationResult,
  type MerchantRequestAuthenticator,
} from './auth.js';
import { merchantDefinitions } from './catalog.js';
import {
  type MandateVerificationClient,
  type MandateVerificationRequest,
  signMandateVerificationReceipt,
} from './mandate-verifier.js';
import { InMemoryIdempotencyStore } from './idempotency.js';
import { InMemoryMerchantOrderStore } from './order-store.js';
import { InMemoryQuoteStore } from './quote-store.js';
import {
  AllowAllMerchantRateLimiter,
  type MerchantRateLimiter,
} from './rate-limit.js';
import { createMerchantMocksApp, type MerchantMocksOptions } from './app.js';

export const autopartsPrivateJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'uBUFVoWW2YeBOibdYSSYlV_uyAG58V7_lzMHbPWfYBw',
  y: '0o2yc-c6uIY301hip_fuAmoc1Ce9QSxN9XE0hzbQVbk',
  d: 'ZhsWKVZs_Ex77EEIUCeSy2IXDVR1I7OytfV_zWEvDeI',
  key_ops: ['sign'],
  ext: true,
};

export const harvestMarketPrivateJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: '7C4izDlK5_4FlwtsBXTTWJpLa4ZlQbSirEZWWWBwKbo',
  y: 'OuzRkDK0WIADuQhn8rlZEO9SiuX1pVuzN-s3AzCfe6w',
  d: 'c1Tq0pxZlO4hnzcWO7l-6rCQLof9lcOgqdv2LIl-hhc',
  key_ops: ['sign'],
  ext: true,
};

export const cityBasketPrivateJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'Y15afop1gkzDoqOqQ77BrISq-uSqjPxTSfGQxEeQ8Yc',
  y: 'WIh3aiQKK9A4sr7TXOkbW0uh1gN3mjLqgGHU8asUcRE',
  d: 'RBzIxQ65G6QeRVj4tICko-L5TbB_fi3UG2SNlu0_Ow0',
  key_ops: ['sign'],
  ext: true,
};

export const mareBotanicalsPrivateJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'Iv1Wb5kXS5k41A0M-dwBjhoeFLkEPWFtjU4U-gzB5Yg',
  y: 'syS_Gu66yn4l-IZxXMKtNug8nrZsRLukk8Wk2C2ACqA',
  d: 'PPD-bbNtawcJAhXjnxKpEBx51JyL-rLWTgQHwICgUyg',
  key_ops: ['sign'],
  ext: true,
};

export const pneufastPrivateJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'rip6umXYk0Vl415u2PNbN5JMcRQrM51AbPdQAeC2coo',
  y: 'tPOW7x5QIYynzPW2Cyv9GjsMhxSUt30PWSkS6e68M2M',
  d: '7UZu-YSgLk2ojj1s55n4X2BVlHkZrQTVAPpkRgmugbc',
  key_ops: ['sign'],
  ext: true,
};

export const mandateReceiptPrivateJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: '_U6_KjIfZq3bwaeySN0mCRglstUGvHQ3Y8dRi5QKGQs',
  y: 'zD61frNPab0ZGjRq7CBdR8qxvfWvkrIXbaI_jdSnF_8',
  d: 'DWmGeBitSBus1dF9R6g6aHEksjSO7RcGbsE3ULykTqg',
  key_ops: ['sign'],
  ext: true,
};

/** Test-only material for local tests; it is intentionally not re-exported by src/index.ts. */
export const testOnlyMandateReceiptPublicJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: '_U6_KjIfZq3bwaeySN0mCRglstUGvHQ3Y8dRi5QKGQs',
  y: 'zD61frNPab0ZGjRq7CBdR8qxvfWvkrIXbaI_jdSnF_8',
  key_ops: ['verify'],
  ext: true,
};

export type DemoVerificationScenario =
  | 'valid'
  | 'approval_required'
  | 'cart_changed'
  | 'wrong_merchant'
  | 'unmapped_local_category'
  | 'revoked_mandate'
  | 'expired_mandate';

/**
 * Local harness only. It checks fixture header values instead of a JWS, but it
 * models distinct agent and Mandate-service actors for route-boundary tests.
 */
export class DemoProofAuthenticator implements MerchantRequestAuthenticator {
  constructor(
    private readonly options: {
      agentProof: string;
      mandateServiceProof?: string;
      agentId?: string;
      mandateServiceId?: string;
    },
  ) {}

  async authenticate({ request }: MerchantRequestAuthenticationInput): Promise<MerchantRequestAuthenticationResult> {
    if (request.headers.get('x-agent-request-proof') === this.options.agentProof) {
      return {
        ok: true,
        actor: { type: 'agent', id: this.options.agentId ?? 'agent-demo' },
      };
    }

    if (
      this.options.mandateServiceProof &&
      request.headers.get('x-mandate-request-proof') === this.options.mandateServiceProof
    ) {
      return {
        ok: true,
        actor: {
          type: 'mandate-service',
          id: this.options.mandateServiceId ?? 'mandate-service-demo',
        },
      };
    }

    return {
      ok: false,
      status: 401,
      code: 'AGENT_PROOF_INVALID',
      message: 'The local demo request proof is missing or invalid.',
    };
  }
}

/**
 * Test-only verifier with a valid, tuple-bound ES256 receipt. It never acts as
 * policy logic; a test selects its fixed response before requests are made.
 */
export class DemoMandateVerificationClient implements MandateVerificationClient {
  constructor(
    private readonly options: {
      scenario?: DemoVerificationScenario;
      now?: () => Date;
      settlement?: {
        paymentOperationId: string;
        settlementStatus: SettlementStatus;
      };
    } = {},
  ) {}

  async verify(request: MandateVerificationRequest): Promise<VerificationResult> {
    const scenario = this.options.scenario ?? 'valid';
    const now = this.options.now?.() ?? new Date();
    const reference = requestFingerprint({ scenario, ...request }).slice(0, 24);
    const expiresAt = new Date(now.getTime() + 60_000).toISOString();
    const result: Omit<VerificationResult, 'verificationReceipt'> = {
      ...resultForScenario(scenario, reference, expiresAt),
      ...this.options.settlement,
    };
    const verificationReceipt = await signMandateVerificationReceipt(
      {
        verificationId: result.verificationId,
        merchantId: request.merchantId,
        merchantOrderRef: request.merchantOrderRef,
        quoteId: request.quoteId,
        capabilityHash: sha256Base64Url(request.purchaseCapability),
        requestId: request.requestId,
        decision: result.decision,
        reasonCode: result.reasonCode,
        mandateStatus: result.mandateStatus,
        issuedAt: now.toISOString(),
        expiresAt: result.expiresAt,
        keyId: 'mandate-demo-2026-08',
        ...(result.paymentOperationId && result.settlementStatus
          ? {
              paymentOperationId: result.paymentOperationId,
              settlementStatus: result.settlementStatus,
            }
          : {}),
      },
      mandateReceiptPrivateJwk,
    );

    return { ...result, verificationReceipt };
  }
}

export type DemoMerchantMocksOptions = Omit<
  Partial<MerchantMocksOptions>,
  | 'requestAuthenticator'
  | 'mandateVerifier'
  | 'signingKeys'
  | 'quoteStore'
  | 'quoteIdempotencyStore'
  | 'verificationIdempotencyStore'
  | 'orderStore'
  | 'rateLimiter'
> & {
  expectedAgentProof: string;
  expectedMandateServiceProof?: string;
  mandateVerifier?: MandateVerificationClient;
  rateLimiter?: MerchantRateLimiter;
};

const merchantPrivateKeys: Record<string, JWK> = {
  mrc_autoparts: autopartsPrivateJwk,
  mrc_harvest_market: harvestMarketPrivateJwk,
  mrc_city_basket: cityBasketPrivateJwk,
  mrc_mare_botanicals: mareBotanicalsPrivateJwk,
  mrc_pneufast: pneufastPrivateJwk,
  autoparts: autopartsPrivateJwk,
  'harvest-market': harvestMarketPrivateJwk,
  'city-basket': cityBasketPrivateJwk,
  'mare-botanicals': mareBotanicalsPrivateJwk,
  pneufast: pneufastPrivateJwk,
};

/**
 * Creates a completely in-memory, deterministic test/demo app. It is not a
 * Vercel production bootstrap and must not be imported by browser code.
 */
export function createDemoMerchantMocksApp(options: DemoMerchantMocksOptions) {
  const definitions = options.merchantDefinitions ?? merchantDefinitions;
  const signingKeys = new Map(
    definitions.map((merchant) => [
      merchant.id,
      merchantPrivateKeys[merchant.id] ?? harvestMarketPrivateJwk,
    ]),
  );

  return createMerchantMocksApp({
    ...options,
    requestAuthenticator: new DemoProofAuthenticator({
      agentProof: options.expectedAgentProof,
      ...(options.expectedMandateServiceProof
        ? { mandateServiceProof: options.expectedMandateServiceProof }
        : {}),
    }),
    mandateVerifier: options.mandateVerifier ?? new DemoMandateVerificationClient(),
    signingKeys,
    quoteStore: new InMemoryQuoteStore(),
    quoteIdempotencyStore: new InMemoryIdempotencyStore(),
    verificationIdempotencyStore: new InMemoryIdempotencyStore(),
    orderStore: new InMemoryMerchantOrderStore(),
    rateLimiter: options.rateLimiter ?? new AllowAllMerchantRateLimiter(),
  });
}

function resultForScenario(
  scenario: DemoVerificationScenario,
  reference: string,
  expiresAt: string,
): Omit<VerificationResult, 'verificationReceipt'> {
  switch (scenario) {
    case 'valid':
      return approvedVerification(reference, expiresAt);
    case 'approval_required':
      return {
        decision: 'approval_required',
        reasonCode: 'HUMAN_APPROVAL_REQUIRED',
        verificationId: `verify_${reference}`,
        mandateStatus: 'active',
        expiresAt,
      };
    case 'cart_changed':
      return rejectedVerification(reference, 'CART_CHANGED', 'active');
    case 'wrong_merchant':
      return rejectedVerification(reference, 'MERCHANT_MISMATCH', 'active');
    case 'unmapped_local_category':
      return rejectedVerification(reference, 'UNMAPPED_CATEGORY', 'active');
    case 'revoked_mandate':
      return rejectedVerification(reference, 'MANDATE_REVOKED', 'revoked');
    case 'expired_mandate':
      return rejectedVerification(reference, 'MANDATE_EXPIRED', 'expired');
  }
}

function approvedVerification(
  reference: string,
  expiresAt: string,
): Omit<VerificationResult, 'verificationReceipt'> {
  return {
    decision: 'approved',
    reasonCode: 'AUTHORIZED',
    verificationId: `verify_${reference}`,
    mandateStatus: 'active',
    expiresAt,
    paymentOperationId: `operation_${reference}`,
    settlementStatus: 'captured',
  };
}

function rejectedVerification(
  reference: string,
  reasonCode: ReasonCode,
  mandateStatus: 'active' | 'revoked' | 'expired',
): Omit<VerificationResult, 'verificationReceipt'> {
  return {
    decision: 'rejected',
    reasonCode,
    verificationId: `verify_${reference}`,
    mandateStatus,
  };
}
