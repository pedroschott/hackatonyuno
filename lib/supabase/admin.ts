import { createClient } from "@supabase/supabase-js";

import { publicSupabaseEnv, supabaseSecretKey } from "@/lib/env";

/** Server-only client for registry-owned state such as live-domain verification. */
export function createAdminSupabase() {
  const env = publicSupabaseEnv();
  return createClient(env.url, supabaseSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
