import { z } from 'zod';

/**
 * TODO: Move these schemas to packages/contracts once the shared workspace
 * package exists. They intentionally describe only the merchant boundary.
 */

export const AttributeValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export const AttributesSchema = z.record(z.string(), AttributeValueSchema);

export const SearchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(160),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict();

export const QuoteItemRequestSchema = z
  .object({
    merchantSku: z.string().trim().min(1).max(128),
    quantity: z.number().int().min(1).max(99),
  })
  .strict();

export const QuoteRequestSchema = z
  .object({
    items: z.array(QuoteItemRequestSchema).min(1).max(25),
  })
  .strict();

export const QuoteLineItemSchema = z
  .object({
    merchantSku: z.string(),
    merchantCategoryId: z.string(),
    name: z.string(),
    quantity: z.number().int().positive(),
    unitAmountMinor: z.number().int().nonnegative(),
    attributes: AttributesSchema,
  })
  .strict();

/**
 * This is the exact payload covered by the merchant JWS. Canonical category
 * data is deliberately absent: it is Mandate-service-owned derived data.
 */
export const MerchantQuotePayloadSchema = z
  .object({
    id: z.string().min(1),
    merchantId: z.string().min(1),
    merchantOrderRef: z.string().min(1),
    issuedAt: z.string().datetime({ offset: true }),
    merchantCatalogVersion: z.string().min(1),
    lineItems: z.array(QuoteLineItemSchema).min(1),
    subtotalMinor: z.number().int().nonnegative(),
    shippingMinor: z.number().int().nonnegative(),
    taxMinor: z.number().int().nonnegative(),
    totalMinor: z.number().int().nonnegative(),
    currency: z.string().length(3),
    expiresAt: z.string().datetime({ offset: true }),
    merchantCartHash: z.string().min(1),
    keyId: z.string().min(1),
  })
  .strict();

export const MerchantQuoteSchema = MerchantQuotePayloadSchema.extend({
  signature: z.string().min(1),
}).strict();

export const OrderVerificationRequestSchema = z
  .object({
    quoteId: z.string().min(1),
    purchaseCapability: z.string().min(1).max(8_192),
  })
  .strict();

/**
 * Exact Mandate-issued payload covered by the verification receipt JWS. The
 * capability is represented as a hash so that it is not echoed into receipts.
 */
export const VerificationReceiptPayloadSchema = z
  .object({
    verificationId: z.string().min(1),
    merchantId: z.string().min(1),
    merchantOrderRef: z.string().min(1),
    quoteId: z.string().min(1),
    capabilityHash: z.string().min(1),
    requestId: z.string().min(1),
    decision: z.enum(['approved', 'rejected', 'approval_required']),
    reasonCode: z.string().min(1),
    mandateStatus: z.enum(['active', 'revoked', 'expired']),
    issuedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    keyId: z.string().min(1),
  })
  .strict();

export const VerificationResultSchema = z
  .object({
    decision: z.enum(['approved', 'rejected', 'approval_required']),
    reasonCode: z.string().min(1),
    verificationId: z.string().min(1),
    mandateStatus: z.enum(['active', 'revoked', 'expired']),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    /** An opaque Mandate-signed receipt bound to the exact verification tuple. */
    verificationReceipt: z.string().min(1),
  })
  .strict();

export const MerchantOrderStatusSchema = z.enum([
  'quoted',
  'verification_approved',
  'verification_rejected',
  'approval_required',
]);

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        requestId: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type Attributes = z.infer<typeof AttributesSchema>;
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;
export type MerchantQuotePayload = z.infer<typeof MerchantQuotePayloadSchema>;
export type MerchantQuote = z.infer<typeof MerchantQuoteSchema>;
export type OrderVerificationRequest = z.infer<typeof OrderVerificationRequestSchema>;
export type VerificationReceiptPayload = z.infer<typeof VerificationReceiptPayloadSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type MerchantOrderStatus = z.infer<typeof MerchantOrderStatusSchema>;
