import { z } from 'zod';

/**
 * IDs cross service boundaries but have no business meaning outside their
 * owner. They intentionally allow UUIDs and readable fixture IDs.
 */
export const OpaqueIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const RequestIdSchema = OpaqueIdSchema;
export const IdempotencyKeySchema = z.string().min(1).max(255);
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const IsoDateTimeSchema = z.string().datetime({ offset: true });

/** Amounts are integer minor units. Decimal money values are never accepted. */
export const MinorAmountSchema = z.number().int().nonnegative();

export const AttributeValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
export const AttributesSchema = z.record(z.string().min(1).max(128), AttributeValueSchema);

/** SHA-256 encoded as unpadded base64url. */
export const Sha256Base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Compact JWS only; verification is deliberately owned by the caller's boundary. */
export const CompactJwsSchema = z
  .string()
  .min(1)
  .max(8_192)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

export const HttpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

export const SettlementStatusSchema = z.enum(['captured', 'pending', 'failed']);

export type OpaqueId = z.infer<typeof OpaqueIdSchema>;
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
export type MinorAmount = z.infer<typeof MinorAmountSchema>;
export type Attributes = z.infer<typeof AttributesSchema>;
export type AttributeValue = z.infer<typeof AttributeValueSchema>;
export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;
