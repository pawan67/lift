/**
 * The numbers every set-entry control agrees on: how far one step moves a
 * value, where a value stops, and how it is written back.
 *
 * All of it is in the *display* unit. A dial in pounds steps by 5 lb, not by a
 * converted 2.27, and the row converts to kilograms once, when it commits.
 */

import { trimZeros, type WeightUnit } from '@lift/shared';

export type EntryField = 'weight' | 'reps';

/** The smallest jump a plate pair makes on a typical gym's rack. */
export function stepFor(field: EntryField, unit: WeightUnit): number {
  if (field === 'reps') return 1;
  return unit === 'lb' ? 5 : 2.5;
}

/** Upper bounds. Generous for weight, so a leg press never hits the end. */
export function maxFor(field: EntryField, unit: WeightUnit): number {
  if (field === 'reps') return 100;
  return unit === 'lb' ? 1100 : 500;
}

/** Labelled marks on a ruler: every 10 kg, 20 lb, or 5 reps. */
export function majorEvery(field: EntryField): number {
  return field === 'reps' ? 5 : 4;
}

/** Strips the float noise a step sum picks up: 0.1 + 0.2 and its relatives. */
export function tidy(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * `steps` steps from `start`, landing on the step grid.
 *
 * An imported 82 kg stepped up goes to 82.5, not 84.5: the first step snaps to
 * the grid and every step after it walks along it, the same rule the effort
 * stepper uses for an imported 7.3.
 */
export function stepFrom(start: number, steps: number, step: number, max: number): number {
  if (steps === 0) return start;
  const units = start / step;
  const base = steps > 0 ? Math.floor(units + 1e-9) : Math.ceil(units - 1e-9);
  return tidy(Math.min(max, Math.max(0, (base + steps) * step)));
}

export function formatEntry(field: EntryField, value: number | null): string {
  if (value == null) return '0';
  return field === 'reps' ? String(Math.round(value)) : trimZeros(value.toFixed(2));
}
