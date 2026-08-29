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

export function agentPayBaseUrl(requestUrl?: string): string {
  const configured = process.env.AGENTPAY_BASE_URL;
  if (configured) return new URL(configured).origin;
  if (requestUrl) return new URL(requestUrl).origin;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3210";
}

export function webAuthnEnv(requestUrl?: string) {
  const origin = process.env.AGENTPAY_RP_ORIGIN ?? agentPayBaseUrl(requestUrl);
  return {
    rpName: process.env.AGENTPAY_RP_NAME ?? "AgentPay",
    rpID: process.env.AGENTPAY_RP_ID ?? new URL(origin).hostname,
    origin,
  };
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
