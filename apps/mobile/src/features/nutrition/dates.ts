/**
 * Diary dates: local calendar days as `YYYY-MM-DD`.
 *
 * The server never decides what "today" is. A meal eaten at 11 pm belongs to
 * the day it was eaten on the phone's clock, so the date string is made here
 * from local fields and sent as is. Built from `getFullYear`/`getMonth`/
 * `getDate` rather than `toISOString`, which is UTC and would file an evening
 * meal in India under the previous day.
 */

import { addDays, format, isSameYear, parseISO } from 'date-fns';

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function shiftIso(iso: string, days: number): string {
  return toIsoDate(addDays(parseISO(iso), days));
}

/** "Today", "Yesterday", "Tomorrow", else "Mon, 3 Nov" (with the year when it is not this one). */
export function describeDay(iso: string, today = todayIso()): string {
  if (iso === today) return 'Today';
  if (iso === shiftIso(today, -1)) return 'Yesterday';
  if (iso === shiftIso(today, 1)) return 'Tomorrow';
  const date = parseISO(iso);
  return format(date, isSameYear(date, new Date()) ? 'EEE, d MMM' : 'EEE, d MMM yyyy');
}

/** The same, for the middle of a sentence: "Copy to tomorrow", not "Copy to Tomorrow". */
export function describeDayInline(iso: string, today = todayIso()): string {
  const label = describeDay(iso, today);
  return ['Today', 'Yesterday', 'Tomorrow'].includes(label) ? label.toLowerCase() : label;
}

/** The seven days ending on `iso`, oldest first. */
export function weekEnding(iso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftIso(iso, i - 6));
}
