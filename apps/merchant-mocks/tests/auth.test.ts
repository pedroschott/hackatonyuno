import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { describe, expect, it } from 'vitest';

import { sha256Base64Url } from '@agentic-mandates/domain';

import {
  JoseMerchantRequestAuthenticator,
  merchantRequestProofAudience,
  type MerchantRequestActor,
  type MerchantRequestProofKey,
  type MerchantRequestProofKeyResolver,
  type MerchantRequestReplayClaim,
  type MerchantRequestReplayClaimResult,
  type MerchantRequestReplayStore,
} from '../src/index.js';

const now = new Date('2026-08-29T12:00:00.000Z');
const nowSeconds = Math.floor(now.getTime() / 1_000);
const harvestUrl = 'https://merchant.example.test/merchants/harvest-market/v1/agents-pay/search';
const requestBody = JSON.stringify({ query: 'rice' });

describe('JoseMerchantRequestAuthenticator', () => {
  it('accepts a registered ES256 agent proof bound to the exact request', async () => {
    const fixture = await createFixture();
    const proof = await fixture.sign({ jti: 'agent-proof-001' });

    const result = await fixture.authenticator.authenticate(
      authenticationInput(requestFor(proof)),
    );

    expect(result).toEqual({
      ok: true,
      actor: { type: 'agent', id: 'agent-demo' },
    });
  });

  it('accepts a registered Mandate-service proof only in its dedicated header', async () => {
    const fixture = await createFixture({
      actor: { type: 'mandate-service', id: 'mandate-service-demo' },
      keyId: 'mandate-service-key-001',
    });
    const proof = await fixture.sign({ jti: 'mandate-proof-001' });

    const allowed = await fixture.authenticator.authenticate(
      authenticationInput(requestFor(proof, fixture.actor)),
    );
    const wrongHeader = await fixture.authenticator.authenticate(
      authenticationInput(requestFor(proof, fixture.actor, 'agent')),
    );

    expect(allowed).toEqual({ ok: true, actor: fixture.actor });
    expect(wrongHeader).toMatchObject({
      ok: false,
      status: 401,
      code: 'AGENT_PROOF_INVALID',
    });
  });

  it('rejects a proof for another merchant audience without consuming it', async () => {
    const fixture = await createFixture();
    const proof = await fixture.sign({ jti: 'cross-merchant-proof-001' });

    const crossMerchant = await fixture.authenticator.authenticate(
      authenticationInput(requestFor(proof), 'city-basket'),
    );
    const intendedMerchant = await fixture.authenticator.authenticate(
      authenticationInput(requestFor(proof)),
    );

    expect(crossMerchant).toMatchObject({
      ok: false,
      status: 401,
      code: 'AGENT_PROOF_INVALID',
    });
    expect(intendedMerchant).toEqual({
      ok: true,
      actor: { type: 'agent', id: 'agent-demo' },
    });
  });

  it('rejects a proof if the raw body, method, or full URL changes', async () => {
    const fixture = await createFixture();
    const proof = await fixture.sign({ jti: 'request-binding-proof-001' });

    const changedBody = await fixture.authenticator.authenticate(
      authenticationInput(requestFor(proof, fixture.actor, undefined, JSON.stringify({ query: 'beans' }))),
    );
    const changedMethod = await fixture.authenticator.authenticate(
      authenticationInput(requestFor(proof, fixture.actor, undefined, requestBody, 'PUT')),
    );
    const changedUrl = await fixture.authenticator.authenticate(
      authenticationInput(
        requestFor(
          proof,
          fixture.actor,
          undefined,
          requestBody,
          'POST',
          `${harvestUrl}?page=2`,
        ),
      ),
    );
    const exactRequest = await fixture.authenticator.authenticate(
      authenticationInput(requestFor(proof)),
    );

    for (const result of [changedBody, changedMethod, changedUrl]) {
      expect(result).toMatchObject({
        ok: false,
        status: 401,
        code: 'AGENT_PROOF_INVALID',
      });
    }
    expect(exactRequest).toMatchObject({ ok: true });
  });

  it('atomically rejects a second use of the same proof', async () => {
    const fixture = await createFixture();
    const proof = await fixture.sign({ jti: 'replay-proof-001' });

    const first = await fixture.authenticator.authenticate(authenticationInput(requestFor(proof)));
    const second = await fixture.authenticator.authenticate(authenticationInput(requestFor(proof)));

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({
      ok: false,
      status: 401,
      code: 'REQUEST_REPLAYED',
    });
  });

  it('rejects revoked keys and proofs that exceed the short lifetime', async () => {
    const revokedFixture = await createFixture({ status: 'revoked' });
    const revokedProof = await revokedFixture.sign({ jti: 'revoked-key-proof-001' });
    const revoked = await revokedFixture.authenticator.authenticate(
      authenticationInput(requestFor(revokedProof)),
    );

    const lifetimeFixture = await createFixture();
    const longLivedProof = await lifetimeFixture.sign({
      jti: 'long-lived-proof-001',
      expiresAt: nowSeconds + 61,
    });
    const longLived = await lifetimeFixture.authenticator.authenticate(
      authenticationInput(requestFor(longLivedProof)),
    );

    expect(revoked).toMatchObject({
      ok: false,
      status: 401,
      code: 'AGENT_KEY_REVOKED',
    });
    expect(longLived).toMatchObject({
      ok: false,
      status: 401,
      code: 'AGENT_PROOF_INVALID',
    });
  });
});

