/**
 * Outside food databases, reduced to `FoodCandidate`s.
 *
 * Two of them, chosen for being free and covering different ground:
 *
 * - **OpenFoodFacts** for packaged products and barcodes. No key; it asks only
 *   for an identifying User-Agent. Text search goes to its search service
 *   (search.openfoodfacts.org), because the classic `/cgi/search.pl` endpoint
 *   is rate-limited to a handful of requests a minute.
 * - **USDA FoodData Central** for whole and generic foods ("banana", "cooked
 *   rice"), which OpenFoodFacts is thin on. Needs `USDA_API_KEY`; without one
 *   it uses `DEMO_KEY`, which works but is limited per server IP, so a deployed
 *   server should have a real (free) key.
 *
 * Both report per 100 g, so every candidate gets a "100 g" serving, and a
 * product that states its serving size gets that too, first, since it is what
 * people eat. Units are converted into the ones `BUILT_IN_NUTRIENTS` declares.
 */

import { Logger } from '@nestjs/common';
import type { FoodCandidate, NutrientValues, Serving } from '@lift/shared';

const USER_AGENT = 'Lift/1.0 (food diary; https://lift.pawan67.dev)';
const TIMEOUT_MS = 8_000;

const logger = new Logger('FoodProviders');

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function scale(values: NutrientValues, factor: number): NutrientValues {
  const out: NutrientValues = {};
  for (const [key, value] of Object.entries(values)) out[key] = round(value * factor);
  return out;
}

/** The serving list for figures known per 100 g, with the product's own serving first when it has one. */
function servingsFor(per100g: NutrientValues, serving: { label: string; grams: number } | null): Serving[] {
  const hundred: Serving = { id: '100g', label: '100 g', grams: 100, nutrients: per100g };
  if (!serving || serving.grams <= 0 || Math.abs(serving.grams - 100) < 0.01) return [hundred];
  return [
    { id: 'serving', label: serving.label, grams: serving.grams, nutrients: scale(per100g, serving.grams / 100) },
    hundred,
  ];
}

// ---------------------------------------------------------------------------
// OpenFoodFacts
// ---------------------------------------------------------------------------

/** OpenFoodFacts key → ours, and the factor from its unit (always grams per 100 g) to ours. */
const OFF_NUTRIENTS: [string, string, number][] = [
  ['proteins', 'protein', 1],
  ['carbohydrates', 'carbs', 1],
  ['fat', 'fat', 1],
  ['saturated-fat', 'saturatedFat', 1],
  ['monounsaturated-fat', 'monounsaturatedFat', 1],
  ['polyunsaturated-fat', 'polyunsaturatedFat', 1],
  ['trans-fat', 'transFat', 1],
  ['cholesterol', 'cholesterol', 1_000],
  ['fiber', 'fiber', 1],
  ['sugars', 'sugar', 1],
  ['added-sugars', 'addedSugar', 1],
  ['sodium', 'sodium', 1_000],
  ['potassium', 'potassium', 1_000],
  ['calcium', 'calcium', 1_000],
  ['iron', 'iron', 1_000],
  ['magnesium', 'magnesium', 1_000],
  ['vitamin-a', 'vitaminA', 1_000_000],
  ['vitamin-c', 'vitaminC', 1_000],
  ['vitamin-d', 'vitaminD', 1_000_000],
  ['vitamin-b12', 'vitaminB12', 1_000_000],
];

const OFF_FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity';

interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string | string[];
  nutriments?: Record<string, unknown>;
  serving_size?: string;
  serving_quantity?: number | string;
}

