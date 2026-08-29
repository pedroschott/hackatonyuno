import {
  platformAuthenticatorIsAvailable,
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
  if (typeof window === "undefined" || !("PublicKeyCredential" in window)) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

function passkeyErrorMessage(error: unknown, action: "create" | "authorize"): string {
  const failure = error as { code?: string; name?: string; message?: string };
  if (failure.code === "ERROR_INVALID_RP_ID" || failure.code === "ERROR_INVALID_DOMAIN") {
    return "AgentPay cannot use passkeys on this address. Open the official AgentPay link and try again.";
  }
  if (failure.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return "This device already has an AgentPay passkey. Use it to authorize the request.";
  }
  if (failure.name === "NotAllowedError" || failure.code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY") {
    return action === "create"
      ? "Passkey setup was canceled or Face ID/Touch ID is unavailable here. Open AgentPay directly in Safari or Chrome on this device and try again."
      : "No AgentPay passkey was selected on this device. Open AgentPay directly in Safari or Chrome, then try again.";
  }
  return failure.message || "The passkey ceremony could not be completed";
}

export async function registerPasskey(): Promise<{ verified: true; credential_id: string }> {
  const start = await jsonRequest<{
    challenge_id: string;
    options: Parameters<typeof startRegistration>[0]["optionsJSON"];
  }>("/api/passkeys/register", { phase: "start" });
  let response: Awaited<ReturnType<typeof startRegistration>>;
  try {
    response = await startRegistration({ optionsJSON: start.options });
  } catch (error) {
    throw new Error(passkeyErrorMessage(error, "create"));
  }
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
  let response: Awaited<ReturnType<typeof startAuthentication>>;
  try {
    response = await startAuthentication({ optionsJSON: start.options });
  } catch (error) {
    throw new Error(passkeyErrorMessage(error, "authorize"));
  }
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
