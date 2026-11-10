/**
 * Food statistics: what a range of the diary adds up to.
 *
 * The workout statistics are worked out on the phone from SQLite. Food lives on
 * the server, so here the server loads the range's entries and hands them to
 * `buildNutritionStats`, and both apps draw the result. The arithmetic is pure
 * and lives in this package so it can be tested without a database, and so the
 * phone and the web app cannot disagree about what "on target" means.
 *
 * Two rules shape every figure below:
 *
 * - **Averages are per logged day, not per calendar day.** A day with nothing
 *   in the diary is a day that was not tracked, not a day of fasting, and
 *   counting it as zero would report a month of forgetting as a month of
 *   undereating.
 * - **Today is in progress.** The range normally ends on today, and at noon
 *   today is half a day. It is drawn on the charts and counts towards days
 *   logged and the streak, but it is left out of averages, adherence and the
 *   meal split, which would otherwise sag every morning. The exception is a
 *   range where today is the only logged day: a new diary should show
 *   something rather than an empty dashboard.
 *
 * Dates are `YYYY-MM-DD` strings throughout, the user's own calendar days,
 * and the arithmetic on them is done in UTC day numbers so no time zone can
 * move a day.
 */

import { z } from 'zod';

import { macroEnergySplit, totalsOf } from './math.ts';
import type { NutrientValues } from './nutrients.ts';
import { MEALS, isoDate, type DaySummary, type FoodEntry, type Meal } from './types.ts';

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/** The widest range the statistics screens offer is a year; a little slack covers leap years and rounding. */
export const NUTRITION_STATS_MAX_DAYS = 400;

/**
 * `GET /api/nutrition/stats?from&to&today`. `today` is the client's own date,
 * because the server cannot know which day is still being eaten in the user's
 * zone. Optional: without it no day is treated as in progress.
 */
export const nutritionStatsQuerySchema = z
  .object({ from: isoDate, to: isoDate, today: isoDate.optional() })
  .refine(({ from, to }) => from <= to, 'from must not be after to.')
  .refine(({ from, to }) => isoDaysBetween(from, to) <= NUTRITION_STATS_MAX_DAYS, 'A range of at most a year.');
export type NutritionStatsQuery = z.input<typeof nutritionStatsQuerySchema>;

/**
 * Within this share of the calorie goal, either way, a day counts as on target.
 * Ten percent is about one snack on a typical goal: tighter and almost no real
 * day qualifies, looser and the figure stops meaning anything.
 */
export const ON_TARGET_TOLERANCE = 0.1;

export type CalorieVerdict = 'under' | 'on' | 'over';

export interface StatsDay extends DaySummary {
  /** Against the calorie goal. Null with no goal, and on an in-progress day that is not already over. */
  verdict: CalorieVerdict | null;
  /** The day the client called today: still being eaten. */
  inProgress: boolean;
}

export interface MealShare {
  meal: Meal;
  /** Calories from this meal per counted day. */
  average: number;
  /** Fraction of the counted days' calories, 0 to 1. */
  share: number;
  entries: number;
}

/** One food across the range, grouped by name and brand whatever serving it was logged at. */
export interface FoodTally {
  name: string;
  brand: string | null;
  entries: number;
  /** Distinct days it was eaten on. */
  days: number;
  calories: number;
  protein: number;
}

export type MacroSplit = { protein: number; carbs: number; fat: number };

export interface NutritionStats {
  from: string;
  to: string;
  /** Calendar days in the range. */
  days: number;
  daysLogged: number;
  /** The days averages are taken over. See the note at the top of this file. */
  daysCounted: number;
  /** One per logged day, oldest first. Days with nothing are omitted. */
  daily: StatsDay[];
  /** Every nutrient seen, per counted day. A nutrient no food listed is absent, not zero. */
  averages: NutrientValues;
  /** The user's daily targets, so a client needs nothing else to draw the page. */
  goals: NutrientValues;
  /** Counted days against the calorie goal. Null when there is no goal. */
  adherence: Record<CalorieVerdict, number> | null;
  /** Share of calories from each macro in the averages. */
  macroSplit: MacroSplit | null;
  /** The same split implied by the macro goals, when all three are set. */
  goalSplit: MacroSplit | null;
  meals: MealShare[];
  /** Most entries first. */
  topFoods: FoodTally[];
  /** Most calories first. */
  topCalorieSources: FoodTally[];
  streak: {
    /** Consecutive logged days up to today. Today not logged yet does not break it. May start before `from`. */
    current: number;
    /** The longest run inside the range. */
    longest: number;
  };
  /** The equally long range just before this one, for the comparisons. Null when nothing was logged in it. */
  previous: { daysLogged: number; averages: { calories: number; protein: number; carbs: number; fat: number } } | null;
}

