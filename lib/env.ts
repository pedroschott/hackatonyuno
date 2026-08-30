function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function publicSupabaseEnv() {
  return {
    url: required("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}

export function merchantVerificationSecret(): string {
  return required("MERCHANT_VERIFICATION_SECRET");
}

export function diditEnv() {
  return {
    apiKey: required("DIDIT_API_KEY"),
    workflowId: required("DIDIT_WORKFLOW_ID"),
    webhookSecret: required("DIDIT_WEBHOOK_SECRET"),
  };
}

export function supabaseSecretKey(): string {
  const value = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("Missing required environment variable: SUPABASE_SECRET_KEY");
  return value;
}

export function agentPayBaseUrl(requestUrl?: string): string {
  const configured = process.env.AGENTPAY_BASE_URL;
  if (configured) return new URL(configured).origin;
  if (requestUrl) return new URL(requestUrl).origin;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3210";
}

type WebAuthnEnvironmentInput = {
  origin?: string;
  requestUrl?: string;
  rpID?: string;
  rpName?: string;
};

export function resolveWebAuthnEnv(input: WebAuthnEnvironmentInput = {}) {
  const origin = new URL(input.origin ?? agentPayBaseUrl(input.requestUrl)).origin;
  const originUrl = new URL(origin);
  const rpID = input.rpID?.trim() || originUrl.hostname;

  if (originUrl.protocol !== "https:" && originUrl.hostname !== "localhost") {
    throw new Error("AgentPay passkeys require HTTPS outside localhost");
  }
  if (rpID !== originUrl.hostname) {
    throw new Error(
      `AGENTPAY_RP_ID must exactly match the AgentPay hostname (${originUrl.hostname}), not a parent domain`,
    );
  }
  if (input.requestUrl && new URL(input.requestUrl).origin !== origin) {
    throw new Error(`Open AgentPay at ${origin} to use your passkey`);
  }

  return {
    rpName: input.rpName?.trim() || "AgentPay",
    rpID,
    origin,
  };
}

export function webAuthnEnv(requestUrl?: string) {
  return resolveWebAuthnEnv({
    origin: process.env.AGENTPAY_RP_ORIGIN,
    requestUrl,
    rpID: process.env.AGENTPAY_RP_ID,
    rpName: process.env.AGENTPAY_RP_NAME,
  });
}

export function encryptionSecret(): string {
  return required("AGENTPAY_ENCRYPTION_KEY");
}

export function registryKeys() {
  return {
    privateKey: required("AGENTPAY_REGISTRY_PRIVATE_KEY"),
    publicKey: required("AGENTPAY_REGISTRY_PUBLIC_KEY"),
  };
}
