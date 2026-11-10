/**
 * The coach's two food lookups, answered from the food diary on the server.
 *
 * Training is read from SQLite on the phone; food lives on the account, so
 * these are requests and can fail for reasons a database read cannot: no
 * session, no connection. Each failure comes back as a sentence the model can
 * pass on ("not signed in"), never as a throw, for the reason at the top of
 * `tools.ts`.
 *
 * Every figure carries its unit and every day its date, the same rule the
 * training document follows. Averages are per logged day with an unfinished
 * today left out, exactly as the statistics screen counts them, so the coach
 * and the screen never disagree about what "your average" is.
 */

import {
  bucketDays,
  formatCalories,
  groupByMeal,
  itemTotals,
  MEAL_LABELS,
  MEALS,
  shiftIsoDate,
  type NutrientValues,
  type NutritionStats,
} from '@lift/shared';

import { nutritionApi } from '@/features/nutrition/api';
import { todayIso } from '@/features/nutrition/dates';
import { SyncHttpError } from '@/features/sync/auth-client';

/** Past this many days the day-by-day list becomes weekly, so a year fits in one answer. */
const DAILY_LIST_MAX = 62;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function foodSummary(input: Record<string, unknown>): Promise<[string, boolean?]> {
  const days = clampInt(input.days, 1, 365) ?? 7;
  const today = todayIso();
  const from = shiftIsoDate(today, -(days - 1));

  let stats: NutritionStats;
  try {
    stats = await nutritionApi.stats({ from, to: today, today });
  } catch (error) {
    return [unreachable(error), true];
  }

  const lines = [`Food diary, ${from} to ${today} (${days} ${days === 1 ? 'day' : 'days'}). Today is ${today}${stats.daily.some((day) => day.inProgress) ? ' and still being eaten, so its figures are a part day' : ''}.`];
  lines.push(describeGoals(stats.goals));

  if (stats.daysLogged === 0) {
    lines.push('Nothing was logged in this window. That means the diary was not kept, not that they ate nothing.');
    return [lines.join('\n')];
  }

  const avg = stats.averages;
  lines.push(
    `Logged ${stats.daysLogged} of ${stats.days} days. Averages per logged day${stats.daysCounted < stats.daysLogged ? ` (${stats.daysCounted} complete days, today left out)` : ''}: ${macros(avg)}.`,
  );
  if (stats.adherence) {
    lines.push(
      `Against the calorie goal (within 10% either way): ${stats.adherence.on} on target, ${stats.adherence.under} under, ${stats.adherence.over} over.`,
    );
  }
  if (stats.macroSplit) {
    const pct = (value: number) => `${Math.round(value * 100)}%`;
    lines.push(`Calories from protein ${pct(stats.macroSplit.protein)}, carbs ${pct(stats.macroSplit.carbs)}, fat ${pct(stats.macroSplit.fat)}.`);
  }
  const meals = stats.meals.filter((meal) => meal.average > 0);
  if (meals.length > 0) {
    lines.push(
      `Meals, kcal per logged day: ${meals.map((meal) => `${MEAL_LABELS[meal.meal].toLowerCase()} ${formatCalories(meal.average)} (${Math.round(meal.share * 100)}%)`).join(', ')}.`,
    );
  }
  lines.push(`Logging streak: ${stats.streak.current} days in a row up to today.`);
  if (stats.previous) {
    lines.push(
      `The ${days} days before: ${stats.previous.daysLogged} logged, averaging ${formatCalories(stats.previous.averages.calories)} kcal and ${Math.round(stats.previous.averages.protein)} g protein.`,
    );
  }

  if (days <= DAILY_LIST_MAX) {
    lines.push('', 'Day by day (unlisted days were not logged):');
    for (const day of stats.daily) {
      const verdict = day.verdict ? `, ${day.verdict === 'on' ? 'on target' : `${day.verdict} the goal`}` : '';
      lines.push(
        `- ${day.date} ${weekday(day.date)}: ${formatCalories(day.calories)} kcal, protein ${Math.round(day.protein)} g, carbs ${Math.round(day.carbs)} g, fat ${Math.round(day.fat)} g, ${day.entryCount} foods${verdict}${day.inProgress ? ' (so far today)' : ''}`,
      );
    }
  } else {
    lines.push('', 'By week, per logged day:');
    for (const bucket of bucketDays(stats.daily, stats.from, stats.to, 'week')) {
      lines.push(
        bucket.daysLogged === 0
          ? `- ${bucket.start} to ${bucket.end}: nothing logged`
          : `- ${bucket.start} to ${bucket.end}: ${formatCalories(bucket.calories)} kcal, protein ${Math.round(bucket.protein)} g, ${bucket.daysLogged} days logged`,
      );
    }
  }

  if (stats.topFoods.length > 0) {
    lines.push(
      '',
      `Most logged: ${stats.topFoods
        .slice(0, 8)
        .map((food) => `${food.name} (${food.entries}x on ${food.days} days, ${formatCalories(food.calories / food.entries)} kcal and ${Math.round(food.protein / food.entries)} g protein each)`)
        .join('; ')}.`,
    );
  }
  if (stats.topCalorieSources.length > 0) {
    lines.push(
      `Biggest calorie sources: ${stats.topCalorieSources
        .slice(0, 6)
        .map((food) => `${food.name} (${formatCalories(food.calories)} kcal in total)`)
        .join('; ')}.`,
    );
  }

  return [lines.join('\n')];
}

