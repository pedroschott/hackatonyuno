import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { appendAudit, ensureAgent, getAgentPrivateKey } from "@/lib/data";
import { agentPayBaseUrl } from "@/lib/env";
import { createPaymentSetupToken } from "@/lib/payment-setup";
import { createBearerSupabase } from "@/lib/supabase/bearer";
import {
  discoverAgentPayCatalog,
  discoverAgentPayMerchant,
  signAgentPayRequest,
} from "@/sdk";

function mcpResult(data: Record<string, unknown>, narration: string) {
  return {
    structuredContent: data,
    content: [
      { type: "text" as const, text: narration },
      { type: "text" as const, text: JSON.stringify(data) },
    ],
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
  vaultCardId: string;
}, ctx: ServerContext) {
  const auth = authContext(ctx);
  if (input.cumulativeCents < input.perPurchaseCents) {
    throw new Error("The cumulative limit must be at least the per-purchase limit");
  }
  if (new Date(input.expiresAt) <= new Date()) throw new Error("Expiry must be in the future");
  const card = await auth.supabase.from("vault_cards").select("id").eq("id", input.vaultCardId).single();
  if (card.error) throw new Error("The selected card was not found in this AgentPay account");
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
      payment: { vault_card_id: input.vaultCardId },
    })
    .select("*")
    .single();
  if (created.error) throw new Error(created.error.message);
  await appendAudit(auth.supabase, `agent:${agent.id}`, "mandate.created", created.data.id, {
    source: "mcp",
    scope: created.data.scope,
    limits: created.data.limits,
  });
  return {
    mandate_id: created.data.id,
    status: created.data.status,
    authorization_url: `${auth.origin}/m/mandates/${created.data.id}`,
    mandate: created.data,
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
      const [cards, mandates, approvals] = await Promise.all([
        auth.supabase.from("vault_cards").select("id, brand, last4, created_at").order("created_at"),
        auth.supabase.from("mandates").select("id, status, scope, limits, validity, agent_id").order("created_at", { ascending: false }),
        auth.supabase.from("approvals").select("id, mandate_id, attempt_id, status, created_at").eq("status", "pending"),
      ]);
      const error = cards.error ?? mandates.error ?? approvals.error;
      if (error) throw new Error(error.message);
      const cardRows = cards.data ?? [];
      const mandateRows = mandates.data ?? [];
      const approvalRows = approvals.data ?? [];
      return mcpResult(
        { cards: cardRows, mandates: mandateRows, pending_approvals: approvalRows },
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
        .select("id, brand, last4, created_at")
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
    "discover_merchant",
    {
      title: "Discover an AgentPay merchant",
      description:
        "Use this after finding a product page or store URL. It reads the store-owned AgentPay manifest and catalog, returning exact merchant, category, price and product IDs required by create_mandate and purchase. AgentPay does not provide a store directory.",
      inputSchema: z.object({
        merchant_url: z.url().describe(
          "The product page, store URL, or /.well-known/agentpay.json URL on the merchant's own domain.",
        ),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: true,
      },
    },
    async ({ merchant_url }) => {
      const manifest = await discoverAgentPayMerchant(merchant_url);
      const catalog = await discoverAgentPayCatalog(manifest.catalog_endpoint);
      if (catalog.merchant.id !== manifest.merchant.id) {
        throw new Error("Merchant manifest and catalog identify different merchants");
      }
      return mcpResult(
        { manifest, catalog },
        `Discovered ${manifest.merchant.name}. Use catalog.products[].product_id verbatim when calling purchase; do not substitute a SKU, name, URL slug, or list position.`,
      );
    },
  );

  server.registerTool(
    "create_mandate",
    {
      title: "Create purchase mandate",
      description: "Use this when the user has described a purchase scope and needs a draft Intent Mandate. Return the authorization URL and wait for passkey approval before purchasing.",
      inputSchema: z.object({
        merchant_ids: z.array(z.string().min(1)).min(1).max(10).describe("Exact merchant IDs returned by discover_merchant."),
        categories: z.array(z.string().min(1)).min(1).max(10).describe("Exact product categories returned by discover_merchant."),
        per_purchase_cents: z.number().int().positive().describe("Maximum amount for one purchase in minor currency units."),
        cumulative_cents: z.number().int().positive().describe("Maximum cumulative amount in minor currency units."),
        max_uses: z.number().int().positive().max(100).describe("Maximum number of approved purchases."),
        expires_at: z.iso.datetime().describe("ISO 8601 expiry timestamp after the expected purchase window."),
        vault_card_id: z.uuid().describe("Saved card ID returned by get_account."),
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
        `Draft Intent Mandate ${result.mandate_id} created. Ask the user to authorize it at ${result.authorization_url}.`,
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
      description: "Use this only after discover_merchant returned the exact merchant and product IDs and get_mandate reports an active mandate. Never guess a product ID from its name, SKU, URL slug, or list position.",
      inputSchema: z.object({
        mandate_id: z.uuid().describe("Active mandate ID returned by create_mandate and confirmed by get_mandate."),
        merchant_url: z.url().describe("Merchant store or product URL previously passed to discover_merchant."),
        product_id: z.string().min(1).describe("Exact catalog.products[].product_id returned by discover_merchant."),
        exception_id: z.uuid().optional().describe("One-time approved exception ID, only when the prior purchase result requested it."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    },
    async (input, ctx) => {
      const auth = authContext(ctx);
      const manifest = await discoverAgentPayMerchant(input.merchant_url);
      const catalog = await discoverAgentPayCatalog(manifest.catalog_endpoint);
      const catalogProduct = catalog.products.find(
        (product) => product.product_id === input.product_id,
      );
      if (!catalogProduct || catalogProduct.merchant_id !== manifest.merchant.id) {
        throw new Error(
          `Merchant did not publish product_id "${input.product_id}". Call discover_merchant and use catalog.products[].product_id verbatim.`,
        );
      }
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
