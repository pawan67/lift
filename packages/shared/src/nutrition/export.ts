/**
 * Food diary exports: the statistics screen's range written out as a file.
 *
 * Four shapes, because they go to four different places. Markdown is for
 * reading, or for pasting into an assistant: a summary on top and the diary
 * day by day under it. "Entries" CSV is one row per food logged, for a
 * spreadsheet that wants to slice the raw diary. "Daily" CSV is one row per
 * day, for charting. JSON is everything, for anything that parses.
 *
 * Pure, like the statistics: the phone and the web app hand in what the API
 * returned and get a string back, so the two cannot disagree about what a
 * column means. Every figure is the portion as eaten (per serving times the
 * quantity), never the per-serving figure, because that is what the diary
 * shows and what a reader of the file would assume.
 *
 * Dates are written without `Intl`, from fixed English names, so the file is
 * the same on every phone whatever its locale and whichever JS engine runs it.
 */

import { itemTotals, totalsOf } from './math.ts';
import { CORE_NUTRIENT_KEYS, nutrientDefinitions, type CustomNutrient, type NutrientValues } from './nutrients.ts';
import type { NutritionStats } from './stats.ts';
import { MEALS, MEAL_LABELS, type FoodEntry } from './types.ts';

export type NutritionExportFormat = 'markdown' | 'csv-entries' | 'csv-daily' | 'json';

export interface NutritionExportOption {
  value: NutritionExportFormat;
  label: string;
  description: string;
  extension: 'md' | 'csv' | 'json';
  mimeType: string;
}

export const NUTRITION_EXPORT_FORMATS: readonly NutritionExportOption[] = [
  {
    value: 'markdown',
    label: 'Markdown report',
    description: 'Summary and every day, readable anywhere. Good for pasting into an AI.',
    extension: 'md',
    mimeType: 'text/markdown',
  },
  {
    value: 'csv-entries',
    label: 'CSV, every food',
    description: 'One row per food logged, with all its nutrients. For spreadsheets.',
    extension: 'csv',
    mimeType: 'text/csv',
  },
  {
    value: 'csv-daily',
    label: 'CSV, daily totals',
    description: 'One row per day: calories, protein, carbs, fat and against the goal.',
    extension: 'csv',
    mimeType: 'text/csv',
  },
  {
    value: 'json',
    label: 'JSON',
    description: 'Everything, structured. For scripts and other apps.',
    extension: 'json',
    mimeType: 'application/json',
  },
];

export interface NutritionExportInput {
  from: string;
  to: string;
  /** Every entry in the range, in any order. */
  entries: readonly FoodEntry[];
  /** The statistics for the same range, for the Markdown summary and the JSON. */
  stats: NutritionStats | null;
  customNutrients?: readonly CustomNutrient[];
  /** When the file was made, for its header. */
  exportedAt?: Date;
}

export function buildNutritionExport(format: NutritionExportFormat, input: NutritionExportInput): string {
  switch (format) {
    case 'markdown':
      return nutritionMarkdown(input);
    case 'csv-entries':
      return nutritionEntriesCsv(input.entries, input.customNutrients ?? []);
    case 'csv-daily':
      return nutritionDailyCsv(input.entries, input.stats?.goals.calories);
    case 'json':
      return nutritionJson(input);
  }
}

