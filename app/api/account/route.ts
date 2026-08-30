import { z } from "zod";

import { appendAudit } from "@/lib/data";
import { apiError, authenticatedRequest } from "@/lib/http";
import { loadLatestIdentityVerification } from "@/lib/identity-verification";

const profileSchema = z.object({
  legal_name: z.string().trim().max(120).optional(),
  tax_id: z.string().trim().max(32).optional(),
  phone: z.string().trim().max(32).optional(),
  address_line1: z.string().trim().max(160).optional(),
  address_line2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  postal_code: z.string().trim().max(20).optional(),
  country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
});

const profileFields =
  "user_id, legal_name, tax_id, phone, address_line1, address_line2, city, region, postal_code, country_code, updated_at";

export async function GET() {
  try {
    const { supabase, user } = await authenticatedRequest();
    const [profile, identityVerification, cards, mandates, approvals, attempts, credentials] = await Promise.all([
      supabase.from("customer_profiles").select(profileFields).maybeSingle(),
      loadLatestIdentityVerification(supabase),
      supabase
        .from("vault_cards")
        .select("id, brand, last4, label, is_default, created_at")
        .order("is_default", { ascending: false })
        .order("created_at"),
      supabase.from("mandates").select("*").order("created_at", { ascending: false }),
      supabase.from("approvals").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("attempts").select("*").order("created_at", { ascending: false }).limit(30),
      supabase.from("webauthn_credentials").select("id, device_type, backed_up, created_at, last_used_at"),
    ]);
    const error = [profile, cards, mandates, approvals, attempts, credentials].find((item) => item.error)?.error;
    if (error) throw new Error(error.message);
    const grants = await supabase.auth.oauth.listGrants();

    return Response.json({
      user: { id: user.id, email: user.email },
      profile: profile.data,
      identity_verification: identityVerification,
      cards: cards.data,
      mandates: mandates.data,
      approvals: approvals.data,
      attempts: attempts.data,
      passkeys: credentials.data,
      agent_connections: grants.error ? [] : grants.data,
    });
  } catch (error) {
    return apiError(error, 401);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = profileSchema.parse(await request.json());
    const { supabase, user } = await authenticatedRequest();
    const normalized = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, value === "" ? null : value]),
    );
    const result = await supabase
      .from("customer_profiles")
      .upsert({
        user_id: user.id,
        ...normalized,
        country_code: input.country_code || "BR",
        updated_at: new Date().toISOString(),
      })
      .select(profileFields)
      .single();
    if (result.error) throw new Error(result.error.message);
    await appendAudit(supabase, `user:${user.id}`, "account.profile_updated", user.id, {
      fields: Object.keys(input),
      compliance_ready: Boolean(result.data.legal_name && result.data.tax_id),
      fulfillment_ready: Boolean(
        result.data.address_line1 &&
          result.data.city &&
          result.data.region &&
          result.data.postal_code &&
          result.data.country_code
      ),
    });
    return Response.json({ profile: result.data });
  } catch (error) {
    return apiError(error);
  }
}