type FixtureOptions = {
  actor?: MerchantRequestActor;
  keyId?: string;
  status?: MerchantRequestProofKey['status'];
};

async function createFixture(options: FixtureOptions = {}) {
  const actor = options.actor ?? { type: 'agent', id: 'agent-demo' };
  const keyId = options.keyId ?? 'agent-key-001';
  const keyPair = await generateKeyPair('ES256');
  const publicJwk: JWK = await exportJWK(keyPair.publicKey);
  const key: MerchantRequestProofKey = {
    keyId,
    publicJwk,
    actor,
    status: options.status ?? 'active',
  };
  const keyResolver = new TestKeyResolver([key]);
  const replayStore = new InMemoryReplayStore();
  const authenticator = new JoseMerchantRequestAuthenticator({
    keyResolver,
    replayStore,
    now: () => now,
  });

  return {
    actor,
    authenticator,
    async sign(input: ProofInput): Promise<string> {
      const body = input.body ?? requestBody;
      return new SignJWT({
        htm: input.method ?? 'POST',
        htu: input.url ?? harvestUrl,
        body_hash: sha256Base64Url(body),
        jti: input.jti,
      })
        .setProtectedHeader({
          alg: 'ES256',
          kid: keyId,
          typ: 'application/agentic-mandates-request-proof+jws',
        })
        .setIssuedAt(input.issuedAt ?? nowSeconds)
        .setExpirationTime(input.expiresAt ?? nowSeconds + 60)
        .setIssuer(actor.id)
        .setSubject(actor.id)
        .setAudience(merchantRequestProofAudience(input.merchantId ?? 'harvest-market'))
        .sign(keyPair.privateKey);
    },
  };
}

type ProofInput = {
  jti: string;
  merchantId?: string;
  method?: string;
  url?: string;
  body?: string;
  issuedAt?: number;
  expiresAt?: number;
};

function authenticationInput(
  request: Request,
  merchantId = 'harvest-market',
) {
  return {
    request,
    merchantId,
    purpose: 'search' as const,
  };
}

function requestFor(
  proof: string,
  actor: MerchantRequestActor = { type: 'agent', id: 'agent-demo' },
  headerActor: MerchantRequestActor['type'] | undefined = undefined,
  body = requestBody,
  method = 'POST',
  url = harvestUrl,
): Request {
  const actorType = headerActor ?? actor.type;
  const proofHeader =
    actorType === 'agent' ? 'x-agent-request-proof' : 'x-mandate-request-proof';

  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      [proofHeader]: proof,
    },
    body,
  });
}

class TestKeyResolver implements MerchantRequestProofKeyResolver {
  private readonly keys: ReadonlyMap<string, MerchantRequestProofKey>;

  constructor(keys: readonly MerchantRequestProofKey[]) {
    this.keys = new Map(keys.map((key) => [key.keyId, key]));
  }

  async getByKeyId(keyId: string): Promise<MerchantRequestProofKey | undefined> {
    return this.keys.get(keyId);
  }
}

class InMemoryReplayStore implements MerchantRequestReplayStore {
  private readonly claimed = new Set<string>();

  async claim(input: MerchantRequestReplayClaim): Promise<MerchantRequestReplayClaimResult> {
    const key = `${input.keyId}:${input.jti}`;

    if (this.claimed.has(key)) {
      return { kind: 'replayed' };
    }

    this.claimed.add(key);
    return { kind: 'claimed' };
  }
}
