import type { Metadata } from "next";

import { PaymentMethodSetup } from "./payment-method-setup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Secure payment setup · AgentPay",
  referrer: "no-referrer",
};

export default async function PaymentMethodSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  return <PaymentMethodSetup token={token} />;
}
