import type { VerificationResult } from '@agentic-mandates/contracts';
import { describe, expect, it } from 'vitest';

import { createMandateApiTestHarness } from '../src/test-harness.js';

type IntentResult = {
  decision: 'approved' | 'rejected' | 'approval_required';
  reasonCode: string;
  mandateStatus: string;
  purchaseCapability?: string;
  expiresAt?: string;
};

describe('Mandate API critical authorization circuit', () => {
  it('issues a quote-bound capability and settles a valid merchant verification', async () => {
    const harness = await createMandateApiTestHarness();
    const quote = await harness.addQuote();

    const intent = await submitIntent(harness, quote.id, quote.merchantId);
    expect(intent.status).toBe(200);
    const issued = (await intent.json()) as IntentResult;
    expect(issued).toMatchObject({
      decision: 'approved',
      reasonCode: 'AUTHORIZED',
      mandateStatus: 'active',
    });
    expect(issued.purchaseCapability).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);

    const verification = await submitVerification(harness, {
      merchantId: quote.merchantId,
      merchantOrderRef: quote.merchantOrderRef,
      quoteId: quote.id,
      purchaseCapability: issued.purchaseCapability!,
      idempotencyKey: 'verify-valid-1',
      requestId: 'request-valid-1',
    });
    expect(verification.status).toBe(200);
    const result = (await verification.json()) as VerificationResult;
    expect(result).toMatchObject({
      decision: 'approved',
      reasonCode: 'AUTHORIZED',
      mandateStatus: 'active',
      settlementStatus: 'captured',
    });
    expect(result.paymentOperationId).toMatch(/^op_/);
    expect(result.verificationReceipt).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
    expect(harness.paymentVault.calls).toEqual(['authorize', 'capture']);
  });

  it('rejects an intent that is over the configured amount limit', async () => {
    const harness = await createMandateApiTestHarness({
      mandate: { policy: { maxAmountMinor: 500, escalationAllowlist: [] } },
    });
    const quote = await harness.addQuote({ unitAmountMinor: 799 });

    const response = await submitIntent(harness, quote.id, quote.merchantId, 'intent-over-limit');
    expect(response.status).toBe(200);
    expect((await response.json()) as IntentResult).toEqual({
      decision: 'rejected',
      reasonCode: 'AMOUNT_EXCEEDED',
      mandateStatus: 'active',
    });
    expect(harness.paymentVault.calls).toEqual([]);
  });

  it('requires a quote-bound human approval for an under-trusted registry merchant when configured', async () => {
    const harness = await createMandateApiTestHarness({
      minimumMerchantTrustTier: 'high',
      merchantATrustTier: 'low',
      mandate: { policy: { escalationAllowlist: ['LOW_TRUST_MERCHANT'] } },
    });
    const quote = await harness.addQuote();

    const response = await submitIntent(harness, quote.id, quote.merchantId, 'intent-low-trust');
    expect(response.status).toBe(200);
    expect((await response.json()) as IntentResult).toEqual({
      decision: 'approval_required',
      reasonCode: 'LOW_TRUST_MERCHANT',
      mandateStatus: 'active',
    });
    expect(harness.paymentVault.calls).toEqual([]);
  });

  it('rejects a quote-bound capability presented by a different merchant', async () => {
    const harness = await createMandateApiTestHarness();
    const quote = await harness.addQuote();
    const issued = (await (await submitIntent(harness, quote.id, quote.merchantId)).json()) as IntentResult;

    const response = await submitVerification(harness, {
      merchantId: 'merchant-b',
      merchantOrderRef: 'order-merchant-b-1',
      quoteId: quote.id,
      purchaseCapability: issued.purchaseCapability!,
      idempotencyKey: 'verify-wrong-merchant',
      requestId: 'request-wrong-merchant',
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as VerificationResult).toMatchObject({
      decision: 'rejected',
      reasonCode: 'MERCHANT_MISMATCH',
    });
    expect(harness.paymentVault.calls).toEqual([]);
  });

  it('rejects an order-reference substitution even when the quote and merchant match', async () => {
    const harness = await createMandateApiTestHarness();
    const quote = await harness.addQuote();
    const issued = (await (await submitIntent(harness, quote.id, quote.merchantId)).json()) as IntentResult;

    const response = await submitVerification(harness, {
      merchantId: quote.merchantId,
      merchantOrderRef: 'substituted-order-reference',
      quoteId: quote.id,
      purchaseCapability: issued.purchaseCapability!,
      idempotencyKey: 'verify-substituted-order',
      requestId: 'request-substituted-order',
    });

    expect((await response.json()) as VerificationResult).toMatchObject({
      decision: 'rejected',
      reasonCode: 'ORDER_QUOTE_MISMATCH',
    });
    expect(harness.paymentVault.calls).toEqual([]);
  });

  it('replays an identical idempotent verification but rejects a new attempt with the consumed capability', async () => {
    const harness = await createMandateApiTestHarness();
    const quote = await harness.addQuote();
    const issued = (await (await submitIntent(harness, quote.id, quote.merchantId)).json()) as IntentResult;
    const request = {
      merchantId: quote.merchantId,
      merchantOrderRef: quote.merchantOrderRef,
      quoteId: quote.id,
      purchaseCapability: issued.purchaseCapability!,
      idempotencyKey: 'verify-replay-1',
      requestId: 'request-replay-1',
    };

    const first = await submitVerification(harness, request);
    const firstResult = (await first.json()) as VerificationResult;
    expect(firstResult.settlementStatus).toBe('captured');

    const idempotentReplay = await submitVerification(harness, request);
    const replayResult = (await idempotentReplay.json()) as VerificationResult;
    expect(idempotentReplay.headers.get('x-idempotent-replay')).toBe('true');
    expect(replayResult.verificationId).toBe(firstResult.verificationId);

    const retryWithFreshRequestId = await submitVerification(harness, {
      ...request,
      requestId: 'request-replay-fresh-1',
    });
    expect(retryWithFreshRequestId.headers.get('x-idempotent-replay')).toBe('true');
    expect((await retryWithFreshRequestId.json()) as VerificationResult).toMatchObject({
      verificationId: firstResult.verificationId,
      settlementStatus: 'captured',
    });

    const capabilityReplay = await submitVerification(harness, {
      ...request,
      idempotencyKey: 'verify-replay-2',
      requestId: 'request-replay-2',
    });
    expect((await capabilityReplay.json()) as VerificationResult).toMatchObject({
      decision: 'rejected',
      reasonCode: 'CAPABILITY_REPLAYED',
    });
    expect(harness.paymentVault.calls).toEqual(['authorize', 'capture']);
  });

  it('makes a committed principal revocation fail the next merchant verification', async () => {
    const harness = await createMandateApiTestHarness();
    const quote = await harness.addQuote();
    const issued = (await (await submitIntent(harness, quote.id, quote.merchantId)).json()) as IntentResult;

    const revoke = await harness.app.request(`/v1/mandates/${harness.mandate.id}/revocations`, {
      method: 'POST',
      headers: harness.principalHeaders(),
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ status: 'revoked' });

    const verification = await submitVerification(harness, {
      merchantId: quote.merchantId,
      merchantOrderRef: quote.merchantOrderRef,
      quoteId: quote.id,
      purchaseCapability: issued.purchaseCapability!,
      idempotencyKey: 'verify-revoked',
      requestId: 'request-revoked',
    });
    expect((await verification.json()) as VerificationResult).toMatchObject({
      decision: 'rejected',
      reasonCode: 'MANDATE_REVOKED',
      mandateStatus: 'revoked',
    });
    expect(harness.paymentVault.calls).toEqual([]);
  });

  it('voids an authorization before releasing local authority after capture failure', async () => {
    const harness = await createMandateApiTestHarness({ paymentScenario: 'capture_failed' });
    const quote = await harness.addQuote();
    const issued = (await (await submitIntent(harness, quote.id, quote.merchantId)).json()) as IntentResult;

    const response = await submitVerification(harness, {
      merchantId: quote.merchantId,
      merchantOrderRef: quote.merchantOrderRef,
      quoteId: quote.id,
      purchaseCapability: issued.purchaseCapability!,
      idempotencyKey: 'verify-capture-failure',
      requestId: 'request-capture-failure',
    });

    expect((await response.json()) as VerificationResult).toMatchObject({
      decision: 'rejected',
      reasonCode: 'PAYMENT_CAPTURE_FAILED',
      settlementStatus: 'failed',
    });
    expect(harness.paymentVault.calls).toEqual(['authorize', 'capture', 'void']);
  });

  it('reconciles a pending authorization through the Vault before merchant fulfillment', async () => {
    const harness = await createMandateApiTestHarness({ paymentScenario: 'authorization_pending' });
    const quote = await harness.addQuote();
    const issued = (await (await submitIntent(harness, quote.id, quote.merchantId)).json()) as IntentResult;
    const request = {
      merchantId: quote.merchantId,
      merchantOrderRef: quote.merchantOrderRef,
      quoteId: quote.id,
      purchaseCapability: issued.purchaseCapability!,
    };

    const pending = await submitVerification(harness, {
      ...request,
      idempotencyKey: 'verify-pending-authorization-001',
      requestId: 'request-pending-authorization-001',
    });
    expect((await pending.json()) as VerificationResult).toMatchObject({
      decision: 'approved',
      reasonCode: 'PAYMENT_RECONCILIATION_REQUIRED',
      settlementStatus: 'pending',
    });
    expect(harness.paymentVault.calls).toEqual(['authorize']);

    const reconciled = await submitVerification(harness, {
      ...request,
      idempotencyKey: 'verify-pending-authorization-002',
      requestId: 'request-pending-authorization-002',
    });
    expect((await reconciled.json()) as VerificationResult).toMatchObject({
      decision: 'approved',
      reasonCode: 'AUTHORIZED',
      settlementStatus: 'captured',
    });
    expect(harness.paymentVault.calls).toEqual(['authorize', 'status', 'capture']);
  });

  it('voids a recorded pre-capture authorization when the principal revokes its mandate', async () => {
    const harness = await createMandateApiTestHarness({ paymentScenario: 'authorization_pending' });
    const quote = await harness.addQuote();
    const issued = (await (await submitIntent(harness, quote.id, quote.merchantId)).json()) as IntentResult;
    await submitVerification(harness, {
      merchantId: quote.merchantId,
      merchantOrderRef: quote.merchantOrderRef,
      quoteId: quote.id,
      purchaseCapability: issued.purchaseCapability!,
      idempotencyKey: 'verify-then-revoke-001',
      requestId: 'request-then-revoke-001',
    });

    const revoke = await harness.app.request(`/v1/mandates/${harness.mandate.id}/revocations`, {
      method: 'POST',
      headers: harness.principalHeaders(),
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ status: 'revoked' });
    expect(harness.paymentVault.calls).toEqual(['authorize', 'void']);
  });

  it('allows only one simultaneous verification to claim a one-time capability', async () => {
    const harness = await createMandateApiTestHarness();
    const quote = await harness.addQuote();
    const issued = (await (await submitIntent(harness, quote.id, quote.merchantId)).json()) as IntentResult;

    const [first, second] = await Promise.all([
      submitVerification(harness, {
        merchantId: quote.merchantId,
        merchantOrderRef: quote.merchantOrderRef,
        quoteId: quote.id,
        purchaseCapability: issued.purchaseCapability!,
        idempotencyKey: 'verify-concurrent-1',
        requestId: 'request-concurrent-1',
      }),
      submitVerification(harness, {
        merchantId: quote.merchantId,
        merchantOrderRef: quote.merchantOrderRef,
        quoteId: quote.id,
        purchaseCapability: issued.purchaseCapability!,
        idempotencyKey: 'verify-concurrent-2',
        requestId: 'request-concurrent-2',
      }),
    ]);
    const results = [(await first.json()) as VerificationResult, (await second.json()) as VerificationResult];
    expect(results.filter((result) => result.settlementStatus === 'captured')).toHaveLength(1);
    expect(results.filter((result) => result.reasonCode === 'CAPABILITY_REPLAYED')).toHaveLength(1);
    expect(harness.paymentVault.calls).toEqual(['authorize', 'capture']);
  });

  it('rejects bodies larger than the Mandate API limit before authentication or parsing', async () => {
    const harness = await createMandateApiTestHarness();
    const response = await harness.app.request('/v1/agent/intents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'oversized-intent-001',
        ...harness.agentHeaders(),
      },
      body: JSON.stringify({ padding: 'x'.repeat(16 * 1024) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: 'REQUEST_TOO_LARGE' },
    });
  });
});

