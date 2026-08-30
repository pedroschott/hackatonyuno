import type { Agent, Mandate } from "@/lib/types";

/**
 * What to call the thing that is spending. Whoever asked for the permission
 * ("Claude", "ChatGPT") means more to the account holder than the agent record,
 * so that name wins when the request carried one.
 */
export function agentLabel(mandate: Mandate | undefined, agents: Agent[]) {
  const requestedBy = mandate?.origin?.requested_by?.trim();
  if (requestedBy && !requestedBy.includes("@")) return requestedBy;
  const agent = agents.find((a) => a.id === mandate?.agent.agent_id) ?? agents[0];
  return agent?.name ?? "Your agent";
}
