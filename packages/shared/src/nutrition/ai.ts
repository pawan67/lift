/**
 * Asking a model what is on the plate.
 *
 * The request goes out from the phone with the user's own key, through the same
 * `AiRequest` every other AI feature uses; this file only decides what to ask
 * and how to read the answer. The answer is a list of items, each a portion
 * with a quantity, which is exactly what the diary logs, so an estimate turns
 * into entries without a translation step. Nothing is logged until the user has
 * looked at it: a model guessing at a photo is wrong often enough that the
 * review screen is the feature, not a formality.
 */

import { z } from 'zod';

import type { AiImage, AiRequest } from '../ai/messages.ts';

import { BUILT_IN_NUTRIENTS, CORE_NUTRIENT_KEYS, type CustomNutrient, type NutrientValues } from './nutrients.ts';
import type { EntryItem } from './types.ts';

export interface FoodEstimateInput {
  /** What the user typed. May be empty when a photo says it all. */
  description: string;
  image?: AiImage | null;
  customNutrients: readonly CustomNutrient[];
}

export interface EstimatedItem extends EntryItem {
  /** 0 to 1. Shown as low / medium / high so nobody reads 0.73 as precise. */
  confidence: number;
}

export interface FoodEstimate {
  items: EstimatedItem[];
  /** One line from the model about what it assumed, or null. */
  note: string | null;
}

function nutrientList(custom: readonly CustomNutrient[]): string {
  const builtIn = BUILT_IN_NUTRIENTS.map((n) => `- "${n.key}": ${n.label} (${n.unit})`);
  const extra = custom.map((c) => `- "${c.id}": ${c.name} (${c.unit})`);
  return [...builtIn, ...extra].join('\n');
}

export function buildFoodEstimateRequest(input: FoodEstimateInput): AiRequest {
  const system = `You are a nutritionist estimating what someone ate, for a food diary.

Split the meal into its separate foods, one item per food, and estimate each one's nutrition.

Rules:
- Use realistic portion sizes. If the person gives an amount, use it exactly. If they do not, assume a typical single portion for the cuisine and say so in "note".
- Prefer common reference values (USDA, IFCT for Indian food, food labels for branded products).
- "nutrients" are for ONE serving as described by "servingLabel". "quantity" is how many of those servings were eaten.
- Always include calories, protein, carbs and fat. Include every other nutrient below that you can reasonably estimate. Leave out any you cannot; never write 0 for unknown.
- "servingGrams" is the weight of one serving in grams, or null if it truly cannot be estimated.
- "confidence" is 0 to 1: how sure you are of the identification and portion.

Nutrient keys (use these exact keys):
${nutrientList(input.customNutrients)}

Reply with ONLY a JSON object, no prose and no code fence:
{"items":[{"name":"Chapati","servingLabel":"1 medium (40 g)","servingGrams":40,"quantity":2,"confidence":0.8,"nutrients":{"calories":120,"protein":3.1,"carbs":18,"fat":3.7,"fiber":2.7}}],"note":"Assumed ghee on the chapatis."}`;

  const text = input.description.trim()
    ? `What I ate: ${input.description.trim()}`
    : 'Estimate the food in this photo.';

  return {
    system,
    messages: [{ role: 'user', content: text, ...(input.image ? { images: [input.image] } : {}) }],
    maxOutputTokens: 2000,
    temperature: 0.2,
  };
}

/** A number, or a string holding one: models quote figures about as often as not. */
function looseNumber<T extends z.ZodType>(inner: T) {
  return z.preprocess((value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value), inner);
}

const rawItemSchema = z.object({
  name: z.string().trim().min(1),
  servingLabel: z.string().trim().min(1).catch('1 serving'),
  servingGrams: looseNumber(z.number().finite().positive().nullable()).catch(null),
  quantity: looseNumber(z.number().finite().positive()).catch(1),
  confidence: looseNumber(z.number().finite().min(0).max(1)).catch(0.5),
  nutrients: z.record(z.string(), z.unknown()),
});

const rawEstimateSchema = z.object({
  items: z.array(z.unknown()),
  note: z.string().nullable().optional(),
});

/** The first `{` to its matching last `}`, so a stray sentence or code fence around it does not matter. */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not reply with an estimate.');
  return JSON.parse(text.slice(start, end + 1));
}

function cleanNutrients(raw: Record<string, unknown>, allowed: ReadonlySet<string>): NutrientValues {
  const out: NutrientValues = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key)) continue;
    const number = typeof value === 'string' ? Number(value) : value;
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0) out[key] = number;
  }
  return out;
}

/**
 * Reads the model's reply into items the diary can log.
 *
 * Lenient about form and strict about content: a number sent as a string is
 * fine, an invented nutrient key is dropped, and an item missing any of the
 * four core figures is dropped too, because a diary entry with no calories is
 * worse than no entry. Throws only when nothing usable came back.
 */
export function parseFoodEstimate(text: string, customNutrients: readonly CustomNutrient[]): FoodEstimate {
  const parsed = rawEstimateSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new Error('The estimate was not in the expected shape.');

  const allowed = new Set<string>([...BUILT_IN_NUTRIENTS.map((n) => n.key), ...customNutrients.map((c) => c.id)]);

  const items: EstimatedItem[] = [];
  for (const raw of parsed.data.items) {
    const item = rawItemSchema.safeParse(raw);
    if (!item.success) continue;

    const nutrients = cleanNutrients(item.data.nutrients, allowed);
    if (!CORE_NUTRIENT_KEYS.every((key) => key in nutrients)) continue;

    items.push({
      foodId: null,
      name: item.data.name.slice(0, 160),
      brand: null,
      servingLabel: item.data.servingLabel.slice(0, 80),
      servingGrams: item.data.servingGrams,
      quantity: item.data.quantity,
      nutrients,
      source: 'ai',
      confidence: item.data.confidence,
    });
  }

  if (items.length === 0) throw new Error('The model could not identify any food.');

  const note = parsed.data.note?.trim();
  return { items, note: note ? note : null };
}

export function confidenceLabel(confidence: number): 'low' | 'medium' | 'high' {
  return confidence >= 0.75 ? 'high' : confidence >= 0.45 ? 'medium' : 'low';
}