async function submitIntent(
  harness: Awaited<ReturnType<typeof createMandateApiTestHarness>>,
  quoteId: string,
  merchantId: string,
  idempotencyKey = 'intent-valid-1',
): Promise<Response> {
  return harness.app.request('/v1/agent/intents', {
    method: 'POST',
    headers: new Headers({
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      ...harness.agentHeaders(),
    }),
    body: JSON.stringify({
      mandateId: harness.mandate.id,
      merchantId,
      quoteId,
    }),
  });
}

async function submitVerification(
  harness: Awaited<ReturnType<typeof createMandateApiTestHarness>>,
  input: {
    merchantId: string;
    merchantOrderRef: string;
    quoteId: string;
    purchaseCapability: string;
    idempotencyKey: string;
    requestId: string;
  },
): Promise<Response> {
  return harness.app.request('/v1/merchant/verifications', {
    method: 'POST',
    headers: new Headers({
      'content-type': 'application/json',
      'idempotency-key': input.idempotencyKey,
      'x-request-id': input.requestId,
      ...harness.merchantHeaders(input.merchantId),
    }),
    body: JSON.stringify({
      merchantId: input.merchantId,
      merchantOrderRef: input.merchantOrderRef,
      quoteId: input.quoteId,
      purchaseCapability: input.purchaseCapability,
    }),
  });
}
