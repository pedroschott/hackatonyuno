import type { User } from "@supabase/supabase-js";

import { createServerSupabase } from "@/lib/supabase/server";

export function apiError(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status });
}

export async function authenticatedRequest(): Promise<{
  supabase: Awaited<ReturnType<typeof createServerSupabase>>;
  user: User;
}> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Authentication required");
  return { supabase, user };
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
