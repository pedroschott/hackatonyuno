import { randomUUID } from 'node:crypto';

import { SignJWT, importJWK, type JWK } from 'jose';

import {
  JoseServiceJwsAuthenticator,
  InMemoryServiceProofReplayStore,
  MANDATE_SERVICE_ID,
  PAYMENT_VAULT_AUDIENCE,
  canonicalRequestUrl,
} from './auth.js';
import { requestBodyHash } from './canonical.js';
import { InMemoryVaultIdempotencyStore } from './idempotency.js';
import {
  DeterministicMockYunoRouter,
  InMemoryMockPaymentScenarioResolver,
  type MockGatewayScenario,
  type MockYunoRouterOptions,
} from './mock-yuno.js';
import { InMemoryHostedSetupSessionStore } from './hosted-setup-store.js';
import { InMemoryPaymentAuthorizationStore } from './payment-authorization-store.js';
import { InMemoryPaymentMethodStore } from './payment-method-store.js';
import { createPaymentVaultApp } from './app.js';

const mandateServicePrivateJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: '_U6_KjIfZq3bwaeySN0mCRglstUGvHQ3Y8dRi5QKGQs',
  y: 'zD61frNPab0ZGjRq7CBdR8qxvfWvkrIXbaI_jdSnF_8',
  d: 'DWmGeBitSBus1dF9R6g6aHEksjSO7RcGbsE3ULykTqg',
  key_ops: ['sign'],
  ext: true,
};

const mandateServicePublicJwk: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: '_U6_KjIfZq3bwaeySN0mCRglstUGvHQ3Y8dRi5QKGQs',
  y: 'zD61frNPab0ZGjRq7CBdR8qxvfWvkrIXbaI_jdSnF_8',
  key_ops: ['verify'],
  ext: true,
};

const testKeyId = 'mandate-demo-2026-08';

export type DemoPaymentVaultOptions = {
  now?: () => Date;
  scenarios?: ReadonlyMap<string, MockGatewayScenario>;
  mockYunoOptions?: MockYunoRouterOptions;
};

/**
 * Test-only composition root. It uses the same ES256 verifier as runtime code
 * and is intentionally not exported by the production module entry point.
 */
export function createDemoPaymentVaultApp(options: DemoPaymentVaultOptions = {}) {
  const now = options.now ?? (() => new Date('2026-08-29T12:00:00.000Z'));
  const replayStore = new InMemoryServiceProofReplayStore(now);
  const authenticator = new JoseServiceJwsAuthenticator({
    resolveVerificationKey: async (keyId) =>
      keyId === testKeyId ? mandateServicePublicJwk : undefined,
    replayStore,
    now,
  });
  const scenarioResolver = new InMemoryMockPaymentScenarioResolver('approved', options.scenarios);
  const yunoRouter = new DeterministicMockYunoRouter(
    scenarioResolver,
    undefined,
    undefined,
    options.mockYunoOptions,
  );

  return {
    app: createPaymentVaultApp({
      serviceAuthenticator: authenticator,
      paymentMethodStore: new InMemoryPaymentMethodStore(),
      authorizationStore: new InMemoryPaymentAuthorizationStore(),
      hostedSetupSessionStore: new InMemoryHostedSetupSessionStore(),
      idempotencyStore: new InMemoryVaultIdempotencyStore(),
      yunoRouter,
      hostedBaseUrl: 'https://vault.example.test',
      allowedHostedReturnOrigins: ['https://app.example.test'],
      now,
    }),
    scenarioResolver,
    yunoRouter,
  };
}

export async function createMandateServiceRequest(input: {
  method: string;
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  now?: () => Date;
  audience?: string;
  proofId?: string;
  proofType?: string;
  url?: string;
}): Promise<Request> {
  const method = input.method.toUpperCase();
  const url = input.url ?? `http://localhost${input.path}`;
  const serializedBody = input.body === undefined ? undefined : JSON.stringify(input.body);
  const rawBody = new TextEncoder().encode(serializedBody ?? '');
  const signingRequest = new Request(url, { method });
  const proofInput: {
    request: Request;
    rawBody: Uint8Array;
    now?: () => Date;
    audience?: string;
    proofId?: string;
    proofType?: string;
  } = {
    request: signingRequest,
    rawBody,
  };
  if (input.now) {
    proofInput.now = input.now;
  }
  if (input.audience) {
    proofInput.audience = input.audience;
  }
  if (input.proofId) {
    proofInput.proofId = input.proofId;
  }
  if (input.proofType) {
    proofInput.proofType = input.proofType;
  }
  const proof = await createMandateServiceProof(proofInput);
  const headers = new Headers({ 'x-mandate-request-proof': proof });
  if (serializedBody !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (input.idempotencyKey) {
    headers.set('idempotency-key', input.idempotencyKey);
  }
  const requestInit: RequestInit = {
    method,
    headers,
  };
  if (serializedBody !== undefined) {
    requestInit.body = serializedBody;
  }
  return new Request(url, requestInit);
}

export async function createMandateServiceProof(input: {
  request: Request;
  rawBody: Uint8Array;
  now?: () => Date;
  audience?: string;
  proofId?: string;
  proofType?: string;
}): Promise<string> {
  const now = input.now?.() ?? new Date('2026-08-29T12:00:00.000Z');
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const signingKey = await importJWK(mandateServicePrivateJwk, 'ES256');
  return new SignJWT({
    htm: input.request.method.toUpperCase(),
    htu: canonicalRequestUrl(input.request),
    body_hash: requestBodyHash(input.rawBody),
  })
    .setProtectedHeader({
      alg: 'ES256',
      kid: testKeyId,
      typ: input.proofType ?? 'application/agentic-mandates-request-proof+jws',
    })
    .setIssuer(MANDATE_SERVICE_ID)
    .setSubject(MANDATE_SERVICE_ID)
    .setAudience(input.audience ?? PAYMENT_VAULT_AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 60)
    .setJti(input.proofId ?? `proof_${randomUUID()}`)
    .sign(signingKey);
}
