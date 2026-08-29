import type { AgentState } from "@/lib/engine";
import { authenticatedRequest } from "@/lib/http";
import { handle, options, readJson, stateResponse } from "@/lib/server/http";
import { setAgentRuntime } from "@/lib/server/state";

export const OPTIONS = options;

export async function POST(req: Request) {
  return handle(async () => {
    await authenticatedRequest();
    const body = await readJson<Partial<AgentState>>(req);
    const patch: Partial<AgentState> = {};
    if (typeof body.running === "boolean") patch.running = body.running;
    if (typeof body.target === "string") patch.target = body.target;
    if (typeof body.intervalMs === "number") patch.intervalMs = Math.max(2000, body.intervalMs);
    setAgentRuntime(patch);
    return stateResponse(req);
  });
}
