export const MAX_REVOCATION_WINDOW_MS = 10_000;

/**
 * The delay exists only to make the final live-registry check observable in
 * the hackathon demo. It never replaces or weakens the atomic database check.
 */
export function parseRevocationWindowMs(value: unknown): number | null {
  if (value === undefined) return 0;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_REVOCATION_WINDOW_MS
  ) {
    return null;
  }
  return value;
}

export async function waitForRevocationWindow(milliseconds: number): Promise<void> {
  if (milliseconds === 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
