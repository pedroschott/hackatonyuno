import { z } from "zod";

import { apiError } from "@/lib/http";
import { API_KEY_FIELDS } from "@/lib/merchant-console";
import { createMerchantApiKey, ownedMerchant } from "@/lib/server/merchant-console";

const keySchema = z.object({ name: z.string().trim().min(1).max(80).default("Default key") });

export async function GET(_request: Request, context: RouteContext<"/api/developers/merchants/[id]/keys">) {
  try {
    const { id } = await context.params;
    const { supabase, merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });
    const result = await supabase
      .from("merchant_api_keys")
      .select(API_KEY_FIELDS)
      .eq("merchant_id", id)
      .order("created_at", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    return Response.json({ api_keys: result.data ?? [] });
  } catch (error) {
    return apiError(error, 401);
  }
}

export async function POST(request: Request, context: RouteContext<"/api/developers/merchants/[id]/keys">) {
  try {
    const { id } = await context.params;
    const input = keySchema.parse(await request.json());
    const { supabase, user, merchant } = await ownedMerchant(id);
    if (!merchant) return Response.json({ error: "Merchant not found" }, { status: 404 });
    const key = createMerchantApiKey(merchant.environment);
    const result = await supabase
      .from("merchant_api_keys")
      .insert({
        merchant_id: id,
        created_by: user.id,
        name: input.name,
        environment: merchant.environment,
        prefix: key.prefix,
        secret_hash: key.secretHash,
      })
      .select(API_KEY_FIELDS)
      .single();
    if (result.error) throw new Error(result.error.message);
    return Response.json({ api_key: result.data, secret: key.plaintext }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
