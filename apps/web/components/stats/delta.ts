/**
 * Period-over-period change, toned down: a move under 10% is noise in training
 * data, so it reads in grey and only a real swing gets green or red.
 */

import { changeLabel } from "@/lib/format";

export const LOUD_CHANGE = 10;

export type Tone = "up" | "down" | "neutral";

export function quietTone(now: number, before: number, tone: Tone): Tone {
  if (tone === "neutral" || before <= 0) return "neutral";
  return Math.abs(((now - before) / before) * 100) >= LOUD_CHANGE ? tone : "neutral";
}

/** `changeLabel`, with small changes neutral. */
export function quietChange(now: number, before: number): { text: string; tone: Tone } | null {
  const delta = changeLabel(now, before);
  return delta ? { text: delta.text, tone: quietTone(now, before, delta.tone) } : null;
}

export function toneClass(tone: Tone | undefined): string {
  return tone === "up" ? "text-signal" : tone === "down" ? "text-alarm/90" : "text-fg-3";
}
