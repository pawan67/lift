/**
 * Bar colour for a ranking of body parts. The list is already ordered, so one
 * colour carries it: volt marks the leader, the rest stay quiet.
 */
export function rankColor(rank: number): string {
  return rank === 0 ? "var(--volt)" : "color-mix(in srgb, var(--fg-3) 60%, transparent)";
}
