import { z } from 'zod';

import {
  AttributesSchema,
  CompactJwsSchema,
  CurrencyCodeSchema,
  IsoDateTimeSchema,
  MinorAmountSchema,
  OpaqueIdSchema,
  SettlementStatusSchema,
  Sha256Base64UrlSchema,
} from './primitives.js';
import { ReasonCodeSchema } from './errors.js';

export const MerchantSearchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(160),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict();

/** A merchant-local category may use a taxonomy syntax such as slash paths. */
export const MerchantLocalCategoryIdSchema = z.string().min(1).max(255);

/** Search data is merchant-local and is not authorization data. */
export const MerchantSearchOfferSchema = z
  .object({
    merchantSku: OpaqueIdSchema,
    merchantCategoryId: MerchantLocalCategoryIdSchema,
    name: z.string().min(1).max(512),
    description: z.string().min(1).max(2_048),
    unitAmountMinor: MinorAmountSchema,
    currency: CurrencyCodeSchema,
    availableQuantity: z.number().int().nonnegative(),
    attributes: AttributesSchema,
  })
  .strict();

export const MerchantSearchResponseSchema = z
  .object({
    merchantId: OpaqueIdSchema,
    merchantName: z.string().min(1).max(160),
    merchantCatalogVersion: OpaqueIdSchema,
    offers: z.array(MerchantSearchOfferSchema).max(25),
  })
  .strict();

export const QuoteItemRequestSchema = z
  .object({
    merchantSku: OpaqueIdSchema,
    quantity: z.number().int().min(1).max(99),
  })
  .strict();

export const MerchantQuoteRequestSchema = z
  .object({
    items: z.array(QuoteItemRequestSchema).min(1).max(25),
  })
  .strict();

export const MerchantQuoteLineItemSchema = z
  .object({
    merchantSku: OpaqueIdSchema,
    merchantCategoryId: MerchantLocalCategoryIdSchema,
    name: z.string().min(1).max(512),
    quantity: z.number().int().positive(),
    unitAmountMinor: MinorAmountSchema,
    attributes: AttributesSchema,
  })
  .strict();

/**
 * This exact payload is canonicalized and signed by the merchant. Canonical
 * categories and trust tiers are intentionally absent because the Mandate
 * service derives them from its registry and taxonomy.
 */
export const MerchantQuotePayloadSchema = z
  .object({
    id: OpaqueIdSchema,
    merchantId: OpaqueIdSchema,
    merchantOrderRef: OpaqueIdSchema,
    issuedAt: IsoDateTimeSchema,
    merchantCatalogVersion: OpaqueIdSchema,
    lineItems: z.array(MerchantQuoteLineItemSchema).min(1).max(25),
    subtotalMinor: MinorAmountSchema,
    shippingMinor: MinorAmountSchema,
    taxMinor: MinorAmountSchema,
    totalMinor: MinorAmountSchema,
    currency: CurrencyCodeSchema,
    expiresAt: IsoDateTimeSchema,
    merchantCartHash: Sha256Base64UrlSchema,
    keyId: OpaqueIdSchema,
  })
  .strict();

export const MerchantQuoteSignatureMetadataSchema = z
  .object({
    keyId: OpaqueIdSchema,
    signature: CompactJwsSchema,
  })
  .strict();

export const MerchantQuoteSchema = MerchantQuotePayloadSchema.extend({
  signature: CompactJwsSchema,
}).strict();

export const MerchantQuoteResponseSchema = z
  .object({ quote: MerchantQuoteSchema })
  .strict();

export const CanonicalCategoryIdSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/);

export const CanonicalLineItemSchema = z
  .object({
    merchantSku: OpaqueIdSchema,
    canonicalCategoryId: CanonicalCategoryIdSchema,
  })
  .strict();

/** A Mandate-service-derived, versioned normalization of a signed quote. */
export const NormalizedQuoteSchema = z
  .object({
    quoteId: OpaqueIdSchema,
    merchantId: OpaqueIdSchema,
    taxonomyVersion: OpaqueIdSchema,
    canonicalLineItems: z.array(CanonicalLineItemSchema).min(1).max(25),
    canonicalCartHash: Sha256Base64UrlSchema,
  })
  .strict();

/**
 * Agent input identifies a merchant quote. The service derives amount,
 * categories, cart hash, and trust from authoritative merchant data.
 */
export const SubmitPurchaseIntentRequestSchema = z
  .object({
    mandateId: OpaqueIdSchema,
    merchantId: OpaqueIdSchema,
    quoteId: OpaqueIdSchema,
  })
  .strict();

export const CanonicalPurchaseLineItemSchema = z
  .object({
    sku: OpaqueIdSchema,
    name: z.string().min(1).max(512),
    quantity: z.number().int().positive(),
    unitAmountMinor: MinorAmountSchema,
  })
  .strict();

