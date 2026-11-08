/**
 * Date windows and buckets for the statistics screens.
 *
 * Copied from the phone (`apps/mobile/src/features/analytics/windows.ts`), which
 * has no database or React Native dependency, so both apps cut weeks and months
 * the same way. Keep the two in step.
 */

/**
 * Date windows and time bucketing, shared by every analytics screen.
 *
 * All of it is pure and calendar-local: a "day" is the user's midnight-to-
 * midnight, not UTC's, because a 9pm session on the 20th belongs to the 20th
 * however many hours west of Greenwich the phone is.
 *
 * This lives apart from `repository.ts` because the statistics screens bucket
 * the same way the history tab does, and two copies of month-arithmetic is two
 * places for the quarter boundary to drift.
 */

/**
 * Bucket size for a trend chart.
 *
 * Chosen from the *span* rather than the range name so "all time" stays legible
 * whether the user has three months of history or six years: at ~50 buckets the
 * bars are a pixel wide and the axis is unreadable, so the granularity coarsens
 * before that point.
 */
export type Granularity = 'week' | 'month' | 'quarter' | 'year';

/** 0 = Sunday, 1 = Monday. Mirrors the `firstDayOfWeek` preference. */
export type WeekStart = 0 | 1;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Local midnight of the day containing `date`. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * First day of the week containing `date`.
 *
 * Defaults to Monday, which is what every caller predating the statistics
 * screens assumed. The week-navigating screens pass the user's preference.
 */
export function startOfWeek(date: Date, firstDayOfWeek: WeekStart = 1): Date {
  const result = startOfDay(date);
  const offset = (result.getDay() - firstDayOfWeek + 7) % 7;
  result.setDate(result.getDate() - offset);
  return result;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Adds `months` to a month start, staying on the first of the month. */
export function addMonths(monthStart: Date, months: number): Date {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + months, 1);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function bucketStart(
  date: Date,
  granularity: Granularity,
  firstDayOfWeek: WeekStart = 1,
): Date {
  switch (granularity) {
    case 'week':
      return startOfWeek(date, firstDayOfWeek);
    case 'month':
      return startOfMonth(date);
    case 'quarter':
      return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
    case 'year':
      return new Date(date.getFullYear(), 0, 1);
  }
}

export function advance(date: Date, granularity: Granularity, steps = 1): Date {
  const next = new Date(date);
  switch (granularity) {
    case 'week':
      next.setDate(next.getDate() + 7 * steps);
      break;
    case 'month':
      next.setMonth(next.getMonth() + steps);
      break;
    case 'quarter':
      next.setMonth(next.getMonth() + 3 * steps);
      break;
    case 'year':
      next.setFullYear(next.getFullYear() + steps);
      break;
  }
  return next;
}

/**
 * The seven days a week covers, on one line: "17 Aug – 23 Aug".
 *
 * Both ends name their month even when it is the same month twice, which reads
 * a word longer than it needs to in English and is the only form that survives
 * translation. The locale decides whether a date is "17 Aug" or "Aug 17", so
 * dropping the first month (the obvious saving) yields "17 – Aug 23" wherever
 * the month leads, which is not a range anyone can read.
 *
 * The year appears only on a week that crosses one, and then on both ends:
 * "29 Dec 2025 – 4 Jan 2026". Inside a single year it is the one thing a reader
 * already knows.
 */
export function formatWeekRange(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  const crossesYear = weekStart.getFullYear() !== weekEnd.getFullYear();

  const shape: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    ...(crossesYear && { year: 'numeric' }),
  };

  return `${weekStart.toLocaleDateString(undefined, shape)} – ${weekEnd.toLocaleDateString(
    undefined,
    shape,
  )}`;
}

export function bucketLabel(date: Date, granularity: Granularity): string {
  switch (granularity) {
    case 'week':
      return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    case 'month':
      return date.toLocaleDateString(undefined, { month: 'short' });
    case 'quarter':
      return `Q${Math.floor(date.getMonth() / 3) + 1} ${String(date.getFullYear()).slice(2)}`;
    case 'year':
      return String(date.getFullYear());
  }
}

