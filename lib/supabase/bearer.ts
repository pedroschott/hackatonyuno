import { createClient } from "@supabase/supabase-js";

import { publicSupabaseEnv } from "@/lib/env";

export function createBearerSupabase(token: string) {
  const env = publicSupabaseEnv();
  return createClient(env.url, env.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function createPublicSupabase() {
  const env = publicSupabaseEnv();
  return createClient(env.url, env.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
