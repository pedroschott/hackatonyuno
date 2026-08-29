import {
  decodeProtectedHeader,
  jwtVerify,
  type CryptoKey,
} from 'jose';
import { describe, expect, it } from 'vitest';

import {
  AgentPayApiError,
  AgentPayClientError,
  createAgentClient,
  createEs256RequestProofSigner,
  createMerchantClient,
  createMerchantApiClient,
  sha256Base64Url,
} from '../src/index.js';

const now = new Date('2026-08-29T12:00:00.000Z');
const isoNow = now.toISOString();
const isoLater = new Date(now.getTime() + 60_000).toISOString();
const bodyHash = 'a'.repeat(43);

const quote = {
  id: 'quote_1',
  merchantId: 'harvest-market',
  merchantOrderRef: 'order_1',
  issuedAt: isoNow,
  merchantCatalogVersion: 'catalog_1',
  lineItems: [
    {
      merchantSku: 'rice_1',
      merchantCategoryId: 'grocery/rice',
      name: 'Rice',
      quantity: 1,
      unitAmountMinor: 399,
      attributes: { size: '1kg' },
    },
  ],
  subtotalMinor: 399,
  shippingMinor: 0,
  taxMinor: 0,
  totalMinor: 399,
  currency: 'USD',
  expiresAt: isoLater,
  merchantCartHash: bodyHash,
  keyId: 'merchant_key_1',
  signature: 'a.b.c',
};

async function signingKeys(): Promise<CryptoKeyPair> {
  return globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
}

function signer(privateKey: CryptoKey, identity = 'demo-agent') {
  let proofSequence = 0;
  return createEs256RequestProofSigner({
    issuer: identity,
    keyId: `${identity}-key-1`,
    signingKey: privateKey,
    now: () => now,
    proofIdGenerator: () => `proof_${++proofSequence}`,
  });
}

function ids() {
  let sequence = 0;
  return (prefix: 'idem_' | 'req_') => `${prefix}${++sequence}_fixture`;
}

async function verifiedRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  publicKey: CryptoKey,
  audience: string,
  expectation: {
    header?: 'x-agent-request-proof' | 'x-merchant-request-proof';
    identity?: string;
  } = {},
): Promise<Request> {
  const request = new Request(input, init);
  const header = expectation.header ?? 'x-agent-request-proof';
  const identity = expectation.identity ?? 'demo-agent';
  const proof = request.headers.get(header);
  expect(proof).toBeTruthy();
  expect(decodeProtectedHeader(proof!).alg).toBe('ES256');
  expect(decodeProtectedHeader(proof!).kid).toBe(`${identity}-key-1`);
  expect(decodeProtectedHeader(proof!).typ).toBe('application/agentic-mandates-request-proof+jws');

  const verified = await jwtVerify(proof!, publicKey, {
    algorithms: ['ES256'],
    issuer: identity,
    subject: identity,
    audience,
    currentDate: now,
  });
  expect(verified.payload.htm).toBe(request.method);
  expect(verified.payload.htu).toBe(new URL(request.url).toString());
  expect(verified.payload.body_hash).toBe(
    await sha256Base64Url(new TextEncoder().encode(await request.clone().text())),
  );
  expect(verified.payload.jti).toMatch(/^proof_\d+$/);
  expect(Number(verified.payload.exp) - Number(verified.payload.iat)).toBeLessThanOrEqual(60);
  return request;
}

