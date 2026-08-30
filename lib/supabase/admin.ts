import "server-only";

import { createClient } from "@supabase/supabase-js";

import { publicSupabaseEnv } from "@/lib/env";

function supabaseSecretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Missing required environment variable: SUPABASE_SECRET_KEY");
  }
  return key;
}

// This client is deliberately separate from the cookie-bound SSR client. Its key
// bypasses RLS and is used only by trusted server routes after authentication or
// webhook signature verification.
export function createSupabaseAdmin() {
  const env = publicSupabaseEnv();
  return createClient(env.url, supabaseSecretKey(), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
