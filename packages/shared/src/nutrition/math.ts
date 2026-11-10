/**
 * The arithmetic of a food diary. Pure, so the app's totals and the server's
 * summaries can never disagree.
 */

import { KCAL_PER_GRAM, nutrientDefinition, type CustomNutrient, type NutrientValues } from './nutrients.ts';
import { MEALS, type EntryItem, type FoodEntry, type Meal, type Serving } from './types.ts';

/** Every figure times `factor`. Unknown stays unknown: a missing key is not a zero. */
export function scaleNutrients(values: NutrientValues, factor: number): NutrientValues {
  const out: NutrientValues = {};
  for (const [key, value] of Object.entries(values)) out[key] = value * factor;
  return out;
}

/**
 * Adds maps together. A key present in any of them is present in the result,
 * so "sugar: 12 g" from one food is not lost because another did not say.
 */
export function sumNutrients(list: readonly NutrientValues[]): NutrientValues {
  const out: NutrientValues = {};
  for (const values of list) {
    for (const [key, value] of Object.entries(values)) out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

/** What one entry, or one template item, actually amounts to. */
export function itemTotals(item: Pick<EntryItem, 'nutrients' | 'quantity'>): NutrientValues {
  return scaleNutrients(item.nutrients, item.quantity);
}

export function totalsOf(items: readonly Pick<EntryItem, 'nutrients' | 'quantity'>[]): NutrientValues {
  return sumNutrients(items.map(itemTotals));
}

/** Entries grouped by meal, each meal in display order and sorted by position. */
export function groupByMeal(entries: readonly FoodEntry[]): Record<Meal, FoodEntry[]> {
  const out = Object.fromEntries(MEALS.map((meal) => [meal, [] as FoodEntry[]])) as Record<Meal, FoodEntry[]>;
  for (const entry of entries) out[entry.meal].push(entry);
  for (const meal of MEALS) out[meal].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
  return out;
}

/**
 * Converts between "servings" and grams for a serving that knows its weight.
 *
 * The editor lets a user type 150 g of something whose serving is "1 cup
 * (240 g)". Entries always store servings, so grams are only ever an input
 * format and this is the whole of the conversion.
 */
export function gramsToQuantity(grams: number, servingGrams: number): number {
  return grams / servingGrams;
}

export function quantityToGrams(quantity: number, servingGrams: number): number {
  return quantity * servingGrams;
}

/**
 * The same food expressed at another serving. Figures scale by weight, so this
 * only works when both servings know their grams, and returns null otherwise.
 */
export function convertServing(from: Serving, toGrams: number): NutrientValues | null {
  if (!from.grams) return null;
  return scaleNutrients(from.nutrients, toGrams / from.grams);
}

/**
 * Share of calories from each macro, as fractions that sum to 1, or null when
 * there is nothing to split. Worked out from the grams rather than read off a
 * label, because labels round and the bar should add up.
 */
export function macroEnergySplit(values: NutrientValues): { protein: number; carbs: number; fat: number } | null {
  const protein = (values.protein ?? 0) * KCAL_PER_GRAM.protein;
  const carbs = (values.carbs ?? 0) * KCAL_PER_GRAM.carbs;
  const fat = (values.fat ?? 0) * KCAL_PER_GRAM.fat;
  const total = protein + carbs + fat;
  if (total <= 0) return null;
  return { protein: protein / total, carbs: carbs / total, fat: fat / total };
}

/** Grams of each macro that a calorie target and a percentage split imply. */
export function macroGramsFromPercent(
  calories: number,
  percent: { protein: number; carbs: number; fat: number },
): { protein: number; carbs: number; fat: number } {
  return {
    protein: Math.round((calories * percent.protein) / 100 / KCAL_PER_GRAM.protein),
    carbs: Math.round((calories * percent.carbs) / 100 / KCAL_PER_GRAM.carbs),
    fat: Math.round((calories * percent.fat) / 100 / KCAL_PER_GRAM.fat),
  };
}

/** A figure at the precision its nutrient deserves, without trailing zeros. */
export function formatNutrientValue(key: string, value: number, custom: readonly CustomNutrient[] = []): string {
  const decimals = nutrientDefinition(key, custom)?.decimals ?? 1;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

/** "1.5", "0.25", "2": a quantity as a person would write it. */
export function formatQuantity(quantity: number): string {
  return (Math.round(quantity * 100) / 100).toString();
}

/** Calories rounded for display. Every screen shows them the same way. */
export function formatCalories(value: number | undefined): string {
  return Math.round(value ?? 0).toLocaleString('en-US');
}
