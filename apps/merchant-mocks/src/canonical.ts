/**
 * Compatibility boundary for merchant adapters that imported helpers before
 * the shared domain package existed. New code should import from
 * `@agentic-mandates/domain` directly.
 */
export {
  calculateCanonicalCartHash,
  calculateMerchantCartHash,
  canonicalJson,
  hashCanonicalJson,
  requestFingerprint,
  sha256Base64Url,
} from '@agentic-mandates/domain';

export type {
  CanonicalCartHashInput,
  MerchantCartHashInput,
} from '@agentic-mandates/domain';
