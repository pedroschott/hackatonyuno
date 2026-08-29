import { z } from 'zod';

/**
 * Compatibility boundary for merchant adapters that imported contracts before
 * the workspace package existed. New code should import from
 * `@agentic-mandates/contracts` directly.
 */
export * from '@agentic-mandates/contracts';

/**
 * Merchant-local lifecycle only. The Mandate service owns payment settlement,
 * so a later receipt may carry settlement data without changing these states.
 */
export const MerchantOrderStatusSchema = z.enum([
  'quoted',
  'settlement_pending',
  'verification_approved',
  'verification_rejected',
  'approval_required',
]);

export type MerchantOrderStatus = z.infer<typeof MerchantOrderStatusSchema>;
