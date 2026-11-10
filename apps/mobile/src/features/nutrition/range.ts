/**
 * The window the food statistics are read through.
 *
 * Food has its own ranges rather than the workout `StatRange`, because a diary
 * is read a day at a time as often as a month at a time: "how did today go"
 * is the commonest question, and the workout ranges start at a week. A range
 * is always a pair of dates, both included; the preset only names it, so
 * stepping a week back from "Last 7 days" is just another seven days.
 */

import { isoDaysBetween, NUTRITION_STATS_MAX_DAYS, shiftIsoDate } from '@lift/shared';
import { format, parseISO } from 'date-fns';

export type FoodRangePreset = 'today' | 'yesterday' | '7d' | '30d' | '3m' | '1y' | 'custom';

export interface FoodRange {
  preset: FoodRangePreset;
  from: string;
  to: string;
}

export const FOOD_RANGE_PRESETS: readonly { value: Exclude<FoodRangePreset, 'custom'>; label: string; days: number }[] = [
  { value: 'today', label: 'Today', days: 1 },
  { value: 'yesterday', label: 'Yesterday', days: 1 },
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '3m', label: '3 months', days: 91 },
  { value: '1y', label: '1 year', days: 365 },
];

/** The longest range a custom pick may span: what the server reads in one request. */
export const MAX_RANGE_DAYS = Math.min(366, NUTRITION_STATS_MAX_DAYS);

export function presetRange(preset: Exclude<FoodRangePreset, 'custom'>, today: string): FoodRange {
  if (preset === 'yesterday') {
    const day = shiftIsoDate(today, -1);
    return { preset, from: day, to: day };
  }
  const days = FOOD_RANGE_PRESETS.find((option) => option.value === preset)!.days;
  return { preset, from: shiftIsoDate(today, -(days - 1)), to: today };
}

/** Days in the range, both ends included. */
export function rangeLength(range: Pick<FoodRange, 'from' | 'to'>): number {
  return isoDaysBetween(range.from, range.to) + 1;
}

/** What a pair of dates is called, when it is one of the presets. */
export function nameRange(from: string, to: string, today: string): FoodRange {
  const yesterday = shiftIsoDate(today, -1);
  if (from === to && to === today) return { preset: 'today', from, to };
  if (from === to && to === yesterday) return { preset: 'yesterday', from, to };
  if (to === today) {
    const days = isoDaysBetween(from, to) + 1;
    const match = FOOD_RANGE_PRESETS.find((option) => option.days === days && option.value !== 'today');
    if (match) return { preset: match.value, from, to };
  }
  return { preset: 'custom', from, to };
}

/**
 * The same length of time, one window earlier or later. Never past today:
 * stepping forward from a window that would run into tomorrow stops at today.
 */
export function stepRange(range: FoodRange, direction: -1 | 1, today: string): FoodRange {
  const length = rangeLength(range);
  let to = shiftIsoDate(range.to, direction * length);
  if (to > today) to = today;
  const from = shiftIsoDate(to, -(length - 1));
  return nameRange(from, to, today);
}

/** "Today", "Tue 4 Nov", "4 Nov to 10 Nov", "28 Dec 2025 to 3 Jan 2026". */
export function describeRange(range: FoodRange, today: string): string {
  const from = parseISO(range.from);
  const to = parseISO(range.to);
  const thisYear = parseISO(today).getFullYear();
  if (range.from === range.to) {
    if (range.to === today) return 'Today';
    if (range.to === shiftIsoDate(today, -1)) return 'Yesterday';
    return format(to, to.getFullYear() === thisYear ? 'EEE d MMM' : 'EEE d MMM yyyy');
  }
  const sameYear = from.getFullYear() === to.getFullYear() && to.getFullYear() === thisYear;
  const shape = sameYear ? 'd MMM' : 'd MMM yyyy';
  return `${format(from, shape)} to ${format(to, shape)}`;
}
