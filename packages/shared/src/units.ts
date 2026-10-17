/**
 * Unit conversion and formatting.
 *
 * Storage rule: the database always holds **kilograms, kilometres and
 * centimetres**. Display units are a presentation concern applied at the edge.
 * Storing whatever unit the user happened to prefer at entry time would make
 * every aggregate query wrong the moment they switched.
 */

import type { DistanceUnit, MeasurementUnit, WeightUnit } from './types.ts';

const LB_PER_KG = 2.2046226218487757;
const KM_PER_MILE = 1.609344;
const CM_PER_INCH = 2.54;

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

export function lbToKg(lb: number): number {
  return lb / LB_PER_KG;
}

/** Converts a stored (kg) value into the user's display unit. */
export function toDisplayWeight(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kgToLb(kg);
}

/** Converts a user-entered value in `unit` back to storage (kg). */
export function fromDisplayWeight(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : lbToKg(value);
}

/**
 * Formats a weight for display, trimming trailing zeros.
 *
 * Gym weights are rarely more precise than 0.25 (micro-plates), so two decimals
 * is the ceiling, but 100 should render as "100", not "100.00".
 *
 * With `withUnit: false` this is also the correct value for an editable weight
 * field. Two decimals absorbs the float noise of the kg↔lb round trip (an
 * lb-entered 225 comes back as 225.00000000000003) and the zero trimming keeps
 * it from reappearing in the field as "225.0", which the user then has to
 * delete before typing.
 */
export function formatWeight(
  kg: number,
  unit: WeightUnit,
  options: { decimals?: number; withUnit?: boolean } = {},
): string {
  const { decimals = 2, withUnit = true } = options;
  const value = toDisplayWeight(kg, unit);
  const text = trimZeros(value.toFixed(decimals));
  return withUnit ? `${text} ${unit}` : text;
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

export function toDisplayDistance(km: number, unit: DistanceUnit): number {
  return unit === 'km' ? km : km / KM_PER_MILE;
}

export function fromDisplayDistance(value: number, unit: DistanceUnit): number {
  return unit === 'km' ? value : value * KM_PER_MILE;
}

export function formatDistance(km: number, unit: DistanceUnit): string {
  const value = toDisplayDistance(km, unit);
  // Sub-kilometre distances read better in metres.
  if (unit === 'km' && value < 1) return `${Math.round(value * 1000)} m`;
  return `${trimZeros(value.toFixed(2))} ${unit}`;
}

// ---------------------------------------------------------------------------
// Body measurements
// ---------------------------------------------------------------------------

export function toDisplayMeasurement(cm: number, unit: MeasurementUnit): number {
  return unit === 'cm' ? cm : cm / CM_PER_INCH;
}

export function fromDisplayMeasurement(value: number, unit: MeasurementUnit): number {
  return unit === 'cm' ? value : value * CM_PER_INCH;
}

export function formatMeasurement(cm: number, unit: MeasurementUnit): string {
  return `${trimZeros(toDisplayMeasurement(cm, unit).toFixed(1))} ${unit}`;
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/** Formats seconds as `M:SS`, or `H:MM:SS` once past an hour. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** Compact human duration for summaries: "1h 24m", "48m", "45s". */
export function formatDurationShort(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

/** Parses "90", "1:30" or "1:02:03" into seconds. Returns null if unparseable. */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(':');
  if (parts.length > 3) return null;

  let seconds = 0;
  for (const part of parts) {
    if (!/^\d*$/.test(part)) return null;
    seconds = seconds * 60 + (part === '' ? 0 : Number(part));
  }
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Re-spells a run of typed digits as a clock while a duration is entered, so a
 * time can be filled from a numeric keypad.
 *
 * The last two digits are seconds, the two before them minutes, and anything
 * left over is hours: typing "2500" reads "25:00" and "130" reads "1:30". This
 * is the convention every stopwatch and timer uses, and it exists because no
 * mobile keyboard offers digits *and* a colon at once. `numbers-and-punctuation`
 * is iOS-only and falls back to the full alphabetical keyboard on Android, so
 * the field asks for a number pad and inserts the colon itself.
 *
 * Non-digits are dropped first, which is what makes the transform idempotent
 * over its own output: appending a digit to the displayed "1:30" hands back
 * "1:300", which re-reads as "13:00". Capped at six digits, the most
 * `parseDuration` accepts; a seventh would build a fourth group and parse as
 * null, stranding the keystroke.
 */
export function formatDurationDraft(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;

  const groups: string[] = [];
  let rest = digits;
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  groups.unshift(rest);
  return groups.join(':');
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

/**
 * Formats total volume in full, grouped: "12,400 kg", "1,284,300 kg".
 *
 * It used to collapse anything past ten thousand to "12.4k" and past a million
 * to "1.3M". That is a compression that throws away the part of the number
 * people actually compare: a week at 12.4k and a week at 12.45k print the same,
 * and it did it exactly where volume gets interesting. Every figure in this
 * app is set in a tabular face and sits in a column sized for it, so the extra
 * three or four characters cost layout nothing and buy back the precision.
 *
 * Grouping is `toLocaleString`, so the separator follows the device locale: a
 * thousands comma here, a period or a thin space elsewhere.
 *
 * With `withUnit: false` this is the value alone, for a chart axis that states
 * its unit in the heading rather than on every label.
 */
export function formatVolume(
  kg: number,
  unit: WeightUnit,
  options: { withUnit?: boolean } = {},
): string {
  const { withUnit = true } = options;
  const text = Math.round(toDisplayWeight(kg, unit)).toLocaleString();
  return withUnit ? `${text} ${unit}` : text;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * "100.00" → "100", "102.50" → "102.5", "102.55" → "102.55"
 *
 * Exported because the editable distance field needs the same treatment and
 * cannot use `formatDistance`: that formatter switches to metres below 1 km,
 * which is unusable in a field the user is typing kilometres into.
 */
export function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/**
 * Rounds a weight to the nearest increment the user can actually load.
 * Barbell gyms in kg jump by 2.5; lb gyms by 5. Used by the plate calculator
 * and by "+"/"−" steppers in the set row.
 */
export function roundToIncrement(kg: number, incrementKg: number): number {
  if (incrementKg <= 0) return kg;
  return Math.round(kg / incrementKg) * incrementKg;
}
