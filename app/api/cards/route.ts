import { appendAudit } from "@/lib/data";
import { encryptSecret } from "@/lib/crypto";
import { encryptionSecret } from "@/lib/env";
import { authenticatedRequest } from "@/lib/http";
import { verifyPaymentSetupToken } from "@/lib/payment-setup";
import { error, handle, options, readJson, stateResponse } from "@/lib/server/http";

export const OPTIONS = options;

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{
      brand?: string;
      last4?: string;
      label?: string;
      setup_token?: string;
      make_default?: boolean;
    }>(req);
    const brand =
      body.brand === "visa" ? "visa" : body.brand === "mastercard" ? "mastercard" : null;
    if (!brand || !/^\d{4}$/.test(body.last4 ?? "")) {
      return error("brand ('visa'|'mastercard') and last4 (4 digits) required", 400);
    }
    const { supabase, user } = await authenticatedRequest();
    if (body.setup_token && !verifyPaymentSetupToken(body.setup_token, user.id)) {
      return error("Payment setup link is invalid or expired. Ask the agent for a new link.", 403);
    }
    const existingDefault = await supabase
      .from("vault_cards")
      .select("id")
      .eq("is_default", true)
      .maybeSingle();
    if (existingDefault.error) throw new Error(existingDefault.error.message);
    const shouldBecomeDefault = body.make_default === true || !existingDefault.data;
    const result = await supabase
      .from("vault_cards")
      .insert({
        user_id: user.id,
        brand,
        last4: body.last4,
        label: body.label?.slice(0, 80) || null,
        payment_ref: encryptSecret(`mock_vault_${crypto.randomUUID()}`, encryptionSecret()),
        is_default: shouldBecomeDefault && !existingDefault.data,
      })
      .select("id, brand, last4, label, is_default, created_at")
      .single();
    if (result.error) throw new Error(result.error.message);
    if (shouldBecomeDefault && existingDefault.data) {
      const defaultResult = await supabase.rpc("set_default_agentpay_card", {
        p_card_id: result.data.id,
      });
      if (defaultResult.error) throw new Error(defaultResult.error.message);
      result.data.is_default = true;
    }
    await appendAudit(supabase, `user:${user.id}`, "vault.card_added", result.data.id, {
      brand,
      last4: body.last4,
      is_default: shouldBecomeDefault,
    });
    return stateResponse(req, { card: result.data });
  });
}
