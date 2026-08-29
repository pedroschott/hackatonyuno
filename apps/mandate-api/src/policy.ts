import {
  PolicyDecisionOutputSchema,
  type Mandate,
  type PolicyDecisionOutput,
  type PolicyUsageSnapshot,
} from '@agentic-mandates/contracts';
import { sumMinorAmounts } from '@agentic-mandates/domain';

import type { MerchantTrustTier } from './types.js';

export type EvaluatePolicyInput = {
  mandate: Mandate;
  agentId: string;
  merchantId: string;
  canonicalCategoryIds: readonly string[];
  amountMinor: number;
  currency: string;
  merchantTrustTier: MerchantTrustTier;
  minimumMerchantTrustTier: MerchantTrustTier;
  usage: PolicyUsageSnapshot;
  now: Date;
};

/**
 * Pure, deterministic policy evaluation. Human approval is only a result here;
 * this function never expands a policy or turns an exception into a reusable
 * right. A later passkey-bound exception flow may issue one quote-bound token.
 */
export function evaluatePolicy(input: EvaluatePolicyInput): PolicyDecisionOutput {
  const statusFailure = statusReason(input.mandate, input.now);
  if (statusFailure) {
    return rejected(statusFailure);
  }

  if (input.agentId !== input.mandate.agentId) {
    return rejected('AGENT_MISMATCH');
  }

  if (!input.mandate.policy.merchantAllowlist.includes(input.merchantId)) {
    return rejected('MERCHANT_MISMATCH');
  }

  if (trustTierRank(input.merchantTrustTier) < trustTierRank(input.minimumMerchantTrustTier)) {
    return input.mandate.policy.escalationAllowlist.includes('LOW_TRUST_MERCHANT')
      ? approvalRequired('LOW_TRUST_MERCHANT')
      : rejected('LOW_TRUST_MERCHANT');
  }

  if (!input.mandate.policy.currencies.includes(input.currency)) {
    return rejected('CURRENCY_NOT_ALLOWED');
  }

  if (
    input.canonicalCategoryIds.some(
      (categoryId) =>
        !input.mandate.policy.allowedCanonicalCategoryPaths.some((allowedPath) =>
          isCategoryAllowed(categoryId, allowedPath),
        ),
    )
  ) {
    return rejected('FORBIDDEN_CATEGORY');
  }

  if (input.usage.capturedUses >= input.mandate.policy.maxUses) {
    return rejected('BUDGET_EXCEEDED');
  }

  let wouldCaptureTotal: number;
  try {
    wouldCaptureTotal = sumMinorAmounts(input.usage.capturedAmountMinor, input.amountMinor);
  } catch {
    return rejected('BUDGET_EXCEEDED');
  }

  if (wouldCaptureTotal > input.mandate.policy.totalBudgetMinor) {
    return rejected('BUDGET_EXCEEDED');
  }

  if (input.amountMinor > input.mandate.policy.maxAmountMinor) {
    return input.mandate.policy.escalationAllowlist.includes('AMOUNT_EXCEEDED')
      ? approvalRequired('AMOUNT_EXCEEDED')
      : rejected('AMOUNT_EXCEEDED');
  }

  return PolicyDecisionOutputSchema.parse({
    decision: 'approved',
    reasonCode: 'AUTHORIZED',
    reasonCodes: ['AUTHORIZED'],
  });
}

export function statusReason(mandate: Mandate, now: Date):
  | 'MANDATE_INACTIVE'
  | 'MANDATE_PAUSED'
  | 'MANDATE_REVOKED'
  | 'MANDATE_EXPIRED'
  | undefined {
  const nowMilliseconds = now.getTime();
  if (mandate.status === 'revoked') {
    return 'MANDATE_REVOKED';
  }
  if (mandate.status === 'paused') {
    return 'MANDATE_PAUSED';
  }
  if (mandate.status === 'expired' || Date.parse(mandate.validUntil) <= nowMilliseconds) {
    return 'MANDATE_EXPIRED';
  }
  if (mandate.status !== 'active' || Date.parse(mandate.validFrom) > nowMilliseconds) {
    return 'MANDATE_INACTIVE';
  }
  return undefined;
}

export function mandateStatusForVerification(
  mandate: Mandate | undefined,
  now: Date,
): 'active' | 'revoked' | 'expired' {
  if (!mandate) {
    return 'active';
  }
  if (mandate.status === 'revoked') {
    return 'revoked';
  }
  if (mandate.status === 'expired' || Date.parse(mandate.validUntil) <= now.getTime()) {
    return 'expired';
  }
  return 'active';
}

function rejected(
  reasonCode: Exclude<
    PolicyDecisionOutput['reasonCode'],
    'AUTHORIZED' | 'APPROVAL_REQUIRED' | 'HUMAN_APPROVAL_REQUIRED'
  >,
): PolicyDecisionOutput {
  return PolicyDecisionOutputSchema.parse({
    decision: 'rejected',
    reasonCode,
    reasonCodes: [reasonCode],
  });
}

function approvalRequired(
  reasonCode: 'AMOUNT_EXCEEDED' | 'LOW_TRUST_MERCHANT',
): PolicyDecisionOutput {
  return PolicyDecisionOutputSchema.parse({
    decision: 'approval_required',
    reasonCode,
    reasonCodes: [reasonCode],
  });
}

function isCategoryAllowed(categoryId: string, allowedPath: string): boolean {
  return categoryId === allowedPath || categoryId.startsWith(`${allowedPath}.`);
}

function trustTierRank(tier: MerchantTrustTier): number {
  switch (tier) {
    case 'low':
      return 0;
    case 'standard':
      return 1;
    case 'high':
      return 2;
  }
}