function number(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

export function fromOpenFoodFacts(product: OffProduct): FoodCandidate | null {
  const name = (product.product_name_en || product.product_name || '').trim();
  const n = product.nutriments ?? {};
  const kcal = number(n['energy-kcal_100g']) ?? (number(n['energy-kj_100g']) ?? NaN) / 4.184;
  if (!name || !product.code || !Number.isFinite(kcal)) return null;

  const per100g: NutrientValues = { calories: round(kcal, 1) };
  for (const [theirs, ours, factor] of OFF_NUTRIENTS) {
    const value = number(n[`${theirs}_100g`]);
    if (value !== null) per100g[ours] = round(value * factor);
  }

  const brands = Array.isArray(product.brands) ? product.brands.join(', ') : product.brands;
  const servingGrams = number(product.serving_quantity);
  const servingSize = product.serving_size?.trim();

  return {
    id: null,
    name: name.slice(0, 160),
    brand: brands?.split(',')[0]?.trim().slice(0, 120) || null,
    barcode: product.code,
    source: 'openfoodfacts',
    sourceId: product.code,
    servings: servingsFor(
      per100g,
      servingGrams ? { label: `1 serving (${servingSize || `${servingGrams} g`})`.slice(0, 80), grams: servingGrams } : null,
    ),
    isFavorite: false,
  };
}

export function searchOpenFoodFacts(query: string, limit: number): Promise<FoodCandidate[]> {
  return cached(`off:${limit}:${query.toLowerCase()}`, () => fetchOpenFoodFacts(query, limit));
}

async function fetchOpenFoodFacts(query: string, limit: number): Promise<FoodCandidate[]> {
  const url = new URL('https://search.openfoodfacts.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('page_size', String(limit));
  url.searchParams.set('fields', OFF_FIELDS);
  const body = (await getJson(url.toString())) as { hits?: OffProduct[] };
  return (body.hits ?? []).map(fromOpenFoodFacts).filter((c): c is FoodCandidate => c !== null);
}

export function lookupBarcode(code: string): Promise<FoodCandidate | null> {
  return cached(`barcode:${code}`, () => fetchBarcode(code));
}

async function fetchBarcode(code: string): Promise<FoodCandidate | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}?fields=${OFF_FIELDS}`;
  try {
    const body = (await getJson(url)) as { status?: number; product?: OffProduct };
    if (body.status !== 1 || !body.product) return null;
    return fromOpenFoodFacts({ ...body.product, code: body.product.code ?? code });
  } catch (error) {
    // OpenFoodFacts answers 404 for an unknown barcode, which is "not found",
    // not a failure worth surfacing.
    if (error instanceof Error && error.message.endsWith('404')) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// USDA FoodData Central
// ---------------------------------------------------------------------------

/** FDC nutrient number → ours. FDC already reports in our units (g, mg, µg, kcal). */
const FDC_NUTRIENTS: Record<string, string> = {
  '208': 'calories',
  '203': 'protein',
  '205': 'carbs',
  '204': 'fat',
  '606': 'saturatedFat',
  '645': 'monounsaturatedFat',
  '646': 'polyunsaturatedFat',
  '605': 'transFat',
  '601': 'cholesterol',
  '291': 'fiber',
  '269': 'sugar',
  '307': 'sodium',
  '306': 'potassium',
  '301': 'calcium',
  '303': 'iron',
  '304': 'magnesium',
  '320': 'vitaminA',
  '401': 'vitaminC',
  '328': 'vitaminD',
  '418': 'vitaminB12',
};

/**
 * Foundation foods report energy under the Atwater numbers rather than 208.
 * Used only when 208 is missing.
 */
const FDC_ENERGY_FALLBACKS = ['957', '958'];

interface FdcFood {
  fdcId: number;
  description: string;
  brandOwner?: string;
  foodNutrients?: { nutrientNumber?: string; value?: number; unitName?: string }[];
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
}

/** "BANANAS, RAW" and "Bananas, raw" both read better as "Bananas, raw". */
function tidyName(description: string): string {
  const name = description === description.toUpperCase() ? description.toLowerCase() : description;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function fromUsda(food: FdcFood): FoodCandidate | null {
  const per100g: NutrientValues = {};
  const byNumber = new Map<string, number>();
  for (const nutrient of food.foodNutrients ?? []) {
    if (nutrient.nutrientNumber && typeof nutrient.value === 'number' && nutrient.value >= 0) {
      // Energy also appears in kJ under 268, never under 208, so 208 is safe.
      byNumber.set(nutrient.nutrientNumber, nutrient.value);
    }
  }
  for (const [theirs, ours] of Object.entries(FDC_NUTRIENTS)) {
    const value = byNumber.get(theirs);
    if (value !== undefined) per100g[ours] = round(value);
  }
  if (per100g.calories === undefined) {
    const fallback = FDC_ENERGY_FALLBACKS.map((n) => byNumber.get(n)).find((v) => v !== undefined);
    if (fallback === undefined) return null;
    per100g.calories = round(fallback, 1);
  }

  const grams =
    food.servingSize && food.servingSizeUnit?.toLowerCase() === 'g' ? food.servingSize : null;

  return {
    id: null,
    name: tidyName(food.description).slice(0, 160),
    brand: food.brandOwner?.slice(0, 120) ?? null,
    barcode: null,
    source: 'usda',
    sourceId: String(food.fdcId),
    servings: servingsFor(
      per100g,
      grams ? { label: (food.householdServingFullText || `1 serving (${grams} g)`).slice(0, 80), grams } : null,
    ),
    isFavorite: false,
  };
}

export function searchUsda(query: string, limit: number): Promise<FoodCandidate[]> {
  return cached(`usda:${limit}:${query.toLowerCase()}`, () => fetchUsda(query, limit));
}

async function fetchUsda(query: string, limit: number): Promise<FoodCandidate[]> {
  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.searchParams.set('api_key', process.env.USDA_API_KEY || 'DEMO_KEY');
  url.searchParams.set('query', query);
  url.searchParams.set('pageSize', String(limit));
  // Generic foods only. Branded products overlap OpenFoodFacts, which has
  // barcodes and better coverage outside the US.
  url.searchParams.set('dataType', 'Foundation,SR Legacy,Survey (FNDDS)');
  const body = (await getJson(url.toString())) as { foods?: FdcFood[] };
  return (body.foods ?? []).map(fromUsda).filter((c): c is FoodCandidate => c !== null);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Recent answers, shared by every user, for ten minutes.
 *
 * People retype the same search as they refine it, and USDA's free tier is
 * counted per key per hour, so the same query reaching it twice in a minute is
 * a request spent on nothing. Failures are not cached, so a provider that was
 * down is asked again on the next search. Bounded so it cannot grow without
 * limit; the oldest entry goes first.
 */
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; value: unknown }>();

export async function cached<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;

  const value = await run();
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return value;
}

/** Runs a provider and turns any failure into "unavailable" rather than failing the search. */
export async function settle<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    logger.warn(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
