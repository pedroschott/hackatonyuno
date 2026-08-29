import { z } from 'zod';

import { ReasonCodeSchema } from './errors.js';
import {
  CanonicalCategoryIdSchema,
  VerificationDecisionSchema,
} from './merchant.js';
import {
  CompactJwsSchema,
  CurrencyCodeSchema,
  IsoDateTimeSchema,
  MinorAmountSchema,
  OpaqueIdSchema,
  Sha256Base64UrlSchema,
} from './primitives.js';

export const MandateStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'revoked',
  'expired',
]);

export const EscalatableReasonCodeSchema = z.enum([
  'AMOUNT_EXCEEDED',
  'LOW_TRUST_MERCHANT',
  'NEW_CATEGORY',
]);

/**
 * The compact, deterministic contract used by the core authorization path.
 * More product-specific constraints can be added around it without changing
 * what an agent is allowed to authorize.
 */
export const MandatePolicySchema = z
  .object({
    permittedAgentId: OpaqueIdSchema,
    merchantAllowlist: z.array(OpaqueIdSchema).min(1).max(50),
    allowedCanonicalCategoryPaths: z.array(CanonicalCategoryIdSchema).min(1).max(100),
    maxAmountMinor: MinorAmountSchema,
    totalBudgetMinor: MinorAmountSchema,
    currencies: z.array(CurrencyCodeSchema).min(1).max(10),
    maxUses: z.number().int().positive(),
    escalationAllowlist: z.array(EscalatableReasonCodeSchema).max(3),
  })
  .strict();

/**
 * Mandate state stores only a display-safe payment method ID. The isolated
 * Vault owns the underlying provider token and all test-card details.
 */
export const MandateSchema = z
  .object({
    id: OpaqueIdSchema,
    version: z.number().int().positive(),
    principalId: OpaqueIdSchema,
    agentId: OpaqueIdSchema,
    status: MandateStatusSchema,
    paymentMethodId: OpaqueIdSchema,
    policy: MandatePolicySchema,
    validFrom: IsoDateTimeSchema,
    validUntil: IsoDateTimeSchema,
    createdAt: IsoDateTimeSchema,
    revokedAt: IsoDateTimeSchema.optional(),
  })
  .strict()
  .refine((value) => value.agentId === value.policy.permittedAgentId, {
    message: 'agentId must match policy.permittedAgentId.',
    path: ['policy', 'permittedAgentId'],
  })
  .refine((value) => Date.parse(value.validFrom) < Date.parse(value.validUntil), {
    message: 'validUntil must be after validFrom.',
    path: ['validUntil'],
  });

export const CapabilityStatusSchema = z.enum([
  'issued',
  'authorized',
  'consumed',
  'voided',
  'expired',
]);

/** Payload covered by the Mandate-service capability JWS. */
export const PurchaseCapabilityPayloadSchema = z
  .object({
    id: OpaqueIdSchema,
    mandateId: OpaqueIdSchema,
    mandateVersion: z.number().int().positive(),
    agentId: OpaqueIdSchema,
    merchantId: OpaqueIdSchema,
    quoteId: OpaqueIdSchema,
    canonicalCartHash: Sha256Base64UrlSchema,
    maxAmountMinor: MinorAmountSchema,
    currency: CurrencyCodeSchema,
    nonce: OpaqueIdSchema,
    expiresAt: IsoDateTimeSchema,
    oneTimeUse: z.literal(true),
    approvalRequestId: OpaqueIdSchema.optional(),
  })
  .strict();

export const PurchaseCapabilitySchema = PurchaseCapabilityPayloadSchema.extend({
  signature: CompactJwsSchema,
}).strict();

export const PolicyEvaluationCandidateSchema = z
  .object({
    actorAgentId: OpaqueIdSchema,
    merchantId: OpaqueIdSchema,
    canonicalCategoryPaths: z.array(CanonicalCategoryIdSchema).min(1).max(25),
    amountMinor: MinorAmountSchema,
    currency: CurrencyCodeSchema,
    canonicalCartHash: Sha256Base64UrlSchema,
  })
  .strict();

export const PolicyUsageSnapshotSchema = z
  .object({
    capturedAmountMinor: MinorAmountSchema,
    capturedUses: z.number().int().nonnegative(),
  })
  .strict();

/** Input is entirely normalized and can be evaluated without HTTP or storage. */
export const PolicyDecisionInputSchema = z
  .object({
    mandate: MandateSchema,
    candidate: PolicyEvaluationCandidateSchema,
    usage: PolicyUsageSnapshotSchema,
    evaluatedAt: IsoDateTimeSchema,
  })
  .strict();

/**
 * reasonCode is the primary machine-readable result. reasonCodes preserves
 * every contributing policy outcome for the evidence view and attack suite.
 */
export const PolicyDecisionOutputSchema = z
  .object({
    decision: VerificationDecisionSchema,
    reasonCode: ReasonCodeSchema,
    reasonCodes: z.array(ReasonCodeSchema).min(1).max(20),
  })
  .strict()
  .refine((value) => value.reasonCodes.includes(value.reasonCode), {
    message: 'reasonCodes must include reasonCode.',
    path: ['reasonCodes'],
  });

export type MandateStatus = z.infer<typeof MandateStatusSchema>;
export type EscalatableReasonCode = z.infer<typeof EscalatableReasonCodeSchema>;
export type MandatePolicy = z.infer<typeof MandatePolicySchema>;
export type Mandate = z.infer<typeof MandateSchema>;
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;
export type PurchaseCapabilityPayload = z.infer<typeof PurchaseCapabilityPayloadSchema>;
export type PurchaseCapability = z.infer<typeof PurchaseCapabilitySchema>;
export type PolicyEvaluationCandidate = z.infer<typeof PolicyEvaluationCandidateSchema>;
export type PolicyUsageSnapshot = z.infer<typeof PolicyUsageSnapshotSchema>;
export type PolicyDecisionInput = z.infer<typeof PolicyDecisionInputSchema>;
export type PolicyDecisionOutput = z.infer<typeof PolicyDecisionOutputSchema>;
