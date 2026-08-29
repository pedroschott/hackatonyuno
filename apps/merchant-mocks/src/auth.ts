/**
 * Shared agent proof verification belongs in the future packages/contracts or
 * packages/domain boundary. Merchant mocks depend on this narrow interface so
 * they never invent an alternate agent identity scheme.
 */
export type MerchantEndpointPurpose = 'search' | 'quote' | 'quote_read' | 'order_verification';

export type MerchantRequestActor =
  | { type: 'agent'; id: string }
  | { type: 'mandate-service'; id: string };

export type MerchantRequestAuthenticationInput = {
  request: Request;
  merchantId: string;
  purpose: MerchantEndpointPurpose;
};

export type MerchantRequestAuthenticationResult =
  | { ok: true; actor: MerchantRequestActor }
  | { ok: false; status: 401 | 403; code: string; message: string };

export interface MerchantRequestAuthenticator {
  authenticate(
    input: MerchantRequestAuthenticationInput,
  ): Promise<MerchantRequestAuthenticationResult>;
}

/** Fails closed until the host wires the shared ES256 proof verifier. */
export class RejectingMerchantRequestAuthenticator implements MerchantRequestAuthenticator {
  async authenticate(): Promise<MerchantRequestAuthenticationResult> {
    return {
      ok: false,
      status: 401,
      code: 'AGENT_AUTH_REQUIRED',
      message: 'A registered agent request proof is required.',
    };
  }
}
