/** A small status label in one of the palette's roles. */

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "volt" | "record" | "signal" | "warn" | "alarm" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-3 text-fg-2",
  volt: "bg-volt-tint text-volt",
  record: "bg-record/15 text-record",
  signal: "bg-signal/15 text-signal",
  warn: "bg-warn/15 text-warn",
  alarm: "bg-alarm/15 text-alarm",
  info: "bg-info/15 text-info",
};

export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}
