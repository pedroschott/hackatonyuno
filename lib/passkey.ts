import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

export type PasskeyResult = {
  method: "webauthn";
  credential_id: string;
  assertion: string;
  challenge: string;
  authenticator?: string;
};

async function jsonRequest<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Passkey request failed");
  return payload;
}

export async function platformPasskeyAvailable(): Promise<boolean> {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

export async function registerPasskey(): Promise<{ verified: true; credential_id: string }> {
  const start = await jsonRequest<{
    challenge_id: string;
    options: Parameters<typeof startRegistration>[0]["optionsJSON"];
  }>("/api/passkeys/register", { phase: "start" });
  const response = await startRegistration({ optionsJSON: start.options });
  return jsonRequest("/api/passkeys/register", {
    phase: "finish",
    challenge_id: start.challenge_id,
    response,
  });
}

export async function passkeyAuthorize(
  _challenge: string,
  opts: {
    endpoint: string;
    user?: { id: string; name: string; displayName: string };
  },
): Promise<PasskeyResult> {
  const start = await jsonRequest<{
    challenge_id: string;
    options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
  }>(opts.endpoint, { phase: "start" });
  const response = await startAuthentication({ optionsJSON: start.options });
  await jsonRequest(opts.endpoint, {
    phase: "finish",
    challenge_id: start.challenge_id,
    response,
  });
  return {
    method: "webauthn",
    credential_id: response.id,
    assertion: JSON.stringify(response),
    challenge: start.options.challenge,
    authenticator: biometricName(),
  };
}

export function biometricName() {
  if (typeof navigator === "undefined") return "passkey";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "Face ID";
  if (/Android/.test(ua)) return "fingerprint";
  if (/Macintosh/.test(ua)) return "Touch ID";
  return "passkey";
}

export function forgetPasskey() {
  // Passkeys are managed by the operating system and the AgentPay account.
}
