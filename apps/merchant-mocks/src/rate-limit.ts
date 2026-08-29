import type {
  MerchantEndpointPurpose,
  MerchantRequestActor,
} from './auth.js';

/**
 * The platform provides the production Upstash implementation. Keeping this
 * interface at the merchant boundary ensures limiter failures fail closed and
 * no route accidentally becomes unbounded during service composition.
 */
export type MerchantRateLimitInput = {
  request: Request;
  merchantId: string;
  purpose: MerchantEndpointPurpose;
  actor: MerchantRequestActor;
};

export type MerchantRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds?: number };

export interface MerchantRateLimiter {
  check(input: MerchantRateLimitInput): Promise<MerchantRateLimitResult>;
}

/** Test-only adapter. Never use this in a deployed merchant service. */
export class AllowAllMerchantRateLimiter implements MerchantRateLimiter {
  async check(): Promise<MerchantRateLimitResult> {
    return { allowed: true };
  }
}
