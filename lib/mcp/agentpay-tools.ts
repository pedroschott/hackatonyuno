import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  appendAudit,
  ensureAgent,
  getAgentPrivateKey,
  getOwnedPaymentCard,
} from "@/lib/data";
import { agentPayBaseUrl } from "@/lib/env";
import { createPaymentSetupToken } from "@/lib/payment-setup";
import { createBearerSupabase } from "@/lib/supabase/bearer";
import { discoverAgentPayMerchant, signAgentPayRequest } from "@/sdk";

function mcpResult(data: Record<string, unknown>, narration: string) {
  return {
    structuredContent: data,
    content: [{ type: "text" as const, text: narration }],
  };
}

function authContext(ctx: ServerContext) {
  const auth = ctx.http?.authInfo;
  const userId = auth?.extra?.userId;
  if (!auth?.token || typeof userId !== "string") throw new Error("Authenticated AgentPay account required");
  return {
    token: auth.token,
    userId,
    origin: typeof auth.extra?.origin === "string" ? auth.extra.origin : agentPayBaseUrl(),
    supabase: createBearerSupabase(auth.token),
  };
}

async function createMandate(input: {
  merchantIds: string[];
  categories: string[];
  perPurchaseCents: number;
  cumulativeCents: number;
  maxUses: number;
  expiresAt: string;
  vaultCardId?: string;
}, ctx: ServerContext) {
  const auth = authContext(ctx);
  if (input.cumulativeCents < input.perPurchaseCents) {
    throw new Error("The cumulative limit must be at least the per-purchase limit");
  }
  if (new Date(input.expiresAt) <= new Date()) throw new Error("Expiry must be in the future");
  const card = await getOwnedPaymentCard(auth.supabase, input.vaultCardId);
  if (!card) {
    throw new Error(
      input.vaultCardId
        ? "The selected card was not found in this AgentPay account"
        : "No saved card is available. Ask the user to complete payment setup first",
    );
  }
  const agent = await ensureAgent(auth.supabase, auth.userId);
  const created = await auth.supabase
    .from("mandates")
    .insert({
      issuer_user_id: auth.userId,
      agent_id: agent.id,
      scope: { merchants: input.merchantIds, categories: input.categories },
      limits: {
        per_purchase_cents: input.perPurchaseCents,
        cumulative_cents: input.cumulativeCents,
        max_uses: input.maxUses,
        period: "month",
        currency: "BRL",
      },
      validity: { not_before: new Date().toISOString(), expires_at: input.expiresAt },
      payment: { vault_card_id: card.id },
    })
    .select("*")
    .single();
  if (created.error) throw new Error(created.error.message);
  await appendAudit(auth.supabase, `agent:${agent.id}`, "mandate.created", created.data.id, {
    source: "mcp",
    scope: created.data.scope,
    limits: created.data.limits,
    payment_method_id: card.id,
  });
  return {
    mandate_id: created.data.id,
    status: created.data.status,
    authorization_url: `${auth.origin}/m/mandates/${created.data.id}`,
    mandate: created.data,
    selected_card: {
      id: card.id,
      brand: card.brand,
      last4: card.last4,
      label: card.label,
      is_default: card.is_default,
    },
  };
}

