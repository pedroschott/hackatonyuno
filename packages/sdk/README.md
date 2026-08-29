# Internal AgentPay SDK

This private workspace package contains the thin HTTP clients used by the agent simulator and merchant integrations. It validates shared Zod contracts, signs every direct agent request, and adds an `Idempotency-Key` to every mutation.

It is deliberately not an npm package and does not contain Vault credentials, payment methods, raw card data, passkey approval, or principal contract mutation. A principal revokes a mandate through the authenticated browser BFF; an autonomous agent cannot call that action through this SDK.

```ts
const signer = createEs256RequestProofSigner({
  issuer: 'demo-agent',
  keyId: 'demo-agent-key-1',
  signingKey: importedPrivateCryptoKey,
});

const mandates = createAgentClient({
  baseUrl: 'https://mandates.example/',
  requestProofSigner: signer,
});

const merchantApi = createMerchantApiClient({
  baseUrl: 'https://merchant.example/merchants/harvest-market/',
  merchantId: 'harvest-market',
  requestProofSigner: signer,
});

const merchantToMandates = createMerchantClient({
  baseUrl: 'https://mandates.example/',
  requestProofSigner: merchantServiceSigner,
});
```

`createMerchantApiClient` is used by an agent to search, quote, retrieve a quote, and submit an order verification request to a merchant endpoint. `createMerchantClient` is the merchant's server-to-server verification client for the Mandate service; it sends `X-Merchant-Request-Proof` and returns the minimal signed settlement decision.

The host imports and retains the opaque `CryptoKey`; the SDK's ES256 helper never accepts or returns a raw private JWK. `createMerchantApiClient` derives the target-specific proof audience as `merchant-api:<merchantId>` and rejects a valid-looking response that belongs to another merchant.
