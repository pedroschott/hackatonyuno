import { z } from 'zod';

import { OpaqueIdSchema, SettlementStatusSchema } from './primitives.js';

/**
 * Display-safe projection only. providerTokenRef and all card data remain in
 * the isolated Vault and are deliberately absent from this package.
 */
export const PaymentMethodSummarySchema = z
  .object({
    id: OpaqueIdSchema,
    brand: z.string().min(1).max(32),
    last4: z.string().regex(/^\d{4}$/),
    status: z.enum(['active', 'disabled']),
  })
  .strict();

export const PaymentOperationSummarySchema = z
  .object({
    id: OpaqueIdSchema,
    settlementStatus: SettlementStatusSchema,
  })
  .strict();

export type PaymentMethodSummary = z.infer<typeof PaymentMethodSummarySchema>;
export type PaymentOperationSummary = z.infer<typeof PaymentOperationSummarySchema>;
