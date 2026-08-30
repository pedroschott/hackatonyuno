import type { SupabaseClient } from "@supabase/supabase-js";

import { canonicalJson } from "@/lib/canonical-json";
import { selectPaymentCard } from "@/lib/cards";
import {
  decodePemEnvironment,
  decryptSecret,
  encryptSecret,
  generateEd25519KeyPair,
  sha256Base64Url,
  signCanonical,
} from "@/lib/crypto";
import type { MandateLimits, MandateScope, MandateValidity } from "@/lib/domain";
import { encryptionSecret, registryKeys } from "@/lib/env";

export type AgentRecord = {
  id: string;
  owner_id: string;
  name: string;
  public_key: string;
};

export type OwnedCardRecord = {
  id: string;
  brand: "mastercard" | "visa";
  last4: string;
  label: string | null;
  is_default: boolean;
  created_at: string;
};

function throwOnError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function getOwnedPaymentCard(
  supabase: SupabaseClient,
  explicitCardId?: string,
): Promise<OwnedCardRecord | null> {
  const result = await supabase
    .from("vault_cards")
    .select("id, brand, last4, label, is_default, created_at")
    .order("created_at", { ascending: true });
  throwOnError(result.error);
  return selectPaymentCard((result.data ?? []) as OwnedCardRecord[], explicitCardId);
}

export async function ensureAgent(supabase: SupabaseClient, userId: string): Promise<AgentRecord> {
  const existing = await supabase.from("agents").select("id, owner_id, name, public_key").eq("owner_id", userId).maybeSingle();
  throwOnError(existing.error);
  if (existing.data) return existing.data as AgentRecord;

  const pair = generateEd25519KeyPair();
  const agent: AgentRecord = {
    id: `agt_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
    owner_id: userId,
    name: "Personal shopping agent",
    public_key: pair.publicKey,
  };
  const created = await supabase.from("agents").insert(agent).select("id, owner_id, name, public_key").single();
  if (created.error) {
    const raced = await supabase.from("agents").select("id, owner_id, name, public_key").eq("owner_id", userId).single();
    throwOnError(raced.error);
    return raced.data as AgentRecord;
  }
  const secret = await supabase.from("agent_secrets").insert({
    agent_id: agent.id,
    user_id: userId,
    encrypted_private_key: encryptSecret(pair.privateKey, encryptionSecret()),
  });
  throwOnError(secret.error);
  return created.data as AgentRecord;
}

export async function getAgentPrivateKey(
  supabase: SupabaseClient,
  userId: string,
  agentId: string,
): Promise<string> {
  const result = await supabase
    .from("agent_secrets")
    .select("encrypted_private_key")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .single();
  throwOnError(result.error);
  if (!result.data) throw new Error("Agent signing key not found");
  return decryptSecret(result.data.encrypted_private_key as string, encryptionSecret());
}

export function mandatePayload(input: {
  id: string;
  issuerUserId: string;
  agent: AgentRecord;
  scope: MandateScope;
  limits: MandateLimits;
  validity: MandateValidity;
  payment: { vault_card_id: string };
  authorization?: Record<string, unknown> | null;
}) {
  return {
    mandate_id: input.id,
    type: "intent" as const,
    issuer: { user_id: input.issuerUserId },
    agent: { agent_id: input.agent.id, public_key: input.agent.public_key },
    scope: input.scope,
    limits: input.limits,
    validity: input.validity,
    payment: input.payment,
    ...(input.authorization ? { authorization: input.authorization } : {}),
  };
}

export function mandateChallenge(payload: unknown): string {
  return sha256Base64Url(canonicalJson(payload));
}

export function signMandate(payload: unknown): string {
  const privateKey = decodePemEnvironment(registryKeys().privateKey);
  return signCanonical(privateKey, payload);
}

export function registryPublicKey(): string {
  return decodePemEnvironment(registryKeys().publicKey);
}

export async function appendAudit(
  supabase: SupabaseClient,
  actor: string,
  action: string,
  entity: string,
  payload: Record<string, unknown>,
) {
  const result = await supabase.rpc("append_agentpay_audit", {
    p_actor: actor,
    p_action: action,
    p_entity: entity,
    p_payload: payload,
  });
  throwOnError(result.error);
  return result.data;
}