// ---------------------------------------------------------------------------
// Calendar days
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

function dayNumber(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year!, month! - 1, day!) / MS_PER_DAY;
}

function fromDayNumber(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** `iso` moved by whole days. */
export function shiftIsoDate(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days);
}

/** Days from `from` to `to`: 0 for the same day. */
export function isoDaysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** Every date from `from` to `to`, both included. */
export function eachIsoDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = dayNumber(from), end = dayNumber(to); day <= end; day += 1) out.push(fromDayNumber(day));
  return out;
}

/** The range of the same length that ends the day before `from`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const length = isoDaysBetween(from, to) + 1;
  return { from: shiftIsoDate(from, -length), to: shiftIsoDate(from, -1) };
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

export type StatsEntry = Pick<FoodEntry, 'date' | 'meal' | 'name' | 'brand' | 'quantity' | 'nutrients'>;

export interface NutritionStatsInput {
  from: string;
  to: string;
  today?: string | null;
  /** Every entry dated inside the range. */
  entries: readonly StatsEntry[];
  targets: NutrientValues;
  /**
   * Dates with at least one entry, up to `to`, in any order. Reaches back past
   * `from` so the current streak is not cut off at the edge of a short range.
   */
  loggedDates: readonly string[];
  /** Per-day totals for `previousRange(from, to)`. */
  previous?: readonly DaySummary[] | null;
}

/** How many foods each ranking keeps. */
const TOP_FOODS = 10;

export function calorieVerdict(calories: number, goal: number | undefined): CalorieVerdict | null {
  if (!goal || goal <= 0) return null;
  if (calories < goal * (1 - ON_TARGET_TOLERANCE)) return 'under';
  if (calories > goal * (1 + ON_TARGET_TOLERANCE)) return 'over';
  return 'on';
}