export function registerAgentPayTools(server: McpServer) {
  server.registerTool(
    "get_account",
    {
      title: "Get AgentPay account",
      description: "Use this when the user needs their saved cards, mandates, or pending approvals before creating or using a purchase mandate.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async (_input, ctx) => {
      const auth = authContext(ctx);
      const [profile, cards, mandates, approvals, attempts] = await Promise.all([
        auth.supabase
          .from("customer_profiles")
          .select("legal_name, tax_id, phone, address_line1, address_line2, city, region, postal_code, country_code, updated_at")
          .maybeSingle(),
        auth.supabase
          .from("vault_cards")
          .select("id, brand, last4, label, is_default, created_at")
          .order("is_default", { ascending: false })
          .order("created_at"),
        auth.supabase.from("mandates").select("id, status, scope, limits, validity, agent_id, payment").order("created_at", { ascending: false }),
        auth.supabase.from("approvals").select("id, mandate_id, attempt_id, status, created_at").eq("status", "pending"),
        auth.supabase
          .from("attempts")
          .select("mandate_id, decision, created_at")
          .eq("decision", "approved")
          .order("created_at", { ascending: false }),
      ]);
      const error = profile.error ?? cards.error ?? mandates.error ?? approvals.error ?? attempts.error;
      if (error) throw new Error(error.message);
      const mandateRows = mandates.data ?? [];
      const cardRows = (cards.data ?? []).map((card) => {
        const mandateIds = new Set(
          mandateRows
            .filter((mandate) => {
              const payment = mandate.payment as { vault_card_id?: string } | null;
              return payment?.vault_card_id === card.id;
            })
            .map((mandate) => mandate.id),
        );
        const uses = (attempts.data ?? []).filter((attempt) => mandateIds.has(attempt.mandate_id));
        return {
          ...card,
          successful_purchase_count: uses.length,
          last_used_at: uses[0]?.created_at ?? null,
        };
      });
      const approvalRows = approvals.data ?? [];
      const orderProfile = profile.data
        ? {
            ...profile.data,
            compliance_ready: Boolean(profile.data.legal_name && profile.data.tax_id),
            fulfillment_ready: Boolean(
              profile.data.address_line1 &&
                profile.data.city &&
                profile.data.region &&
                profile.data.postal_code &&
                profile.data.country_code
            ),
            sharing_note:
              "Use this personal data only for a checkout the user explicitly requested, and share only the fields the merchant needs.",
          }
        : null;
      return mcpResult(
        {
          order_profile: orderProfile,
          cards: cardRows,
          mandates: mandateRows,
          pending_approvals: approvalRows,
        },
        cardRows.length === 0
          ? `AgentPay is connected, but no payment method is saved. Call get_payment_setup_link and ask the user to complete the secure AgentPay browser flow. Never ask the user to send a card number, CVC, PIN, bank password, or vault credential in chat.`
          : `AgentPay is connected. Found ${cardRows.length} card(s), ${mandateRows.length} mandate(s), and ${approvalRows.length} pending approval(s).`,
      );
    },
  );

  server.registerTool(
    "get_payment_setup_link",
    {
      title: "Get secure payment setup link",
      description:
        "Use this when the AgentPay account has no saved payment method or the user asks to add one. Returns a short-lived browser link and accepts no card details. Never request or accept a full card number, CVC, PIN, bank password, or vault credential in chat.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Creating secure payment setup link",
        "openai/toolInvocation/invoked": "Secure payment setup link ready",
      },
    },
    async (_input, ctx) => {
      const auth = authContext(ctx);
      const cards = await auth.supabase
        .from("vault_cards")
        .select("id, brand, last4, label, is_default, created_at")
        .order("is_default", { ascending: false })
        .order("created_at");
      if (cards.error) throw new Error(cards.error.message);
      const { token, expiresAt } = createPaymentSetupToken(auth.userId);
      const setupUrl = `${auth.origin}/payment-methods/setup?token=${encodeURIComponent(token)}`;
      const savedCards = cards.data ?? [];
      return mcpResult(
        {
          status: savedCards.length === 0 ? "payment_method_required" : "ready_to_add_another",
          saved_cards: savedCards,
          setup_url: setupUrl,
          expires_at: expiresAt,
          safety: {
            agent_receives_card_details: false,
            agent_can_authorize_purchase: false,
            agent_visible_fields: ["payment_method_id", "brand", "last4"],
            never_share_in_chat: [
              "full_card_number",
              "cvc",
              "pin",
              "bank_password",
              "vault_credential",
            ],
          },
          next_step:
            "Ask the user to open setup_url and complete payment setup inside AgentPay. Wait for them to return, then call get_account again before creating a mandate.",
        },
        `Open ${setupUrl} to add a payment method securely inside AgentPay. Do not send card details in chat: the agent never sees or uses the full card number, CVC, PIN, bank password, or vault credential. Saving a payment method does not approve a purchase. After setup, return here so I can check the account and prepare the passkey-limited mandate. This link expires at ${expiresAt}.`,
      );
    },
  );

  server.registerTool(
    "create_mandate",
    {
      title: "Create purchase mandate",
      description: "Use this when the user has described a purchase scope and needs a draft Intent Mandate. Return the authorization URL and wait for passkey approval before purchasing.",
      inputSchema: z.object({
        merchant_ids: z.array(z.string().min(1)).min(1).max(10),
        categories: z.array(z.string().min(1)).min(1).max(10),
        per_purchase_cents: z.number().int().positive(),
        cumulative_cents: z.number().int().positive(),
        max_uses: z.number().int().positive().max(100),
        expires_at: z.iso.datetime(),
        vault_card_id: z.uuid().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    },
    async (input, ctx) => {
      const result = await createMandate(
        {
          merchantIds: input.merchant_ids,
          categories: input.categories,
          perPurchaseCents: input.per_purchase_cents,
          cumulativeCents: input.cumulative_cents,
          maxUses: input.max_uses,
          expiresAt: input.expires_at,
          vaultCardId: input.vault_card_id,
        },
        ctx,
      );
      return mcpResult(
        result,
        `Draft Intent Mandate ${result.mandate_id} created with ${result.selected_card.brand} ending in ${result.selected_card.last4}. Ask the user to review the card picker and authorize it at ${result.authorization_url}.`,
      );
    },
  );

  server.registerTool(
    "get_mandate",
    {
      title: "Check mandate status",
      description: "Use this when the agent needs the live status and remaining usage of a specific AgentPay mandate before continuing a purchase.",
      inputSchema: z.object({ mandate_id: z.uuid() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async ({ mandate_id }, ctx) => {
      const auth = authContext(ctx);
      const owned = await auth.supabase.from("mandates").select("id").eq("id", mandate_id).single();
      if (owned.error) throw new Error("Mandate not found");
      const result = await auth.supabase.rpc("get_mandate_registry", { p_mandate_id: mandate_id });
      if (result.error || !result.data) throw new Error("Mandate is not yet active");
      return mcpResult(result.data, `Mandate ${mandate_id} is ${result.data.status}.`);
    },
  );

  server.registerTool(
    "revoke_mandate",
    {
      title: "Revoke purchase mandate",
      description: "Use this immediately when the user asks the agent to stop, cancel, or revoke autonomous purchasing under a mandate.",
      inputSchema: z.object({ mandate_id: z.uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ mandate_id }, ctx) => {
      const auth = authContext(ctx);
      const result = await auth.supabase.rpc("revoke_agentpay_mandate", { p_mandate_id: mandate_id });
      if (result.error) throw new Error(result.error.message);
      return mcpResult(result.data, `Mandate ${mandate_id} is revoked. All future purchase attempts will be refused.`);
    },
  );

  server.registerTool(
    "purchase",
    {
      title: "Purchase with AgentPay",
      description: "Use this when the agent found a product at a merchant that publishes AgentPay metadata. The merchant URL comes from the product page or search result; AgentPay does not provide a store directory.",
      inputSchema: z.object({
        mandate_id: z.uuid(),
        merchant_url: z.url(),
        product_id: z.string().min(1),
        exception_id: z.uuid().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    },
    async (input, ctx) => {
      const auth = authContext(ctx);
      const manifest = await discoverAgentPayMerchant(input.merchant_url);
      const mandateResult = await auth.supabase
        .from("mandates")
        .select("id, agent_id, status")
        .eq("id", input.mandate_id)
        .single();
      if (mandateResult.error) throw new Error("Mandate not found");
      const agent = await ensureAgent(auth.supabase, auth.userId);
      if (mandateResult.data.agent_id !== agent.id) throw new Error("Mandate belongs to another agent credential");
      const privateKey = await getAgentPrivateKey(auth.supabase, auth.userId, agent.id);
      const checkoutBody = JSON.stringify({
        mandate_id: input.mandate_id,
        merchant_id: manifest.merchant.id,
        product_id: input.product_id,
        ...(input.exception_id ? { exception_id: input.exception_id } : {}),
      });
      const headers = signAgentPayRequest({
        agentId: agent.id,
        privateKey,
        method: "POST",
        url: manifest.checkout_endpoint,
        body: checkoutBody,
      });
      const merchantResponse = await fetch(manifest.checkout_endpoint, {
        method: "POST",
        headers,
        body: checkoutBody,
        redirect: "error",
      });
      const merchantDecision = (await merchantResponse.json()) as {
        decision?: string;
        reason_code?: string | null;
        product?: { id: string; category: string; price_cents: number; currency: string };
        checks?: Record<string, boolean>;
        error?: string;
      };
      if (!merchantResponse.ok || !merchantDecision.product) {
        throw new Error(merchantDecision.error ?? merchantDecision.reason_code ?? "Merchant rejected the signed checkout request");
      }
      const final = await auth.supabase.rpc("evaluate_agentpay_checkout", {
        p_mandate_id: input.mandate_id,
        p_agent_id: agent.id,
        p_merchant_id: manifest.merchant.id,
        p_product_id: merchantDecision.product.id,
        p_category: merchantDecision.product.category,
        p_amount_cents: merchantDecision.product.price_cents,
        p_currency: merchantDecision.product.currency,
        p_exception_id: input.exception_id ?? null,
      });
      if (final.error) throw new Error(final.error.message);
      const result = {
        ...final.data,
        merchant: manifest.merchant,
        product: merchantDecision.product,
        merchant_checks: merchantDecision.checks,
        payment_mode: "mock",
      };
      const narration =
        final.data.decision === "approved"
          ? `Purchase approved. Mock payment token minted for ${manifest.merchant.name}.`
          : final.data.decision === "escalated"
            ? `Purchase requires passkey approval. Ask the user to approve request ${final.data.approval_id}, then retry with that exception ID.`
            : `Purchase refused: ${final.data.reason_code}.`;
      return mcpResult(result, narration);
    },
  );
}
