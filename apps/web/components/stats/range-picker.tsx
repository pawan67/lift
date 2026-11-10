"use client";

import { Segmented } from "@/components/ui/segmented";
import type { StatRange } from "@/lib/stats/windows";

const OPTIONS: { value: StatRange; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
];

export function RangePicker({
  value,
  onChange,
  options,
}: {
  value: StatRange;
  onChange: (value: StatRange) => void;
  /** Narrow the offer. Food statistics read at most a year, so they leave out "All". */
  options?: readonly StatRange[];
}) {
  const available = options ? OPTIONS.filter((option) => options.includes(option.value)) : OPTIONS;
  return <Segmented size="sm" value={value} options={available} onChange={onChange} />;
}
