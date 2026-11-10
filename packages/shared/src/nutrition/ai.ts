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
import { withGrams, type ServingSize } from './servings.ts';
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
  /**
   * Other common sizes of the same food ("1 dozen (600 g)", "100 g"), offered
   * beside the logged one so the size can be switched without retyping
   * figures. Each has its weight; figures follow from the logged serving's.
   */
  servingOptions: ServingSize[];
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
- "servingLabel" is ONE natural unit of the food with its weight in brackets: "1 large egg (50 g)", "1 medium chapati (40 g)", "1 katori (150 g)", "1 cup (240 g)". Never put the whole amount eaten in it.
- "quantity" is how many of those units were eaten. "3 eggs" is servingLabel "1 large egg (50 g)" with quantity 3, not "3 eggs" with quantity 1. "200 g chicken" is servingLabel "100 g" with quantity 2. "Half a pizza" is the pizza's unit with quantity 0.5.
- "nutrients" are for ONE serving as described by "servingLabel", so the total is nutrients times quantity. Check that the figures match the serving's grams.
- "servings" lists up to 3 other common sizes of the same food, each with its weight in grams, for example for eggs [{"label":"1 dozen (600 g)","grams":600},{"label":"1 medium egg (44 g)","grams":44}]. Do not repeat "servingLabel" there, and leave it [] when nothing else is common.
- Always include calories, protein, carbs and fat. Add fiber, sugar, saturated fat and sodium when you can estimate them, and any other nutrient below only when this food is a meaningful source of it. Leave out what you cannot estimate; never write 0 for unknown.
- "servingGrams" is the weight of one serving in grams, or null if it truly cannot be estimated.
- "confidence" is 0 to 1: how sure you are of the identification and portion.
- The description may be long and cover a whole day or several meals. List every food mentioned, each once: the same food eaten twice is one item with a bigger "quantity". Skip plain water.
- Keep "name" short (a few words) and "note" to one sentence.

Nutrient keys (use these exact keys):
${nutrientList(input.customNutrients)}

Reply with ONLY a compact JSON object on one line, no prose, no code fence, no extra spaces:
{"items":[{"name":"Chapati","servingLabel":"1 medium chapati (40 g)","servingGrams":40,"quantity":2,"confidence":0.8,"nutrients":{"calories":120,"protein":3.1,"carbs":18,"fat":3.7,"fiber":2.7},"servings":[{"label":"1 large chapati (60 g)","grams":60}]}],"note":"Assumed ghee on the chapatis."}`;

  const text = input.description.trim()
    ? `What I ate: ${input.description.trim()}`
    : 'Estimate the food in this photo.';

  return {
    system,
    messages: [{ role: 'user', content: text, ...(input.image ? { images: [input.image] } : {}) }],
    // A long description is a long list, at up to a couple of hundred tokens a
    // food, and a thinking model spends part of this on reasoning first. 2000
    // ran out at around eight foods and cut the JSON off mid-item. 8000 is
    // DeepSeek's ceiling for a reply, which makes it the safe common maximum.
    maxOutputTokens: 8000,
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
  servings: z.array(z.unknown()).catch([]).optional(),
});

const rawSizeSchema = z.object({
  label: z.string().trim().min(1),
  grams: looseNumber(z.number().finite().positive().max(100_000)),
});

/** The alternative sizes that are usable: a label and a weight, at most three. */
function cleanSizes(raw: readonly unknown[] | undefined): ServingSize[] {
  const sizes: ServingSize[] = [];
  for (const entry of raw ?? []) {
    const size = rawSizeSchema.safeParse(entry);
    if (!size.success) continue;
    sizes.push({ label: withGrams(size.data.label, size.data.grams).slice(0, 80), grams: size.data.grams });
    if (sizes.length === 3) break;
  }
  return sizes;
}

const rawEstimateSchema = z.object({
  items: z.array(z.unknown()),
  note: z.string().nullable().optional(),
});

/** The first `{` to its matching last `}`, so a stray sentence or code fence around it does not matter. */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * The complete items from a reply that stopped partway, which is what a model
 * that ran out of output tokens sends: `{"items":[{...},{...},{"name":"Ri`.
 *
 * Walks the `items` array one top-level object at a time, tracking strings so
 * a brace inside a name does not count, and keeps every object that closed.
 * The last, half-written one is dropped. Null when there is no items array.
 */
function salvageItems(text: string): unknown[] | null {
  const key = /"items"\s*:\s*\[/.exec(text);
  if (!key) return null;

  const items: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = key.index + key[0].length; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') {
      if (depth === 0) start = index;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          items.push(JSON.parse(text.slice(start, index + 1)));
        } catch {
          // A malformed item is skipped like any other unusable one.
        }
        start = -1;
      }
    } else if (char === ']' && depth === 0) break;
  }
  return items;
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
  // Not whole JSON: most often a reply cut off by the output limit. Whatever
  // foods it finished are still good, and the note says the list may be short.
  const salvaged = parsed.success ? null : salvageItems(text);
  if (!parsed.success && !salvaged?.length) {
    throw new Error(
      text.includes('{')
        ? 'The answer was cut off before any food was finished.'
        : 'The model did not reply with an estimate.',
    );
  }
  const rawItems = parsed.success ? parsed.data.items : salvaged!;

  const allowed = new Set<string>([...BUILT_IN_NUTRIENTS.map((n) => n.key), ...customNutrients.map((c) => c.id)]);

  const items: EstimatedItem[] = [];
  for (const raw of rawItems) {
    const item = rawItemSchema.safeParse(raw);
    if (!item.success) continue;

    const nutrients = cleanNutrients(item.data.nutrients, allowed);
    if (!CORE_NUTRIENT_KEYS.every((key) => key in nutrients)) continue;

    items.push({
      foodId: null,
      name: item.data.name.slice(0, 160),
      brand: null,
      // The weight goes in the label when the model left it out, so the size
      // reads the same here as everywhere else it is offered.
      servingLabel: withGrams(item.data.servingLabel, item.data.servingGrams).slice(0, 80),
      servingGrams: item.data.servingGrams,
      quantity: item.data.quantity,
      nutrients,
      source: 'ai',
      confidence: item.data.confidence,
      servingOptions: cleanSizes(item.data.servings),
    });
  }

  if (items.length === 0) throw new Error('The model could not identify any food.');

  if (!parsed.success) {
    return {
      items,
      note: 'The answer was cut short, so some foods may be missing. Check the list, and estimate anything missing separately.',
    };
  }
  const note = parsed.data.note?.trim();
  return { items, note: note ? note : null };
}

/**
 * How many foods a reply still streaming in has started, for "found 4 foods so
 * far" while a long description is estimated. Counts item names, which only
 * appear once per item in the reply's shape; a rough count is all it is for.
 */
export function estimateProgress(partial: string): number {
  return partial.match(/"name"\s*:/g)?.length ?? 0;
}

export function confidenceLabel(confidence: number): 'low' | 'medium' | 'high' {
  return confidence >= 0.75 ? 'high' : confidence >= 0.45 ? 'medium' : 'low';
}
