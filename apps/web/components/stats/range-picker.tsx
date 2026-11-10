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

export function RangePicker({ value, onChange }: { value: StatRange; onChange: (value: StatRange) => void }) {
  return <Segmented size="sm" value={value} options={OPTIONS} onChange={onChange} />;
}
