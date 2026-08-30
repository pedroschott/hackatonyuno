"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FileCode, Store } from "lucide-react";
import { useStore, selectCurrentMandate } from "@/lib/store";
import type { Mandate } from "@/lib/types";
import { Badge, Card, CardHeader, Mono } from "@/components/ui";

export interface SafeMerchant {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  storefront_url: string;
  discovery_url: string;
  currency: string;
  display_status: "active" | "inactive";
  agent_ready: boolean;
  supported_canonical_categories: string[];
}

export const DEFAULT_STORES: readonly SafeMerchant[] = [
  {
    id: "mrc_autoparts",
    name: "AutoParts",
    slug: "autoparts",
    vertical: "Automotive",
    storefront_url: "/store",
    discovery_url: "/merchants/autoparts/.well-known/agentpay.json",
    currency: "USD",
    display_status: "active",
    agent_ready: true,
    supported_canonical_categories: ["automotive.tires", "automotive.accessories"],
  },
  {
    id: "mrc_harvest_market",
    name: "Harvest Market",
    slug: "harvest-market",
    vertical: "Grocery",
    storefront_url: "/merchants/harvest-market",
    discovery_url: "/merchants/harvest-market/.well-known/agentpay.json",
    currency: "USD",
    display_status: "active",
    agent_ready: true,
    supported_canonical_categories: ["food.grains.rice", "food.meat.poultry", "food.prepared.burgers"],
  },
  {
    id: "mrc_city_basket",
    name: "City Basket",
    slug: "city-basket",
    vertical: "Grocery",
    storefront_url: "/merchants/city-basket",
    discovery_url: "/merchants/city-basket/.well-known/agentpay.json",
    currency: "USD",
    display_status: "active",
    agent_ready: true,
    supported_canonical_categories: ["food.grains.rice", "food.meat.poultry", "food.prepared.burgers"],
  },
  {
    id: "mrc_mare_botanicals",
    name: "Maré Botanicals",
    slug: "mare-botanicals",
    vertical: "Beauty",
    storefront_url: "/merchants/mare-botanicals",
    discovery_url: "/merchants/mare-botanicals/.well-known/agentpay.json",
    currency: "USD",
    display_status: "active",
    agent_ready: true,
    supported_canonical_categories: ["beauty.skincare", "beauty.oils"],
  },
];

export function getCompatibilityStatus(
  merchant: SafeMerchant,
  mandate?: Mandate | null,
): {
  status: "covered" | "requires_approval" | "outside_scope";
  tone: "success" | "warn" | "neutral";
  label: "In scope" | "Approval required" | "Outside scope";
} {
  if (!mandate || mandate.status !== "active") {
    return {
      status: "outside_scope",
      tone: "neutral",
      label: "Outside scope",
    };
  }

  const merchantMatches = mandate.scope.merchants.includes(merchant.id);
  const categoriesMatches = merchant.supported_canonical_categories.filter((supported) =>
    mandate.scope.categories.some(
      (mandateCat) =>
        supported === mandateCat ||
        supported.startsWith(mandateCat + ".") ||
        mandateCat.startsWith(supported + ".") ||
        supported.endsWith("." + mandateCat) ||
        mandateCat.endsWith("." + supported),
    ),
  );

  const hasAnyCategoryMatch = categoriesMatches.length > 0;
  const hasFullCategoryMatch =
    categoriesMatches.length === merchant.supported_canonical_categories.length;

  if (merchantMatches && (hasFullCategoryMatch || hasAnyCategoryMatch)) {
    return {
      status: "covered",
      tone: "success",
      label: "In scope",
    };
  }

  if (merchantMatches || hasAnyCategoryMatch) {
    return {
      status: "requires_approval",
      tone: "warn",
      label: "Approval required",
    };
  }

  return {
    status: "outside_scope",
    tone: "neutral",
    label: "Outside scope",
  };
}

function formatVertical(v: string): string {
  const lower = v.toLowerCase();
  if (lower.includes("auto")) return "Automotive";
  if (lower.includes("groc") || lower.includes("food")) return "Grocery";
  if (lower.includes("beauty")) return "Beauty";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export function ConnectedStores() {
  const mandate = useStore(selectCurrentMandate);
  const [stores, setStores] = useState<readonly SafeMerchant[]>(DEFAULT_STORES);

  useEffect(() => {
    let cancelled = false;
    async function loadDirectory() {
      try {
        const res = await fetch("/api/merchant-directory");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.merchants) && data.merchants.length > 0) {
          setStores(data.merchants);
        }
      } catch {
        // Fall back to DEFAULT_STORES
      }
    }
    loadDirectory();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader
        title={
          <div className="flex items-center gap-2">
            <Store className="size-4 text-brand" />
            <span>Connected stores</span>
          </div>
        }
        description="Active merchant store network and dynamic mandate compatibility."
        actions={<Badge tone="brand">{stores.length} stores</Badge>}
      />

      <div className="divide-y divide-line-2">
        {stores.map((store) => {
          const compat = getCompatibilityStatus(store, mandate);
          const verticalDisplay = formatVertical(store.vertical);

          return (
            <div key={store.id} className="p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[14.5px] font-semibold text-ink">{store.name}</h3>
                    <Badge tone="brand">{verticalDisplay}</Badge>
                    <Badge tone={compat.tone} dot>
                      {compat.label}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                    <Mono>{store.id}</Mono>
                    <span>·</span>
                    <span>Currency: {store.currency}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={store.storefront_url}
                    className="inline-flex items-center gap-1 rounded border border-line bg-white px-2.5 py-1 text-[12px] font-medium text-ink-2 shadow-xs transition-colors hover:bg-canvas hover:text-ink"
                  >
                    <span>Storefront</span>
                    <ArrowUpRight className="size-3.5 text-muted" />
                  </Link>
                  <a
                    href={store.discovery_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-line bg-white px-2.5 py-1 text-[12px] font-medium text-ink-2 shadow-xs transition-colors hover:bg-canvas hover:text-ink"
                    title="View AgentPay discovery document"
                  >
                    <span>Discovery</span>
                    <FileCode className="size-3.5 text-muted" />
                  </a>
                </div>
              </div>

              <div className="mt-3">
                <div className="text-[11.5px] font-medium uppercase tracking-wide text-faint">
                  Supported Canonical Categories
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {store.supported_canonical_categories.map((cat) => (
                    <Mono key={cat} className="text-[11px]">
                      {cat}
                    </Mono>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