/** Internal policy input after quote verification and taxonomy normalization. */
export const PurchaseIntentSchema = z
  .object({
    merchantId: OpaqueIdSchema,
    quoteId: OpaqueIdSchema,
    canonicalCategoryId: CanonicalCategoryIdSchema,
    amountMinor: MinorAmountSchema,
    currency: CurrencyCodeSchema,
    lineItems: z.array(CanonicalPurchaseLineItemSchema).min(1).max(25),
    attributes: AttributesSchema,
    canonicalCartHash: Sha256Base64UrlSchema,
  })
  .strict();

export const OrderVerificationRequestSchema = z
  .object({
    quoteId: OpaqueIdSchema,
    purchaseCapability: z.string().min(1).max(8_192),
  })
  .strict();

export const MerchantVerificationRequestSchema = z
  .object({
    merchantId: OpaqueIdSchema,
    merchantOrderRef: OpaqueIdSchema,
    quoteId: OpaqueIdSchema,
    purchaseCapability: z.string().min(1).max(8_192),
  })
  .strict();

export const VerificationDecisionSchema = z.enum([
  'approved',
  'rejected',
  'approval_required',
]);

export const MandateStatusForVerificationSchema = z.enum([
  'active',
  'revoked',
  'expired',
]);

const PaymentSettlementShape = {
  paymentOperationId: OpaqueIdSchema.optional(),
  settlementStatus: SettlementStatusSchema.optional(),
};

const hasCompletePaymentSettlement = (value: {
  paymentOperationId?: string | undefined;
  settlementStatus?: string | undefined;
}): boolean =>
  (value.paymentOperationId !== undefined) === (value.settlementStatus !== undefined);

/** Exact payload covered by the Mandate-service JWS receipt. */
export const VerificationReceiptPayloadSchema = z
  .object({
    verificationId: OpaqueIdSchema,
    merchantId: OpaqueIdSchema,
    merchantOrderRef: OpaqueIdSchema,
    quoteId: OpaqueIdSchema,
    capabilityHash: Sha256Base64UrlSchema,
    requestId: OpaqueIdSchema,
    decision: VerificationDecisionSchema,
    reasonCode: ReasonCodeSchema,
    mandateStatus: MandateStatusForVerificationSchema,
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema.optional(),
    keyId: OpaqueIdSchema,
    ...PaymentSettlementShape,
  })
  .strict()
  .refine(hasCompletePaymentSettlement, {
    message: 'paymentOperationId and settlementStatus must be present together.',
  });

/**
 * The merchant receives only a decision, signed receipt, and an opaque
 * settlement reference. It never receives a Vault token or payment method.
 */
export const VerificationResultSchema = z
  .object({
    decision: VerificationDecisionSchema,
    reasonCode: ReasonCodeSchema,
    verificationId: OpaqueIdSchema,
    mandateStatus: MandateStatusForVerificationSchema,
    expiresAt: IsoDateTimeSchema.optional(),
    verificationReceipt: CompactJwsSchema,
    ...PaymentSettlementShape,
  })
  .strict()
  .refine(hasCompletePaymentSettlement, {
    message: 'paymentOperationId and settlementStatus must be present together.',
  });

export type MerchantSearchRequest = z.infer<typeof MerchantSearchRequestSchema>;
export type MerchantSearchOffer = z.infer<typeof MerchantSearchOfferSchema>;
export type MerchantSearchResponse = z.infer<typeof MerchantSearchResponseSchema>;
export type QuoteItemRequest = z.infer<typeof QuoteItemRequestSchema>;
export type MerchantQuoteRequest = z.infer<typeof MerchantQuoteRequestSchema>;
export type MerchantQuoteLineItem = z.infer<typeof MerchantQuoteLineItemSchema>;
export type MerchantQuotePayload = z.infer<typeof MerchantQuotePayloadSchema>;
export type MerchantQuoteSignatureMetadata = z.infer<
  typeof MerchantQuoteSignatureMetadataSchema
>;
export type MerchantQuote = z.infer<typeof MerchantQuoteSchema>;
export type NormalizedQuote = z.infer<typeof NormalizedQuoteSchema>;
export type SubmitPurchaseIntentRequest = z.infer<typeof SubmitPurchaseIntentRequestSchema>;
export type PurchaseIntent = z.infer<typeof PurchaseIntentSchema>;
export type OrderVerificationRequest = z.infer<typeof OrderVerificationRequestSchema>;
export type MerchantVerificationRequest = z.infer<
  typeof MerchantVerificationRequestSchema
>;
export type VerificationDecision = z.infer<typeof VerificationDecisionSchema>;
export type MandateStatusForVerification = z.infer<
  typeof MandateStatusForVerificationSchema
>;
export type VerificationReceiptPayload = z.infer<typeof VerificationReceiptPayloadSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

/** Compatibility names for merchant adapters during the workspace migration. */
export const SearchRequestSchema = MerchantSearchRequestSchema;
export const SearchOfferSchema = MerchantSearchOfferSchema;
export const SearchResponseSchema = MerchantSearchResponseSchema;
export const QuoteRequestSchema = MerchantQuoteRequestSchema;
export const QuoteLineItemSchema = MerchantQuoteLineItemSchema;
export type SearchRequest = MerchantSearchRequest;
export type QuoteRequest = MerchantQuoteRequest;
