/** Chart windows for measurement history. Body readings move slowly, so these start at a month. */

export const MEASUREMENT_RANGES = [
  { value: "30d", label: "1M", days: 30 },
  { value: "90d", label: "3M", days: 90 },
  { value: "1y", label: "1Y", days: 365 },
  { value: "all", label: "All", days: null },
] as const;

export type MeasurementRange = (typeof MEASUREMENT_RANGES)[number]["value"];

export function rangeDays(range: MeasurementRange): number | null {
  return MEASUREMENT_RANGES.find((entry) => entry.value === range)?.days ?? null;
}
