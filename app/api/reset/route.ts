import { options } from "@/lib/server/http";

export const OPTIONS = options;

export async function POST() {
  return Response.json(
    { error: "Reset is disabled for real AgentPay accounts" },
    { status: 405, headers: { Allow: "OPTIONS" } },
  );
}
