/**
 * Display formatting, bound to the user's unit settings.
 *
 * Everything is stored canonically (kg, km, cm, seconds, epoch ms); screens
 * call `useFormat()` and print through it so a units switch reaches every
 * figure at once.
 */

"use client";

import {
  formatDistance,
  formatDuration,
  formatDurationShort,
  formatMeasurementValue,
  formatPrValue,
  formatVolume,
  formatWeight,
  toDisplayWeight,
  type MeasurementKind,
  type PrKind,
} from "@lift/shared";
import { useMemo } from "react";

import { useSettings } from "./settings";

export function useFormat() {
  const weightUnit = useSettings((s) => s.weightUnit);
  const distanceUnit = useSettings((s) => s.distanceUnit);
  const measurementUnit = useSettings((s) => s.measurementUnit);

  return useMemo(
    () => ({
      weightUnit,
      distanceUnit,
      measurementUnit,
      /** "82.5 kg" */
      weight: (kg: number, decimals = 1) => formatWeight(kg, weightUnit, { decimals }),
      /** "82.5" in the display unit, no suffix. */
      weightValue: (kg: number, decimals = 1) => formatWeight(kg, weightUnit, { decimals, withUnit: false }),
      /** The number in the display unit, for charts. */
      toWeight: (kg: number) => toDisplayWeight(kg, weightUnit),
      /** "12,340 kg" */
      volume: (kg: number) => formatVolume(kg, weightUnit),
      volumeValue: (kg: number) => formatVolume(kg, weightUnit, { withUnit: false }),
      /** "12.3k" style for axis ticks. */
      compactVolume: (kg: number) => compactNumber(toDisplayWeight(kg, weightUnit)),
      distance: (km: number) => formatDistance(km, distanceUnit),
      duration: formatDuration,
      durationShort: formatDurationShort,
      record: (kind: PrKind, value: number) => formatPrValue(kind, value, weightUnit),
      measurement: (kind: MeasurementKind, stored: number) =>
        formatMeasurementValue(kind, stored, { weightUnit, measurementUnit }),
      measurementPrefs: { weightUnit, measurementUnit },
    }),
    [weightUnit, distanceUnit, measurementUnit],
  );
}

export type Formatter = ReturnType<typeof useFormat>;

export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 10_000) return `${Math.round(value / 1000)}k`;
  if (abs >= 1_000) return `${trim(value / 1000)}k`;
  return `${Math.round(value)}`;
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

export function integer(value: number): string {
  return Math.round(value).toLocaleString();
}

export function percent(value: number, decimals = 0): string {
  return `${value.toFixed(decimals)}%`;
}

/** "+12%" / "−4%" against a previous value; null when there is nothing to compare. */
export function changeLabel(now: number, before: number): { text: string; tone: "up" | "down" | "neutral" } | null {
  if (before <= 0) return null;
  const change = ((now - before) / before) * 100;
  if (Math.abs(change) < 0.5) return { text: "No change", tone: "neutral" };
  return {
    text: `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(0)}%`,
    tone: change > 0 ? "up" : "down",
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export function formatDate(ms: number, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  return new Date(ms).toLocaleDateString(undefined, options);
}

export function formatDateShort(ms: number): string {
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Today", "Yesterday", "3 days ago", then a date. */
export function relativeDay(ms: number, now = Date.now()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((start.getTime() - ms) / DAY_MS) + 1;
  if (ms >= start.getTime()) return "Today";
  if (days <= 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDateShort(ms);
}
