import { authenticatedRequest } from "@/lib/http";
import { handle, json, options } from "@/lib/server/http";

export const OPTIONS = options;

export interface SafeMerchantDirectoryEntry {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  storefront_url: string;
  discovery_url: string;
  currency: string;
  display_status: "active" | "inactive";
  agent_ready: boolean;
  logo_key?: string | null;
  supported_canonical_categories: string[];
}

export const SAFE_MERCHANT_DIRECTORY: readonly SafeMerchantDirectoryEntry[] = [
  {
    id: "mrc_autoparts",
    name: "AutoParts",
    slug: "autoparts",
    vertical: "automotive",
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
    vertical: "grocery",
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
    vertical: "grocery",
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
    vertical: "beauty",
    storefront_url: "/merchants/mare-botanicals",
    discovery_url: "/merchants/mare-botanicals/.well-known/agentpay.json",
    currency: "USD",
    display_status: "active",
    agent_ready: true,
    supported_canonical_categories: ["beauty.skincare", "beauty.oils"],
  },
];

const CANONICAL_CATEGORIES_BY_MERCHANT: Record<string, string[]> = {
  mrc_autoparts: ["automotive.tires", "automotive.accessories"],
  mrc_harvest_market: ["food.grains.rice", "food.meat.poultry", "food.prepared.burgers"],
  mrc_city_basket: ["food.grains.rice", "food.meat.poultry", "food.prepared.burgers"],
  mrc_mare_botanicals: ["beauty.skincare", "beauty.oils"],
};

export async function GET() {
  return handle(async () => {
    // Authenticate user - fails closed with 401 if unauthenticated
    const { supabase } = await authenticatedRequest();

    try {
      const { data, error: dbError } = await supabase
        .from("merchants")
        .select("id, name, slug, vertical, category, storefront_url, discovery_url, currency, display_status, agent_ready, logo_key")
        .eq("display_status", "active");

      if (dbError || !data || data.length === 0) {
        return json({
          ok: true,
          merchants: SAFE_MERCHANT_DIRECTORY.filter((m) => m.display_status === "active"),
        });
      }

      const activeMerchants: SafeMerchantDirectoryEntry[] = data
        .filter((row) => row.display_status === "active" && row.id !== "mrc_pneufast")
        .map((row) => ({
          id: String(row.id),
          name: String(row.name),
          slug: typeof row.slug === "string" ? row.slug : String(row.id).replace(/^mrc_/, "").replace(/_/g, "-"),
          vertical: typeof row.vertical === "string" ? row.vertical : (typeof row.category === "string" ? row.category : "general"),
          storefront_url: typeof row.storefront_url === "string" ? row.storefront_url : `/merchants/${row.slug ?? row.id}`,
          discovery_url: typeof row.discovery_url === "string" ? row.discovery_url : `/merchants/${row.slug ?? row.id}/.well-known/agentpay.json`,
          currency: typeof row.currency === "string" ? row.currency : "USD",
          display_status: "active" as const,
          agent_ready: row.agent_ready !== false,
          logo_key: typeof row.logo_key === "string" ? row.logo_key : null,
          supported_canonical_categories: CANONICAL_CATEGORIES_BY_MERCHANT[String(row.id)] ?? [],
        }));

      return json({
        ok: true,
        merchants: activeMerchants.length > 0 ? activeMerchants : SAFE_MERCHANT_DIRECTORY,
      });
    } catch {
      return json({
        ok: true,
        merchants: SAFE_MERCHANT_DIRECTORY,
      });
    }
  });
}