export function buildNutritionStats(input: NutritionStatsInput): NutritionStats {
  const { from, to, targets } = input;
  const today = input.today ?? null;
  const entries = input.entries.filter((entry) => entry.date >= from && entry.date <= to);

  const byDate = new Map<string, StatsEntry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.date);
    if (list) list.push(entry);
    else byDate.set(entry.date, [entry]);
  }
  const dates = [...byDate.keys()].sort();

  const dayTotals = new Map<string, NutrientValues>();
  for (const date of dates) dayTotals.set(date, totalsOf(byDate.get(date)!));

  const daily: StatsDay[] = dates.map((date) => {
    const totals = dayTotals.get(date)!;
    const calories = totals.calories ?? 0;
    const inProgress = date === today;
    const verdict = calorieVerdict(calories, targets.calories);
    return {
      date,
      calories,
      protein: totals.protein ?? 0,
      carbs: totals.carbs ?? 0,
      fat: totals.fat ?? 0,
      entryCount: byDate.get(date)!.length,
      // Half a day is "under" by definition, which says nothing. Over is
      // already decided, so it is worth showing.
      verdict: inProgress && verdict !== 'over' ? null : verdict,
      inProgress,
    };
  });

  const complete = dates.filter((date) => date !== today);
  const counted = complete.length > 0 ? complete : dates;
  const countedSet = new Set(counted);

  // Averages over counted days.
  const averages: NutrientValues = {};
  for (const date of counted) {
    for (const [key, value] of Object.entries(dayTotals.get(date)!)) averages[key] = (averages[key] ?? 0) + value;
  }
  for (const key of Object.keys(averages)) averages[key] = averages[key]! / counted.length;

  // Adherence over counted days.
  let adherence: Record<CalorieVerdict, number> | null = null;
  if (targets.calories && targets.calories > 0) {
    adherence = { under: 0, on: 0, over: 0 };
    for (const date of counted) adherence[calorieVerdict(dayTotals.get(date)!.calories ?? 0, targets.calories)!] += 1;
  }

  // Meal split over counted days.
  const mealCalories = Object.fromEntries(MEALS.map((meal) => [meal, 0])) as Record<Meal, number>;
  const mealEntries = Object.fromEntries(MEALS.map((meal) => [meal, 0])) as Record<Meal, number>;
  for (const entry of entries) {
    if (!countedSet.has(entry.date)) continue;
    mealCalories[entry.meal] += (entry.nutrients.calories ?? 0) * entry.quantity;
    mealEntries[entry.meal] += 1;
  }
  const mealTotal = MEALS.reduce((sum, meal) => sum + mealCalories[meal], 0);
  const meals: MealShare[] = MEALS.map((meal) => ({
    meal,
    average: counted.length ? mealCalories[meal] / counted.length : 0,
    share: mealTotal > 0 ? mealCalories[meal] / mealTotal : 0,
    entries: mealEntries[meal],
  }));

  // Foods, over every entry in the range: what was eaten today is still eaten.
  const tallies = new Map<string, FoodTally & { dates: Set<string> }>();
  for (const entry of entries) {
    const key = `${entry.name.trim().toLowerCase()}\u0000${(entry.brand ?? '').trim().toLowerCase()}`;
    let tally = tallies.get(key);
    if (!tally) {
      tally = { name: entry.name.trim(), brand: entry.brand, entries: 0, days: 0, calories: 0, protein: 0, dates: new Set() };
      tallies.set(key, tally);
    }
    tally.entries += 1;
    tally.dates.add(entry.date);
    tally.calories += (entry.nutrients.calories ?? 0) * entry.quantity;
    tally.protein += (entry.nutrients.protein ?? 0) * entry.quantity;
  }
  const foods: FoodTally[] = [...tallies.values()].map(({ dates: seen, ...tally }) => ({ ...tally, days: seen.size }));
  const byName = (a: FoodTally, b: FoodTally) => a.name.localeCompare(b.name);
  const topFoods = [...foods]
    .sort((a, b) => b.entries - a.entries || b.days - a.days || b.calories - a.calories || byName(a, b))
    .slice(0, TOP_FOODS);
  const topCalorieSources = [...foods]
    .filter((food) => food.calories > 0)
    .sort((a, b) => b.calories - a.calories || byName(a, b))
    .slice(0, TOP_FOODS);

  const previousDays = (input.previous ?? []).filter((day) => day.entryCount > 0);
  const previous =
    previousDays.length === 0
      ? null
      : {
          daysLogged: previousDays.length,
          averages: {
            calories: mean(previousDays.map((day) => day.calories)),
            protein: mean(previousDays.map((day) => day.protein)),
            carbs: mean(previousDays.map((day) => day.carbs)),
            fat: mean(previousDays.map((day) => day.fat)),
          },
        };

  const goalSplit =
    targets.protein && targets.carbs && targets.fat
      ? macroEnergySplit({ protein: targets.protein, carbs: targets.carbs, fat: targets.fat })
      : null;

  return {
    from,
    to,
    days: isoDaysBetween(from, to) + 1,
    daysLogged: dates.length,
    daysCounted: counted.length,
    daily,
    averages,
    goals: targets,
    adherence,
    macroSplit: macroEnergySplit(averages),
    goalSplit,
    meals,
    topFoods,
    topCalorieSources,
    streak: streaks(input.loggedDates, dates, today ?? to),
    previous,
  };
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/**
 * The current run ends today, or yesterday when today has nothing yet: at
 * breakfast time an unlogged today is a day not started, not a day missed.
 */
