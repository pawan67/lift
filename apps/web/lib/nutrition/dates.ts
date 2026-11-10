/**
 * Diary dates: local calendar days as `YYYY-MM-DD`.
 *
 * The server never decides what "today" is. A meal eaten at 11 pm belongs to
 * the day it was eaten on this computer's clock, so the date string is made
 * here from local fields and sent as is. Built from `getFullYear`/`getMonth`/
 * `getDate` rather than `toISOString`, which is UTC and would file an evening
 * meal in India under the previous day. Same rules as the phone app.
 */

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Local midnight of an ISO date. `new Date("2026-11-10")` would be UTC midnight. */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function shiftIso(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** "Today", "Yesterday", "Tomorrow", else "Mon, 3 Nov" (with the year when it is not this one). */
export function describeDay(iso: string, today = todayIso()): string {
  if (iso === today) return "Today";
  if (iso === shiftIso(today, -1)) return "Yesterday";
  if (iso === shiftIso(today, 1)) return "Tomorrow";
  const date = parseIsoDate(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** The same, for the middle of a sentence: "Copy to tomorrow", not "Copy to Tomorrow". */
export function describeDayInline(iso: string, today = todayIso()): string {
  const label = describeDay(iso, today);
  return ["Today", "Yesterday", "Tomorrow"].includes(label) ? label.toLowerCase() : label;
}

/** "Tuesday, 10 November". */
export function longDate(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** The seven days ending on `iso`, oldest first. */
export function weekEnding(iso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftIso(iso, i - 6));
}
