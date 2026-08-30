import { MerchantDetail } from "@/components/developers/MerchantDetail";

export default async function MerchantPage({ params }: PageProps<"/developers/merchants/[id]">) {
  const { id } = await params;
  return <MerchantDetail id={id} />;
}