describe('internal AgentPay SDK', () => {
  it('signs and validates an agent purchase intent with an idempotency key', async () => {
    const keys = await signingKeys();
    const seenRequests: Request[] = [];
    const client = createAgentClient({
      baseUrl: 'https://mandates.example/',
      requestProofSigner: signer(keys.privateKey),
      idGenerator: ids(),
      fetch: async (input, init) => {
        const request = await verifiedRequest(input, init, keys.publicKey, 'mandate-api');
        seenRequests.push(request);
        return jsonResponse({
          decision: 'approved',
          reasonCode: 'AUTHORIZED',
          mandateStatus: 'active',
          purchaseCapability: 'a.b.c',
          expiresAt: isoLater,
        });
      },
    });

    const result = await client.submitPurchaseIntent({
      mandateId: 'mandate_1',
      merchantId: 'harvest-market',
      quoteId: 'quote_1',
    });

    expect(result.decision).toBe('approved');
    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0]?.url).toBe('https://mandates.example/v1/agent/intents');
    expect(seenRequests[0]?.headers.get('idempotency-key')).toBe('idem_2_fixture');
    expect(seenRequests[0]?.headers.get('x-request-id')).toBe('req_1_fixture');
  });

  it('covers merchant search, quote retrieval, and order verification with the correct headers', async () => {
    const keys = await signingKeys();
    const paths: string[] = [];
    const idGenerator = ids();
    const client = createMerchantApiClient({
      baseUrl: 'https://merchant.example/merchants/harvest-market/',
      merchantId: 'harvest-market',
      requestProofSigner: signer(keys.privateKey),
      idGenerator,
      fetch: async (input, init) => {
        const request = await verifiedRequest(
          input,
          init,
          keys.publicKey,
          'merchant-api:harvest-market',
        );
        const url = new URL(request.url);
        paths.push(url.pathname);
        if (url.pathname.endsWith('/search')) {
          expect(request.headers.get('idempotency-key')).toBeNull();
          return jsonResponse({
            merchantId: 'harvest-market',
            merchantName: 'Harvest Market',
            merchantCatalogVersion: 'catalog_1',
            offers: [
              {
                merchantSku: 'rice_1',
                merchantCategoryId: 'grocery/rice',
                name: 'Rice',
                description: 'Long grain rice',
                unitAmountMinor: 399,
                currency: 'USD',
                availableQuantity: 4,
                attributes: { size: '1kg' },
              },
            ],
          });
        }
        if (url.pathname.endsWith('/quotes')) {
          expect(request.headers.get('idempotency-key')).toBeTruthy();
          return jsonResponse({ quote }, 201);
        }
        if (url.pathname.endsWith('/quotes/quote_1')) {
          expect(request.headers.get('idempotency-key')).toBeNull();
          return jsonResponse({ quote });
        }
        expect(request.headers.get('idempotency-key')).toBeTruthy();
        return jsonResponse({
          order: {
            merchantId: 'harvest-market',
            merchantOrderRef: 'order_1',
            quoteId: 'quote_1',
            status: 'verification_approved',
            createdAt: isoNow,
            updatedAt: isoNow,
            verification: {
              decision: 'approved',
              reasonCode: 'AUTHORIZED',
              verificationId: 'verification_1',
              mandateStatus: 'active',
              verificationReceipt: 'a.b.c',
              paymentOperationId: 'operation_1',
              settlementStatus: 'captured',
            },
          },
        });
      },
    });

    const search = await client.search({ query: 'rice' });
    const createdQuote = await client.createQuote({
      items: [{ merchantSku: 'rice_1', quantity: 1 }],
    });
    const readQuote = await client.getQuote('quote_1');
    const order = await client.verifyOrder({
      merchantOrderRef: 'order_1',
      quoteId: 'quote_1',
      purchaseCapability: 'a.b.c',
    });

    expect(search.offers[0]?.merchantSku).toBe('rice_1');
    expect(createdQuote.id).toBe('quote_1');
    expect(readQuote.merchantOrderRef).toBe('order_1');
    expect(order.order.verification?.decision).toBe('approved');
    expect(paths).toEqual([
      '/merchants/harvest-market/v1/agents-pay/search',
      '/merchants/harvest-market/v1/agents-pay/quotes',
      '/merchants/harvest-market/v1/agents-pay/quotes/quote_1',
      '/merchants/harvest-market/v1/agents-pay/orders/order_1/verification',
    ]);
  });

  it('sends a merchant proof and idempotency key to the Mandate verification handoff', async () => {
    const keys = await signingKeys();
    const client = createMerchantClient({
      baseUrl: 'https://mandates.example/',
      requestProofSigner: signer(keys.privateKey, 'harvest-merchant'),
      idGenerator: ids(),
      fetch: async (input, init) => {
        const request = await verifiedRequest(input, init, keys.publicKey, 'mandate-api', {
          header: 'x-merchant-request-proof',
          identity: 'harvest-merchant',
        });
        expect(request.url).toBe('https://mandates.example/v1/merchant/verifications');
        expect(request.headers.get('x-agent-request-proof')).toBeNull();
        expect(request.headers.get('idempotency-key')).toBe('idem_2_fixture');
        expect(await request.clone().json()).toEqual({
          merchantId: 'harvest-market',
          merchantOrderRef: 'order_1',
          quoteId: 'quote_1',
          purchaseCapability: 'a.b.c',
        });
        return jsonResponse({
          decision: 'approved',
          reasonCode: 'AUTHORIZED',
          verificationId: 'verification_1',
          mandateStatus: 'active',
          verificationReceipt: 'a.b.c',
          paymentOperationId: 'operation_1',
          settlementStatus: 'captured',
        });
      },
    });

    const result = await client.verifyPurchase({
      merchantId: 'harvest-market',
      merchantOrderRef: 'order_1',
      quoteId: 'quote_1',
      purchaseCapability: 'a.b.c',
    });

    expect(result.decision).toBe('approved');
    expect(result.settlementStatus).toBe('captured');
  });

  it('rejects a valid-looking merchant response from a different merchant boundary', async () => {
    const keys = await signingKeys();
    const client = createMerchantApiClient({
      baseUrl: 'https://merchant.example/merchants/harvest-market/',
      merchantId: 'harvest-market',
      requestProofSigner: signer(keys.privateKey),
      idGenerator: ids(),
      fetch: async () =>
        jsonResponse({
          merchantId: 'city-basket',
          merchantName: 'City Basket',
          merchantCatalogVersion: 'catalog_1',
          offers: [],
        }),
    });

    await expect(client.search({ query: 'rice' })).rejects.toMatchObject({
      name: 'AgentPayClientError',
      code: 'MERCHANT_ENDPOINT_MISMATCH',
    } satisfies Partial<AgentPayClientError>);
  });

  it('preserves a server reason code instead of requiring callers to parse a message', async () => {
    const keys = await signingKeys();
    const client = createAgentClient({
      baseUrl: 'https://mandates.example/',
      requestProofSigner: signer(keys.privateKey),
      idGenerator: ids(),
      fetch: async () =>
        jsonResponse(
          {
            error: {
              code: 'AMOUNT_EXCEEDED',
              message: 'The quote total exceeds the mandate amount limit.',
              requestId: 'request_1',
            },
          },
          403,
        ),
    });

    await expect(
      client.submitPurchaseIntent({
        mandateId: 'mandate_1',
        merchantId: 'harvest-market',
        quoteId: 'quote_1',
      }),
    ).rejects.toMatchObject({
      name: 'AgentPayApiError',
      code: 'AMOUNT_EXCEEDED',
      status: 403,
      requestId: 'request_1',
    } satisfies Partial<AgentPayApiError>);
  });

  it('fails closed when a successful response violates the shared contract', async () => {
    const keys = await signingKeys();
    const client = createAgentClient({
      baseUrl: 'https://mandates.example/',
      requestProofSigner: signer(keys.privateKey),
      idGenerator: ids(),
      fetch: async () => jsonResponse({ decision: 'approved' }),
    });

    await expect(
      client.submitPurchaseIntent({
        mandateId: 'mandate_1',
        merchantId: 'harvest-market',
        quoteId: 'quote_1',
      }),
    ).rejects.toMatchObject({
      name: 'AgentPayClientError',
      code: 'RESPONSE_SCHEMA_INVALID',
    } satisfies Partial<AgentPayClientError>);
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
