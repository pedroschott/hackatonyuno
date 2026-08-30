import { z } from 'zod';

import {
  HttpMethodSchema,
  OpaqueIdSchema,
  Sha256Base64UrlSchema,
} from './primitives.js';

/** Claims carried inside the JWS found in X-Agent-Request-Proof. */
export const AgentRequestProofClaimsSchema = z
  .object({
    iss: OpaqueIdSchema,
    sub: OpaqueIdSchema,
    aud: z.string().min(1).max(160),
    htm: HttpMethodSchema,
    htu: z.string().url().max(2_048),
    body_hash: Sha256Base64UrlSchema,
    iat: z.number().int().nonnegative(),
    exp: z.number().int().nonnegative(),
    jti: OpaqueIdSchema,
    nonce: OpaqueIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.exp <= value.iat) {
      context.addIssue({
        code: 'custom',
        message: 'exp must be after iat.',
        path: ['exp'],
      });
    }
  });

export type AgentRequestProofClaims = z.infer<typeof AgentRequestProofClaimsSchema>;