/** Months between two dates, used to pick a granularity for "all time". */
export function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

// ---------------------------------------------------------------------------
// Trailing windows
// ---------------------------------------------------------------------------

/**
 * The ranges the statistics screens offer.
 *
 * Written out rather than derived from a day count because "Last year" is not
 * "last 365 days" to anyone reading it, and the label is what the range picker
 * prints.
 */
export const STAT_RANGES = [
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '3m', label: 'Last 3 months', days: 91 },
  { value: '1y', label: 'Last year', days: 365 },
  { value: 'all', label: 'All time', days: null },
] as const;

export type StatRange = (typeof STAT_RANGES)[number]['value'];

export const STAT_RANGE_LABELS: Record<StatRange, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '3m': 'Last 3 months',
  '1y': 'Last year',
  all: 'All time',
};

export interface StatWindow {
  range: StatRange;
  /** Inclusive start at local midnight. Null on "all time". */
  from: Date | null;
  /** Exclusive end. The start of tomorrow, so today's session counts. */
  to: Date;
  /**
   * The equally-long window immediately before this one, for the current-vs-
   * previous comparisons. Null on "all time", which has nothing before it.
   */
  previous: { from: Date; to: Date } | null;
  /** Calendar days the window spans. Null on "all time". */
  days: number | null;
  label: string;
}

/**
 * A trailing window ending at the end of today.
 *
 * The end is *tomorrow's* midnight rather than `now`, so a workout logged an
 * hour from now still lands inside the window the user is looking at: a
 * boundary at the current instant makes the last row of a list appear to be
 * missing from the totals above it.
 */
export function statWindow(range: StatRange, now: Date = new Date()): StatWindow {
  const to = addDays(startOfDay(now), 1);
  const days = STAT_RANGES.find((option) => option.value === range)?.days ?? null;

  if (days === null) {
    return { range, from: null, to, previous: null, days: null, label: STAT_RANGE_LABELS[range] };
  }

  const from = addDays(to, -days);
  return {
    range,
    from,
    to,
    previous: { from: addDays(from, -days), to: from },
    days,
    label: STAT_RANGE_LABELS[range],
  };
}

/**
 * Weeks a window spans, floored at 1: the divisor behind every "sets per week"
 * figure.
 *
 * `earliest` is only consulted on "all time", where the window is however long
 * the log actually is rather than however long ago the first workout could have
 * been. A user three weeks into the app should not have their volume averaged
 * over the years the table happens to have no rows for.
 */
export function windowWeeks(window: StatWindow, earliest: number | null): number {
  const from = window.from?.getTime() ?? earliest ?? window.to.getTime();
  return Math.max(1, (window.to.getTime() - from) / MS_PER_WEEK);
}

/** Every local midnight from `from` (inclusive) to `to` (exclusive). */
export function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let cursor = startOfDay(from); cursor < to; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

/**
 * The granularity a span of `months` should be bucketed at.
 *
 * Shared by the history tab and the muscle-set trend so a year of training is
 * drawn the same way on both.
 */
export function granularityForMonths(months: number): Granularity {
  return months <= 18 ? 'month' : months <= 72 ? 'quarter' : 'year';
}

/**
 * The bucket sequence covering a window, oldest first.
 *
 * Buckets with no workouts are included with whatever the caller seeds them
 * with rather than skipped. A gap in training should read as a dip in the
 * chart, not get quietly compressed away.
 */
export function bucketsFor(
  window: StatWindow,
  granularity: Granularity,
  earliest: Date | null,
  firstDayOfWeek: WeekStart = 1,
): { start: number; label: string }[] {
  const first = window.from ?? earliest ?? window.to;
  const cursorStart = bucketStart(first, granularity, firstDayOfWeek);
  const lastStart = bucketStart(addDays(window.to, -1), granularity, firstDayOfWeek);

  const out: { start: number; label: string }[] = [];
  for (
    let cursor = cursorStart;
    cursor.getTime() <= lastStart.getTime();
    cursor = advance(cursor, granularity)
  ) {
    out.push({ start: cursor.getTime(), label: bucketLabel(cursor, granularity) });
  }
  return out;
}