export async function foodDay(input: Record<string, unknown>): Promise<[string, boolean?]> {
  const today = todayIso();
  const raw = typeof input.date === 'string' ? input.date.trim() : '';
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return [`"${raw}" is not a date. Give it as YYYY-MM-DD.`, true];
  const date = raw || today;
  if (date > today) return [`${date} is in the future; nothing can be logged there yet. Today is ${today}.`, true];

  let day;
  let stats: NutritionStats;
  try {
    [day, stats] = await Promise.all([nutritionApi.day(date), nutritionApi.stats({ from: date, to: date, today })]);
  } catch (error) {
    return [unreachable(error), true];
  }

  const lines = [`Food diary for ${date} ${weekday(date)}${date === today ? ' (today, still in progress)' : ''}.`, describeGoals(stats.goals)];
  if (day.entries.length === 0) {
    lines.push('Nothing was logged on this day.');
    return [lines.join('\n')];
  }

  const totals: NutrientValues = {};
  for (const entry of day.entries) {
    for (const [key, value] of Object.entries(itemTotals(entry))) totals[key] = (totals[key] ?? 0) + value;
  }
  lines.push(`Day total: ${macros(totals)}${totals.fiber !== undefined ? `, fiber ${Math.round(totals.fiber)} g` : ''}.`);

  const byMeal = groupByMeal(day.entries);
  for (const meal of MEALS) {
    const list = byMeal[meal];
    if (list.length === 0) continue;
    lines.push('', `${MEAL_LABELS[meal]}:`);
    for (const entry of list) {
      const item = itemTotals(entry);
      lines.push(
        `- ${entry.time ? `${entry.time} ` : ''}${entry.name}${entry.brand ? ` (${entry.brand})` : ''}, ${round2(entry.quantity)} x ${entry.servingLabel}${entry.servingGrams ? ` (${Math.round(entry.servingGrams * entry.quantity)} g)` : ''}: ${formatCalories(item.calories)} kcal, protein ${round1(item.protein)} g, carbs ${round1(item.carbs)} g, fat ${round1(item.fat)} g`,
      );
    }
  }
  return [lines.join('\n')];
}

function describeGoals(goals: NutrientValues): string {
  const parts = [
    goals.calories ? `${formatCalories(goals.calories)} kcal` : null,
    goals.protein ? `protein ${Math.round(goals.protein)} g` : null,
    goals.carbs ? `carbs ${Math.round(goals.carbs)} g` : null,
    goals.fat ? `fat ${Math.round(goals.fat)} g` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `Daily goals: ${parts.join(', ')}.` : 'No daily goals are set.';
}

function macros(values: NutrientValues): string {
  return `${formatCalories(values.calories)} kcal, protein ${Math.round(values.protein ?? 0)} g, carbs ${Math.round(values.carbs ?? 0)} g, fat ${Math.round(values.fat ?? 0)} g`;
}

function unreachable(error: unknown): string {
  if (error instanceof SyncHttpError && error.isAuthError) {
    return 'The client is not signed in, so their food diary cannot be read. Tell them to sign in from Profile to use food tracking.';
  }
  return `The food diary could not be read (${error instanceof Error ? error.message : 'no reason given'}). It needs a connection.`;
}

function weekday(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()]!;
}

function clampInt(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function round1(value: number | undefined): number {
  return Math.round((value ?? 0) * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
