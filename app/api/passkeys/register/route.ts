import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { z } from "zod";

import { appendAudit } from "@/lib/data";
import { webAuthnEnv } from "@/lib/env";
import { apiError, authenticatedRequest } from "@/lib/http";

const requestSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("start") }),
  z.object({
    phase: z.literal("finish"),
    challenge_id: z.uuid(),
    response: z.custom<RegistrationResponseJSON>(),
  }),
]);

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const { supabase, user } = await authenticatedRequest();
    const env = webAuthnEnv(request.url);
    if (input.phase === "start") {
      const credentials = await supabase
        .from("webauthn_credentials")
        .select("id, transports")
        .eq("user_id", user.id);
      if (credentials.error) throw new Error(credentials.error.message);
      const options = await generateRegistrationOptions({
        rpName: env.rpName,
        rpID: env.rpID,
        userID: isoUint8Array.fromUTF8String(user.id),
        userName: user.email ?? user.id,
        userDisplayName: user.email ?? "AgentPay user",
        attestationType: "none",
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",
          userVerification: "required",
        },
        preferredAuthenticatorType: "localDevice",
        excludeCredentials: (credentials.data ?? []).map((credential) => ({
          id: credential.id,
          transports: (credential.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined,
        })),
      });
      const challenge = await supabase
        .from("webauthn_challenges")
        .insert({ user_id: user.id, purpose: "register", challenge: options.challenge })
        .select("id")
        .single();
      if (challenge.error) throw new Error(challenge.error.message);
      return Response.json({ challenge_id: challenge.data.id, options });
    }

    const challenge = await supabase
      .from("webauthn_challenges")
      .select("*")
      .eq("id", input.challenge_id)
      .eq("user_id", user.id)
      .eq("purpose", "register")
      .single();
    if (challenge.error) throw new Error(challenge.error.message);
    if (challenge.data.consumed_at || new Date(challenge.data.expires_at) <= new Date()) {
      throw new Error("Passkey challenge expired or was already used");
    }
    const verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge.data.challenge,
      expectedOrigin: env.origin,
      expectedRPID: env.rpID,
      requireUserVerification: true,
    });
    if (!verification.verified) throw new Error("Passkey registration could not be verified");
    const info = verification.registrationInfo;
    const result = await supabase.from("webauthn_credentials").insert({
      id: info.credential.id,
      user_id: user.id,
      public_key: isoBase64URL.fromBuffer(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports ?? input.response.response.transports ?? [],
      device_type: info.credentialDeviceType,
      backed_up: info.credentialBackedUp,
    });
    if (result.error) throw new Error(result.error.message);
    await supabase
      .from("webauthn_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", input.challenge_id);
    await appendAudit(supabase, `user:${user.id}`, "passkey.registered", info.credential.id, {
      device_type: info.credentialDeviceType,
      backed_up: info.credentialBackedUp,
    });
    return Response.json({ verified: true, credential_id: info.credential.id });
  } catch (error) {
    return apiError(error);
  }
}