function streaks(loggedDates: readonly string[], inRange: readonly string[], reference: string) {
  const logged = new Set([...loggedDates, ...inRange]);
  let cursor = logged.has(reference) ? reference : shiftIsoDate(reference, -1);
  let current = 0;
  while (logged.has(cursor)) {
    current += 1;
    cursor = shiftIsoDate(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let last: string | null = null;
  for (const date of inRange) {
    run = last !== null && isoDaysBetween(last, date) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    last = date;
  }
  return { current, longest };
}

// ---------------------------------------------------------------------------
// Chart buckets
// ---------------------------------------------------------------------------

export type StatsBucketSize = 'day' | 'week' | 'month';

export interface StatsBucket {
  /** First and last date the bucket covers, inside the range. */
  start: string;
  end: string;
  /** Per logged day in the bucket (a single day's total for `day`). 0 with nothing logged. */
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  daysLogged: number;
  /** The bucket's only logged day is today, so its figure is a part day. */
  inProgress: boolean;
}

/**
 * The bar size a range reads best at: a bar a day up to a month, a bar a week
 * up to a quarter, then months. A year of daily bars is a texture, not a chart.
 */
export function bucketSizeFor(days: number): StatsBucketSize {
  return days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';
}

/**
 * The range cut into buckets, oldest first, with every bucket present even
 * when nothing was logged in it: a gap should read as a gap.
 *
 * Weeks are seven-day blocks counted back from `to`, so the last bar is
 * always the latest full week rather than a stub of whatever weekday it is.
 * Months are calendar months, clipped to the range at either end.
 *
 * A bucket's figure is per logged day, leaving today out when the bucket has
 * other days, for the reason at the top of this file.
 */
export function bucketDays(daily: readonly StatsDay[], from: string, to: string, size: StatsBucketSize): StatsBucket[] {
  const ranges: { start: string; end: string }[] = [];
  if (size === 'day') {
    for (const date of eachIsoDate(from, to)) ranges.push({ start: date, end: date });
  } else if (size === 'week') {
    for (let end = to; end >= from; end = shiftIsoDate(end, -7)) {
      const start = shiftIsoDate(end, -6);
      ranges.unshift({ start: start < from ? from : start, end });
    }
  } else {
    let start = from;
    while (start <= to) {
      const [year, month] = start.split('-').map(Number);
      const monthEnd = fromDayNumber(Date.UTC(year!, month!, 1) / MS_PER_DAY - 1);
      const end = monthEnd > to ? to : monthEnd;
      ranges.push({ start, end });
      start = shiftIsoDate(end, 1);
    }
  }

  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  let index = 0;
  return ranges.map(({ start, end }) => {
    const days: StatsDay[] = [];
    while (index < sorted.length && sorted[index]!.date < start) index += 1;
    while (index < sorted.length && sorted[index]!.date <= end) days.push(sorted[index++]!);
    const complete = days.filter((day) => !day.inProgress);
    const used = complete.length > 0 ? complete : days;
    return {
      start,
      end,
      calories: mean(used.map((day) => day.calories)),
      protein: mean(used.map((day) => day.protein)),
      carbs: mean(used.map((day) => day.carbs)),
      fat: mean(used.map((day) => day.fat)),
      daysLogged: days.length,
      inProgress: days.length > 0 && complete.length === 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export interface WeekdayAverage {
  /** 0 is Sunday, as `Date.getDay` counts. */
  weekday: number;
  /** Per logged day of this weekday. 0 with none. */
  calories: number;
  protein: number;
  days: number;
}

/**
 * Calories by day of the week, over complete days only: the weekend that runs
 * over, the Monday that starts light. Every weekday is present, oldest-first
 * order does not matter, and an in-progress today is left out for the reason
 * at the top of this file.
 */
export function weekdayAverages(daily: readonly StatsDay[]): WeekdayAverage[] {
  const sums = Array.from({ length: 7 }, (_, weekday) => ({ weekday, calories: 0, protein: 0, days: 0 }));
  for (const day of daily) {
    if (day.inProgress) continue;
    const slot = sums[new Date(dayNumber(day.date) * MS_PER_DAY).getUTCDay()]!;
    slot.calories += day.calories;
    slot.protein += day.protein;
    slot.days += 1;
  }
  return sums.map((slot) =>
    slot.days === 0 ? slot : { ...slot, calories: slot.calories / slot.days, protein: slot.protein / slot.days },
  );
}

/** The complete days with the most and the fewest calories. Null with fewer than two. */
export function dayExtremes(daily: readonly StatsDay[]): { highest: StatsDay; lowest: StatsDay } | null {
  const complete = daily.filter((day) => !day.inProgress);
  if (complete.length < 2) return null;
  let highest = complete[0]!;
  let lowest = complete[0]!;
  for (const day of complete) {
    if (day.calories > highest.calories) highest = day;
    if (day.calories < lowest.calories) lowest = day;
  }
  return { highest, lowest };
}
