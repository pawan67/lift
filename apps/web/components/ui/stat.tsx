/** A labelled figure: the stat tiles on the dashboard and the report screens. */

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
  size = "md",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** `sm` for long strips of figures, which wrap badly at full size on a phone. */
  size?: "sm" | "md";
  unit?: ReactNode;
  /** A short second line, e.g. a change against the previous period. */
  hint?: ReactNode;
  tone?: "up" | "down" | "neutral";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[13px] text-fg-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={cn("tabular truncate leading-tight font-semibold tracking-[-0.02em] text-fg", size === "sm" ? "text-xl" : "text-[26px]")}>{value}</span>
        {unit ? <span className="text-sm text-fg-3">{unit}</span> : null}
      </div>
      {hint ? (
        <div className={cn("tabular mt-1 text-xs", tone === "up" ? "text-signal" : tone === "down" ? "text-alarm/90" : "text-fg-3")}>{hint}</div>
      ) : null}
    </div>
  );
}
