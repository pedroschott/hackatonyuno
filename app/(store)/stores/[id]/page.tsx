import { notFound } from "next/navigation";

import { DynamicStorefront } from "@/components/store/DynamicStorefront";
import { createPublicSupabase } from "@/lib/supabase/bearer";
import { MERCHANT_FIELDS, PRODUCT_FIELDS, type DeveloperMerchant, type DeveloperProduct } from "@/lib/merchant-console";

export const dynamic = "force-dynamic";

export default async function HostedStorePage({ params }: PageProps<"/stores/[id]">) {
  const { id } = await params;
  const supabase = createPublicSupabase();
  const [merchant, products] = await Promise.all([
    supabase.from("merchants").select(MERCHANT_FIELDS).eq("id", id).eq("hosted_store", true).eq("agent_ready", true).maybeSingle(),
    supabase.from("products").select(PRODUCT_FIELDS).eq("merchant_id", id).eq("active", true).order("created_at"),
  ]);
  if (merchant.error || !merchant.data || products.error) notFound();
  return <DynamicStorefront merchant={merchant.data as DeveloperMerchant} products={(products.data ?? []) as DeveloperProduct[]} />;
}
