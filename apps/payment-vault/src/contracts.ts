import { z } from 'zod';

const opaqueIdentifier = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}[a-zA-Z0-9_-]{16,128}$`));

export const PaymentMethodIdSchema = opaqueIdentifier('pm_');
export const PaymentAuthorizationIdSchema = opaqueIdentifier('pa_');
export const HostedSetupSessionIdSchema = opaqueIdentifier('hs_');
export const PaymentOperationIdSchema = z.string().trim().min(1).max(128);
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
export const MerchantReferenceSchema = z.string().trim().min(1).max(160);

export const TestPaymentMethodFixtureSchema = z.enum([
  'visa_4242',
  'mastercard_4444',
]);

export const PaymentMethodSummarySchema = z
  .object({
    id: PaymentMethodIdSchema,
    brand: z.enum(['visa', 'mastercard']),
    last4: z.string().regex(/^\d{4}$/),
    status: z.enum(['active', 'disabled']),
  })
  .strict();

export const CreateTestPaymentMethodRequestSchema = z
  .object({
    fixture: TestPaymentMethodFixtureSchema,
  })
  .strict();

export const CreateHostedSetupSessionRequestSchema = z
  .object({
    returnUrl: z.string().url().max(2_000),
  })
  .strict();

export const ExchangeHostedSetupSessionRequestSchema = z
  .object({
    setupCode: z.string().regex(/^setup_[a-zA-Z0-9_-]{16,128}$/),
  })
  .strict();

export const CreatePaymentAuthorizationRequestSchema = z
  .object({
    operationId: PaymentOperationIdSchema,
    paymentMethodId: PaymentMethodIdSchema,
    amountMinor: z.number().int().positive().max(100_000_000),
    currency: CurrencySchema,
    merchantReference: MerchantReferenceSchema,
  })
  .strict();

export const EmptyRequestSchema = z.object({}).strict();

export const PaymentAuthorizationStatusSchema = z.enum([
  'authorization_pending',
  'authorized',
  'declined',
  'reconciliation_required',
  'capture_pending',
  'captured',
  'void_pending',
  'voided',
  'failed',
]);

export const PaymentAuthorizationSummarySchema = z
  .object({
    id: PaymentAuthorizationIdSchema,
    operationId: PaymentOperationIdSchema,
    paymentMethodId: PaymentMethodIdSchema,
    amountMinor: z.number().int().positive(),
    currency: CurrencySchema,
    merchantReference: MerchantReferenceSchema,
    status: PaymentAuthorizationStatusSchema,
    gatewayId: z.enum(['card-gateway-a', 'card-gateway-b']).optional(),
    reasonCode: z.string().min(1).max(80).optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

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

export type TestPaymentMethodFixture = z.infer<typeof TestPaymentMethodFixtureSchema>;
export type PaymentMethodSummary = z.infer<typeof PaymentMethodSummarySchema>;
export type CreateTestPaymentMethodRequest = z.infer<
  typeof CreateTestPaymentMethodRequestSchema
>;
export type CreateHostedSetupSessionRequest = z.infer<
  typeof CreateHostedSetupSessionRequestSchema
>;
export type ExchangeHostedSetupSessionRequest = z.infer<
  typeof ExchangeHostedSetupSessionRequestSchema
>;
export type CreatePaymentAuthorizationRequest = z.infer<
  typeof CreatePaymentAuthorizationRequestSchema
>;
export type PaymentAuthorizationStatus = z.infer<typeof PaymentAuthorizationStatusSchema>;
export type PaymentAuthorizationSummary = z.infer<
  typeof PaymentAuthorizationSummarySchema
>;
