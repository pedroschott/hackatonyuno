import {
  appendAudit,
  ensureAgent,
  getOwnedPaymentCard,
  mandateChallenge,
  mandatePayload,
} from "@/lib/data";
import { authenticatedRequest } from "@/lib/http";
import { publicBaseUrl } from "@/lib/server/db";
import { error, handle, json, mandateLinks, options, readJson } from "@/lib/server/http";
import { loadAuthenticatedState } from "@/lib/server/state";
import { seedMerchants } from "@/lib/seed";
import type { MandateLimits, MandateScope, MandateValidity } from "@/lib/domain";

export const OPTIONS = options;

function merchantId(value: string) {
  return (
    seedMerchants.find(
      (merchant) =>
        merchant.id === value || merchant.name.toLowerCase() === value.toLowerCase(),
    )?.id ?? value
  );
}

export async function GET(req: Request) {
  return handle(async () => {
    const { state } = await loadAuthenticatedState();
    const base = publicBaseUrl(req);
    return json({
      mandates: state.mandates.map((mandate) => ({
        mandate_id: mandate.id,
        status: mandate.status,
        requested_by: mandate.origin?.requested_by,
        created_at: mandate.created_at,
        ...mandateLinks(base, mandate.id),
      })),
    });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<Record<string, unknown>>(req);
    const { supabase, user } = await authenticatedRequest();
    const agent = await ensureAgent(supabase, user.id);

    const scopeInput = (body.scope ?? {}) as Partial<MandateScope>;
    const rawLimits = (body.limits ?? {}) as Record<string, unknown>;
    const rawValidity = (body.validity ?? {}) as Partial<MandateValidity>;
    const payment = (body.payment ?? {}) as { vault_card_id?: string };
    const scope: MandateScope = {
      merchants: (scopeInput.merchants ?? []).map(merchantId),
      categories: scopeInput.categories ?? [],
    };
    const perPurchaseCents =
      typeof rawLimits.per_purchase_cents === "number"
        ? Math.round(rawLimits.per_purchase_cents)
        : Math.round(Number(rawLimits.per_purchase_brl ?? 0) * 100);
    const cumulativeCents =
      typeof rawLimits.cumulative_cents === "number"
        ? Math.round(rawLimits.cumulative_cents)
        : Math.round(Number(rawLimits.cumulative_brl ?? 0) * 100);
    const limits: MandateLimits = {
      per_purchase_cents: perPurchaseCents,
      cumulative_cents: cumulativeCents,
      max_uses: Math.round(Number(rawLimits.max_uses ?? 1)),
      period: "month",
      currency: "BRL",
    };
    const validity: MandateValidity = {
      not_before:
        typeof rawValidity.not_before === "string"
          ? rawValidity.not_before
          : new Date().toISOString(),
      expires_at:
        typeof rawValidity.expires_at === "string"
          ? rawValidity.expires_at
          : new Date(Date.now() + 7 * 86_400_000).toISOString(),
    };
    const requestedCardId =
      typeof body.vault_card_id === "string" ? body.vault_card_id : payment.vault_card_id;
    const selectedCard = await getOwnedPaymentCard(supabase, requestedCardId);
    const vaultCardId = selectedCard?.id;

    if (!scope.merchants.length || !scope.categories.length) {
      return error("At least one merchant and category are required", 400);
    }
    if (
      limits.per_purchase_cents <= 0 ||
      limits.cumulative_cents < limits.per_purchase_cents ||
      limits.max_uses < 1
    ) {
      return error("Invalid spending limits", 400);
    }
    if (new Date(validity.expires_at) <= new Date()) {
      return error("Expiry must be in the future", 400);
    }
    if (requestedCardId && !selectedCard) return error("Payment method not found", 404);
    if (!vaultCardId) return error("Add a payment method before creating a mandate", 400);
    const requestedBy =
      typeof body.requested_by === "string" ? body.requested_by.slice(0, 120) : user.email ?? "User";
    const via = body.via === "panel" ? "panel" : "api";
    const created = await supabase
      .from("mandates")
      .insert({
        issuer_user_id: user.id,
        agent_id: agent.id,
        scope,
        limits,
        validity,
        payment: { vault_card_id: vaultCardId },
        natural_language_description:
          typeof body.natural_language_description === "string"
            ? body.natural_language_description.slice(0, 500)
            : null,
        origin: {
          requested_by: requestedBy,
          via,
          requested_at: new Date().toISOString(),
        },
      })
      .select("*")
      .single();
    if (created.error) throw new Error(created.error.message);
    await appendAudit(supabase, `agent:${agent.id}`, "mandate.created", created.data.id, {
      source: via,
      scope,
      limits,
      requested_by: requestedBy,
      payment_method_id: vaultCardId,
    });

    const { state } = await loadAuthenticatedState();
    const mandate = state.mandates.find((candidate) => candidate.id === created.data.id);
    if (!mandate) throw new Error("Created mandate was not returned");
    const base = publicBaseUrl(req);
    const links = mandateLinks(base, mandate.id);
    const artifact = mandatePayload({
      id: mandate.id,
      issuerUserId: user.id,
      agent,
      scope,
      limits,
      validity,
      payment: { vault_card_id: vaultCardId },
    });
    return json(
      {
        mandate_id: mandate.id,
        status: mandate.status,
        ...links,
        mandate,
        mandate_hash: mandateChallenge(artifact),
        state,
        public_base_url: base,
        server_time: new Date().toISOString(),
        message: `Draft created. Ask the user to authorize it at ${links.approval_url}.`,
      },
      { status: 201 },
    );
  });
}
