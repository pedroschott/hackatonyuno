import type { SupabaseClient } from "@supabase/supabase-js";

import { isIdentityVerified, type IdentityVerification } from "@/lib/didit";

const identityVerificationFields =
  "session_id, status, entity_status, workflow_id, environment, created_at, updated_at, approved_at";

export async function loadLatestIdentityVerification(
  supabase: SupabaseClient,
): Promise<IdentityVerification | null> {
  const result = await supabase
    .from("identity_verifications")
    .select(identityVerificationFields)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data as IdentityVerification | null;
}

export async function requireVerifiedIdentity(supabase: SupabaseClient): Promise<IdentityVerification> {
  const verification = await loadLatestIdentityVerification(supabase);
  if (!verification || !isIdentityVerified(verification)) {
    throw new Error("Complete identity verification before authorizing or using a mandate");
  }
  return verification;
}
