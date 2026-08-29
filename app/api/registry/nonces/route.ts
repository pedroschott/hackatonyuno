import { z } from "zod";

import { createPublicSupabase } from "@/lib/supabase/bearer";

const nonceSchema = z.object({
  agent_id: z.string().min(1),
  nonce: z.string().min(8).max(200),
  timestamp: z.iso.datetime(),
});

export async function POST(request: Request) {
  try {
    const input = nonceSchema.parse(await request.json());
    if (Math.abs(Date.now() - new Date(input.timestamp).valueOf()) > 60_000) {
      return Response.json({ error: "Stale nonce" }, { status: 400 });
    }
    const supabase = createPublicSupabase();
    const result = await supabase.from("used_nonces").insert({ nonce: input.nonce, agent_id: input.agent_id });
    if (result.error) return Response.json({ error: "Nonce already used" }, { status: 409 });
    return Response.json({ consumed: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid nonce" }, { status: 400 });
  }
}
