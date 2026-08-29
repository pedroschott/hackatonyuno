import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { webAuthnEnv } from "@/lib/env";

type CredentialRow = {
  id: string;
  public_key: string;
  counter: number;
  transports: AuthenticatorTransportFuture[] | null;
};

function throwOnError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function transactionAuthenticationOptions(input: {
  supabase: SupabaseClient;
  userId: string;
  purpose: "mandate" | "approval";
  entityId: string;
  challenge: string;
  requestUrl: string;
}) {
  const credentials = await input.supabase
    .from("webauthn_credentials")
    .select("id, transports")
    .eq("user_id", input.userId);
  throwOnError(credentials.error);
  if (!credentials.data?.length) {
    throw new Error("Register an AgentPay authorization passkey first");
  }
  const env = webAuthnEnv(input.requestUrl);
  const options = await generateAuthenticationOptions({
    rpID: env.rpID,
    challenge: isoBase64URL.toBuffer(input.challenge),
    userVerification: "required",
    allowCredentials: credentials.data.map((credential) => ({
      id: credential.id,
      transports: (credential.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
    })),
  });
  const challenge = await input.supabase
    .from("webauthn_challenges")
    .insert({
      user_id: input.userId,
      purpose: input.purpose,
      entity_id: input.entityId,
      challenge: options.challenge,
    })
    .select("id")
    .single();
  throwOnError(challenge.error);
  if (!challenge.data) throw new Error("Could not create a passkey challenge");
  return { challenge_id: challenge.data.id, options };
}

export async function verifyTransactionAuthentication(input: {
  supabase: SupabaseClient;
  userId: string;
  purpose: "mandate" | "approval";
  entityId: string;
  challengeId: string;
  response: AuthenticationResponseJSON;
  requestUrl: string;
}) {
  const challenge = await input.supabase
    .from("webauthn_challenges")
    .select("id, challenge, expires_at, consumed_at")
    .eq("id", input.challengeId)
    .eq("user_id", input.userId)
    .eq("purpose", input.purpose)
    .eq("entity_id", input.entityId)
    .single();
  throwOnError(challenge.error);
  if (!challenge.data) throw new Error("Passkey challenge not found");
  if (challenge.data.consumed_at || new Date(challenge.data.expires_at) <= new Date()) {
    throw new Error("Passkey challenge expired or was already used");
  }
  const credentialResult = await input.supabase
    .from("webauthn_credentials")
    .select("id, public_key, counter, transports")
    .eq("id", input.response.id)
    .eq("user_id", input.userId)
    .single();
  throwOnError(credentialResult.error);
  if (!credentialResult.data) throw new Error("Passkey credential not found");
  const credential = credentialResult.data as CredentialRow;
  const env = webAuthnEnv(input.requestUrl);
  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.data.challenge,
    expectedOrigin: env.origin,
    expectedRPID: env.rpID,
    requireUserVerification: true,
    credential: {
      id: credential.id,
      publicKey: isoBase64URL.toBuffer(credential.public_key),
      counter: Number(credential.counter),
      transports: credential.transports ?? undefined,
    },
  });
  if (!verification.verified) throw new Error("Passkey assertion could not be verified");
  const [updatedCredential, consumedChallenge] = await Promise.all([
    input.supabase
      .from("webauthn_credentials")
      .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
      .eq("id", credential.id),
    input.supabase
      .from("webauthn_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", input.challengeId),
  ]);
  throwOnError(updatedCredential.error);
  throwOnError(consumedChallenge.error);
  return {
    credential_id: credential.id,
    challenge: challenge.data.challenge,
    assertion: input.response,
    new_counter: verification.authenticationInfo.newCounter,
  };
}