/** `lift-food-2026-11-10.md`, or `lift-food-2026-11-04-to-2026-11-10.csv` for a range. */
export function nutritionExportFileName(from: string, to: string, format: NutritionExportFormat): string {
  const option = NUTRITION_EXPORT_FORMATS.find((candidate) => candidate.value === format)!;
  const span = from === to ? from : `${from}-to-${to}`;
  const suffix = format === 'csv-daily' ? '-daily' : '';
  return `lift-food-${span}${suffix}.${option.extension}`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * One CSV cell. Quoted when it must be, and a leading `=`, `+`, `-` or `@` in
 * text is defused with an apostrophe so a spreadsheet does not run a food
 * name as a formula. Numbers are written as numbers and never touched.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sortEntries(entries: readonly FoodEntry[]): FoodEntry[] {
  const mealOrder = (meal: FoodEntry['meal']) => MEALS.indexOf(meal);
  return [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      mealOrder(a.meal) - mealOrder(b.meal) ||
      (a.time ?? '99:99').localeCompare(b.time ?? '99:99') ||
      a.position - b.position ||
      a.createdAt - b.createdAt,
  );
}

/**
 * Every food logged, one per row. The core four come first; past them a
 * column for every other nutrient any entry in the file lists, in the order
 * the app shows them, so a range without vitamins has no empty vitamin columns.
 */
export function nutritionEntriesCsv(entries: readonly FoodEntry[], custom: readonly CustomNutrient[] = []): string {
  const definitions = nutrientDefinitions(custom);
  const seen = new Set<string>();
  for (const entry of entries) for (const key of Object.keys(entry.nutrients)) seen.add(key);
  const extra = definitions.filter(
    (definition) => !(CORE_NUTRIENT_KEYS as readonly string[]).includes(definition.key) && seen.has(definition.key),
  );
  const columns = [...CORE_NUTRIENT_KEYS.map((key) => definitions.find((d) => d.key === key)!), ...extra];

  const header = csvRow([
    'date',
    'time',
    'meal',
    'food',
    'brand',
    'quantity',
    'serving',
    'grams',
    ...columns.map((definition) => `${definition.key}_${definition.unit === 'µg' ? 'ug' : definition.unit}`),
    'source',
  ]);

  const rows = sortEntries(entries).map((entry) => {
    const totals = itemTotals(entry);
    const grams = entry.servingGrams ? round(entry.servingGrams * entry.quantity, 1) : null;
    return csvRow([
      entry.date,
      entry.time ?? null,
      entry.meal,
      entry.name,
      entry.brand,
      round(entry.quantity, 2),
      entry.servingLabel,
      grams,
      ...columns.map((definition) => {
        const value = totals[definition.key];
        return value === undefined ? null : round(value, Math.max(definition.decimals, 1));
      }),
      entry.source,
    ]);
  });

  return [header, ...rows].join('\n') + '\n';
}

/** One row per logged day: the core four, the entry count and, with a goal, the verdict. */
export function nutritionDailyCsv(entries: readonly FoodEntry[], calorieGoal?: number): string {
  const header = csvRow(['date', 'calories_kcal', 'protein_g', 'carbs_g', 'fat_g', 'entries', ...(calorieGoal ? ['goal_kcal', 'vs_goal'] : [])]);
  const rows = groupByDate(entries).map(([date, list]) => {
    const totals = totalsOf(list);
    const calories = totals.calories ?? 0;
    return csvRow([
      date,
      round(calories, 0),
      round(totals.protein ?? 0, 1),
      round(totals.carbs ?? 0, 1),
      round(totals.fat ?? 0, 1),
      list.length,
      ...(calorieGoal ? [calorieGoal, verdictWord(calories, calorieGoal)] : []),
    ]);
  });
  return [header, ...rows].join('\n') + '\n';
}

function groupByDate(entries: readonly FoodEntry[]): [string, FoodEntry[]][] {
  const byDate = new Map<string, FoodEntry[]>();
  for (const entry of sortEntries(entries)) {
    const list = byDate.get(entry.date);
    if (list) list.push(entry);
    else byDate.set(entry.date, [entry]);
  }
  return [...byDate.entries()];
}

function verdictWord(calories: number, goal: number): 'under' | 'on target' | 'over' {
  if (calories < goal * 0.9) return 'under';
  if (calories > goal * 1.1) return 'over';
  return 'on target';
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 10 Nov 2026", from a `YYYY-MM-DD` with no time zone involved. */
export function describeIsoDate(iso: string, withWeekday = true): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  const text = `${day} ${MONTHS[month! - 1]} ${year}`;
  return withWeekday ? `${WEEKDAYS[date.getUTCDay()]} ${text}` : text;
}

function kcal(value: number | undefined): string {
  return `${Math.round(value ?? 0).toLocaleString('en-US')} kcal`;
}

function grams(value: number | undefined): string {
  return `${Math.round(value ?? 0)} g`;
}

/** A Markdown table cell: no pipes or line breaks to break the row. */
function mdCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

function nutritionMarkdown(input: NutritionExportInput): string {
  const { from, to, entries, stats } = input;
  const goals: NutrientValues = stats?.goals ?? {};
  const title = from === to ? describeIsoDate(from) : `${describeIsoDate(from, false)} to ${describeIsoDate(to, false)}`;
  const lines: string[] = [`# Food log: ${title}`, ''];
  if (input.exportedAt) {
    const at = input.exportedAt;
    const pad = (n: number) => String(n).padStart(2, '0');
    lines.push(`Exported from Lift on ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}.`, '');
  }

  const days = groupByDate(entries);
  if (days.length === 0) {
    lines.push('Nothing was logged in this range.');
    return lines.join('\n') + '\n';
  }

  if (stats) {
    lines.push('## Summary', '');
    lines.push('| | Daily average | Goal |', '|---|---|---|');
    for (const key of CORE_NUTRIENT_KEYS) {
      const label = key === 'calories' ? 'Calories' : key[0]!.toUpperCase() + key.slice(1);
      const format = key === 'calories' ? kcal : grams;
      lines.push(`| ${label} | ${format(stats.averages[key])} | ${goals[key] ? format(goals[key]) : 'not set'} |`);
    }
    lines.push('');
    const facts = [`Days logged: ${stats.daysLogged} of ${stats.days}.`];
    if (stats.adherence) {
      facts.push(
        `Against the calorie goal (within 10%): ${stats.adherence.on} on target, ${stats.adherence.under} under, ${stats.adherence.over} over.`,
      );
    }
    facts.push(`Logging streak: ${stats.streak.current} days (longest in range ${stats.streak.longest}).`);
    if (stats.daysCounted < stats.daysLogged) facts.push('Averages leave out today, which is still in progress.');
    lines.push(...facts.map((fact) => `- ${fact}`), '');

    if (stats.macroSplit) {
      const pct = (value: number) => `${Math.round(value * 100)}%`;
      lines.push(
        `Calories came ${pct(stats.macroSplit.protein)} from protein, ${pct(stats.macroSplit.carbs)} from carbs and ${pct(stats.macroSplit.fat)} from fat.`,
        '',
      );
    }

    const meals = stats.meals.filter((meal) => meal.average > 0);
    if (meals.length > 0) {
      lines.push('### Meals', '', '| Meal | kcal a day | Share |', '|---|---|---|');
      for (const meal of meals) {
        lines.push(`| ${MEAL_LABELS[meal.meal]} | ${Math.round(meal.average)} | ${Math.round(meal.share * 100)}% |`);
      }
      lines.push('');
    }

    if (stats.topFoods.length > 0) {
      lines.push('### Most logged', '', '| Food | Times | Days | kcal total |', '|---|---|---|---|');
      for (const food of stats.topFoods) {
        const name = food.brand ? `${food.name} (${food.brand})` : food.name;
        lines.push(`| ${mdCell(name)} | ${food.entries} | ${food.days} | ${Math.round(food.calories)} |`);
      }
      lines.push('');
    }
  }

  lines.push('## Day by day', '');
  for (const [date, list] of days) {
    const totals = totalsOf(list);
    const verdict = goals.calories ? `, ${verdictWord(totals.calories ?? 0, goals.calories)}` : '';
    lines.push(
      `### ${describeIsoDate(date)}`,
      '',
      `${kcal(totals.calories)}${verdict} · protein ${grams(totals.protein)} · carbs ${grams(totals.carbs)} · fat ${grams(totals.fat)}`,
      '',
      '| Meal | Time | Food | Amount | kcal | P | C | F |',
      '|---|---|---|---|---|---|---|---|',
    );
    for (const entry of list) {
      const item = itemTotals(entry);
      const name = entry.brand ? `${entry.name} (${entry.brand})` : entry.name;
      const amount = `${round(entry.quantity, 2)} × ${entry.servingLabel}`;
      lines.push(
        `| ${MEAL_LABELS[entry.meal]} | ${entry.time ?? ''} | ${mdCell(name)} | ${mdCell(amount)} | ${Math.round(item.calories ?? 0)} | ${Math.round(item.protein ?? 0)} | ${Math.round(item.carbs ?? 0)} | ${Math.round(item.fat ?? 0)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

function nutritionJson(input: NutritionExportInput): string {
  const days = groupByDate(input.entries).map(([date, list]) => ({
    date,
    totals: roundValues(totalsOf(list)),
    entries: list.map((entry) => ({
      meal: entry.meal,
      time: entry.time ?? null,
      name: entry.name,
      brand: entry.brand,
      quantity: entry.quantity,
      serving: entry.servingLabel,
      servingGrams: entry.servingGrams,
      source: entry.source,
      perServing: entry.nutrients,
      total: roundValues(itemTotals(entry)),
    })),
  }));
  const stats = input.stats;
  return JSON.stringify(
    {
      app: 'Lift',
      kind: 'food-diary',
      exportedAt: input.exportedAt?.toISOString(),
      from: input.from,
      to: input.to,
      goals: stats?.goals ?? null,
      summary: stats
        ? {
            days: stats.days,
            daysLogged: stats.daysLogged,
            daysCounted: stats.daysCounted,
            averages: roundValues(stats.averages),
            adherence: stats.adherence,
            macroSplit: stats.macroSplit,
            streak: stats.streak,
          }
        : null,
      days,
    },
    null,
    2,
  );
}

function roundValues(values: NutrientValues): NutrientValues {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, round(value, 2)]));
}
