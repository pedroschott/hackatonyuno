import { sha256Base64Url } from '@agentic-mandates/domain';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  InMemoryRequestProofReplayStore,
  JoseAgentRequestAuthenticator,
  type RequestProofKeyRegistry,
} from '../src/request-auth.js';

const now = new Date('2026-08-29T12:00:00.000Z');

describe('JoseAgentRequestAuthenticator', () => {
  it('binds a registered ES256 proof to exact request data and claims its jti once', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    const registry = new StaticKeyRegistry('agent-demo', 'agent-key-1', publicJwk);
    const authenticator = new JoseAgentRequestAuthenticator({
      keyRegistry: registry,
      replayStore: new InMemoryRequestProofReplayStore(() => now),
      now: () => now,
    });
    const rawBody = new TextEncoder().encode('{"quoteId":"quote-1"}');
    const request = new Request('https://mandate.example/v1/agent/intents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBody,
    });
    const proof = await signProof({
      privateKey,
      body: rawBody,
      request,
      proofId: 'proof-once-1',
    });
    request.headers.set('x-agent-request-proof', proof);

    await expect(
      authenticator.authenticate({ request, rawBody, requiredAudience: 'mandate-api' }),
    ).resolves.toEqual({
      ok: true,
      actor: { agentId: 'agent-demo', keyId: 'agent-key-1' },
    });
    await expect(
      authenticator.authenticate({ request, rawBody, requiredAudience: 'mandate-api' }),
    ).resolves.toMatchObject({ ok: false, code: 'REQUEST_REPLAYED' });
  });

  it('rejects a valid signature replayed against a changed body', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    const authenticator = new JoseAgentRequestAuthenticator({
      keyRegistry: new StaticKeyRegistry('agent-demo', 'agent-key-1', publicJwk),
      replayStore: new InMemoryRequestProofReplayStore(() => now),
      now: () => now,
    });
    const originalBody = new TextEncoder().encode('{"quoteId":"quote-1"}');
    const request = new Request('https://mandate.example/v1/agent/intents', {
      method: 'POST',
      body: originalBody,
    });
    request.headers.set(
      'x-agent-request-proof',
      await signProof({
        privateKey,
        body: originalBody,
        request,
        proofId: 'proof-body-bound-1',
      }),
    );
    const changedBody = new TextEncoder().encode('{"quoteId":"quote-2"}');

    await expect(
      authenticator.authenticate({
        request,
        rawBody: changedBody,
        requiredAudience: 'mandate-api',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'AGENT_PROOF_INVALID' });
  });
});

class StaticKeyRegistry implements RequestProofKeyRegistry {
  constructor(
    private readonly actorId: string,
    private readonly keyId: string,
    private readonly publicKey: JWK,
  ) {}

  async resolve(input: { actorKind: 'agent' | 'merchant'; keyId: string }) {
    if (input.actorKind !== 'agent' || input.keyId !== this.keyId) {
      return { status: 'unknown' as const };
    }
    return {
      status: 'active' as const,
      actorId: this.actorId,
      publicKey: this.publicKey,
    };
  }
}

async function signProof(input: {
  privateKey: CryptoKey;
  body: Uint8Array;
  request: Request;
  proofId: string;
}): Promise<string> {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  return new SignJWT({
    htm: input.request.method,
    htu: input.request.url,
    body_hash: sha256Base64Url(input.body),
    jti: input.proofId,
  })
    .setProtectedHeader({
      alg: 'ES256',
      kid: 'agent-key-1',
      typ: 'application/agentic-mandates-request-proof+jws',
    })
    .setIssuer('agent-demo')
    .setSubject('agent-demo')
    .setAudience('mandate-api')
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 30)
    .sign(input.privateKey);
}
