/**
 * The food tracker's API contract: every request body as a zod schema, every
 * response as a type.
 *
 * Unlike training data, nothing here is replicated. Food lives on the server
 * and the app talks to `/api/nutrition/*` directly, so these shapes are the
 * whole agreement between the two. The server parses every body with the
 * schemas below and the app's client is typed with the same names, which is
 * what stops them drifting.
 *
 * The central idea is the **portion**: a food at one serving size, with the
 * figures for that serving copied onto it. An entry is a portion plus a
 * quantity, a date and a meal; a template item is a portion plus a quantity.
 * Copying the figures rather than pointing at the food is deliberate: editing
 * a food later must not rewrite what was eaten last month.
 */

import { z } from 'zod';

import type { CustomNutrient, NutrientValues } from './nutrients.ts';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'] as const;
export type Meal = (typeof MEALS)[number];

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
};

/** Where a food's figures came from. Shown as a small badge, and used to dedupe imports. */
export const FOOD_SOURCES = ['custom', 'openfoodfacts', 'usda', 'ai'] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A local calendar date, `YYYY-MM-DD`. The day the user ate it, in their zone. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

const finite = z.number().finite();

/** Non-negative, and nothing absurd: a typo of 10,000,000 kcal should be refused, not logged. */
export const nutrientValuesSchema = z
  .record(z.string().min(1).max(64), finite.min(0).max(1_000_000))
  .refine((values) => Object.keys(values).length <= 200, 'Too many nutrients.');

export const mealSchema = z.enum(MEALS);

/** A time of day on a 24-hour clock, `HH:mm`, local to whoever ate. */
export const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm.');

export const servingSchema = z.object({
  id: z.string().min(1).max(64),
  /** "1 cup", "100 g", "1 roti". */
  label: z.string().trim().min(1).max(80),
  /** Weight of one of this serving, when known. What lets the editor offer grams. */
  grams: finite.positive().max(100_000).nullable(),
  nutrients: nutrientValuesSchema,
});
export type Serving = z.infer<typeof servingSchema>;

/** A food at one serving, figures included. The unit of logging. */
export const portionSchema = z.object({
  foodId: z.string().max(64).nullable(),
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().max(120).nullable(),
  servingLabel: z.string().trim().min(1).max(80),
  servingGrams: finite.positive().max(100_000).nullable(),
  /** Per one serving. */
  nutrients: nutrientValuesSchema,
  source: z.enum(FOOD_SOURCES),
});
export type Portion = z.infer<typeof portionSchema>;

export const quantitySchema = finite.positive().max(10_000);

// ---------------------------------------------------------------------------
// Foods
// ---------------------------------------------------------------------------

export interface Food {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  source: FoodSource;
  /** The provider's own id, for `openfoodfacts` and `usda`. */
  sourceId: string | null;
  /** At least one. The first is the default. */
  servings: Serving[];
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export const foodInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().max(120).nullable().default(null),
  barcode: z.string().trim().max(32).nullable().default(null),
  source: z.enum(FOOD_SOURCES).default('custom'),
  sourceId: z.string().max(64).nullable().default(null),
  servings: z.array(servingSchema).min(1).max(20),
  isFavorite: z.boolean().default(false),
});
export type FoodInput = z.input<typeof foodInputSchema>;

export const foodPatchSchema = foodInputSchema
  .omit({ source: true, sourceId: true })
  .partial();
export type FoodPatch = z.input<typeof foodPatchSchema>;

/**
 * A food found in an outside database and not yet saved. Saving happens the
 * first time it is logged or starred, through `POST /foods`, which upserts on
 * `(source, sourceId)` so a second import returns the same row.
 */
export interface FoodCandidate extends Omit<Food, 'id' | 'isFavorite' | 'createdAt' | 'updatedAt'> {
  /** Set when this user has already saved it. */
  id: string | null;
  isFavorite: boolean;
}

export interface FoodSearchResult {
  /** The user's own foods, best match first. */
  mine: Food[];
  /** Outside databases, minus anything already in `mine`. */
  external: FoodCandidate[];
  /** Providers that failed or timed out. The rest still answered. */
  unavailable: FoodSource[];
}

// ---------------------------------------------------------------------------
// Diary entries
// ---------------------------------------------------------------------------

