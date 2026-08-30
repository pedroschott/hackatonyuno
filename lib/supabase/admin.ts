import { createClient } from "@supabase/supabase-js";

import { publicSupabaseEnv, supabaseSecretKey } from "@/lib/env";

export function createAdminSupabase() {
  const env = publicSupabaseEnv();
  return createClient(env.url, supabaseSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