export interface FoodEntry extends Portion {
  id: string;
  date: string;
  meal: Meal;
  quantity: number;
  /**
   * When it was eaten, `HH:mm` local time, or null when not given. Optional
   * because entries from before the field (and an older server) have none.
   */
  time?: string | null;
  /** Order within the meal. */
  position: number;
  createdAt: number;
  updatedAt: number;
}

export const entryItemSchema = portionSchema.extend({ quantity: quantitySchema });
export type EntryItem = z.infer<typeof entryItemSchema>;

export const createEntriesSchema = z.object({
  date: isoDate,
  meal: mealSchema,
  /** When the meal was eaten. Applies to every item; omitted means not given. */
  time: clockTimeSchema.nullable().optional(),
  items: z.array(entryItemSchema).min(1).max(100),
});
export type CreateEntriesInput = z.input<typeof createEntriesSchema>;

/** Everything about an entry that can change after it is logged. */
export const entryPatchSchema = z
  .object({
    date: isoDate,
    meal: mealSchema,
    time: clockTimeSchema.nullable(),
    quantity: quantitySchema,
    name: z.string().trim().min(1).max(160),
    servingLabel: z.string().trim().min(1).max(80),
    servingGrams: finite.positive().max(100_000).nullable(),
    nutrients: nutrientValuesSchema,
  })
  .partial();
export type EntryPatch = z.input<typeof entryPatchSchema>;

/**
 * Copy entries somewhere else. Either name them, or name a day (and optionally
 * one meal of it) and take everything in it.
 *
 * `to.meal` omitted keeps each entry in the meal it came from, which is what
 * "copy yesterday" means. Set, it moves them all into that one meal, which is
 * what "copy this breakfast to today's lunch" means.
 */
export const copyEntriesSchema = z
  .object({
    ids: z.array(z.string().max(64)).min(1).max(200).optional(),
    from: z.object({ date: isoDate, meal: mealSchema.optional() }).optional(),
    to: z.object({ date: isoDate, meal: mealSchema.optional() }),
  })
  .refine((value) => (value.ids ? 1 : 0) + (value.from ? 1 : 0) === 1, 'Give either ids or from.');
export type CopyEntriesInput = z.input<typeof copyEntriesSchema>;

export const deleteEntriesSchema = z.object({ ids: z.array(z.string().max(64)).min(1).max(200) });

/** Something logged before, with the amount used last time. What "Recent" lists. */
export interface RecentItem extends EntryItem {
  lastLoggedAt: number;
  timesLogged: number;
  /**
   * How many of those times were at each meal, so the add screen and the diary
   * can suggest it where it is usually eaten. Optional because an older server
   * does not send it; treat missing as "no meal preference".
   */
  meals?: Partial<Record<Meal, number>>;
}

export interface DiaryDay {
  date: string;
  entries: FoodEntry[];
}

/** One day's totals, for the week strip and the trend chart. */
export interface DaySummary {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  entryCount: number;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface MealTemplate {
  id: string;
  name: string;
  /** The meal it is usually eaten at. Where it lands when logged without one. */
  meal: Meal | null;
  items: EntryItem[];
  /** How many times it has been logged. Orders the list. */
  useCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  meal: mealSchema.nullable().default(null),
  items: z.array(entryItemSchema).min(1).max(100),
});
export type TemplateInput = z.input<typeof templateInputSchema>;

export const templatePatchSchema = templateInputSchema.partial();
export type TemplatePatch = z.input<typeof templatePatchSchema>;

export const logTemplateSchema = z.object({
  date: isoDate,
  meal: mealSchema.optional(),
  /** Scales every item, for "half of my usual breakfast". */
  scale: finite.positive().max(100).default(1),
});
export type LogTemplateInput = z.input<typeof logTemplateSchema>;

// ---------------------------------------------------------------------------
// Goals and custom nutrients
// ---------------------------------------------------------------------------

/** Daily targets keyed like `NutrientValues`. A missing key has no target. */
export interface NutritionGoals {
  targets: NutrientValues;
  updatedAt: number | null;
}

export const goalsInputSchema = z.object({ targets: nutrientValuesSchema });
export type GoalsInput = z.input<typeof goalsInputSchema>;

export const customNutrientInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  unit: z.string().trim().min(1).max(12),
});
export type CustomNutrientInput = z.input<typeof customNutrientInputSchema>;

/** What the app loads once when the food tab opens. */
export interface NutritionProfile {
  goals: NutritionGoals;
  customNutrients: CustomNutrient[];
}
