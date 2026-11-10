/**
 * Serving sizes: what to offer, and how one turns into another.
 *
 * A food arrives with one or a few servings of its own ("1 large egg (50 g)",
 * "1 cup (240 ml)"). Once any of them knows its weight, every other size is a
 * matter of scaling by grams, so the add screen can also offer "100 g" and
 * "1 g" (type 150 and log 150 g), the alternatives an AI estimate suggested
 * ("1 dozen (600 g)"), and any size the user types in. A serving whose weight
 * is unknown stays as it is: nothing can be worked out from it, so only its
 * own label and figures are offered.
 *
 * Figures always scale from the serving being shown, so a figure corrected by
 * hand carries over when the size changes.
 */

import { formatQuantity, scaleNutrients } from './math.ts';
import type { Serving } from './types.ts';

/** A size without figures: what the AI suggests and what the user types. */
export interface ServingSize {
  label: string;
  /** Weight of one, in grams. Null when it truly is not known. */
  grams: number | null;
}

/** Generic sizes offered for any food whose weight is known. */
const GRAM_SIZES: readonly number[] = [100, 1];

/** Closer than this many grams counts as the same size, so "100 g" is not offered twice. */
const SAME_GRAMS = 0.5;

/** "100 g", "1 g", "2.5 g". */
export function gramsLabel(grams: number): string {
  return `${formatQuantity(grams)} g`;
}

/**
 * A size's label with its weight in brackets: "1 large egg (50 g)".
 *
 * A label that is already only a weight ("100 g") is left as it is, and one
 * that already carries a bracketed weight has it replaced, so editing the grams
 * of "1 egg (50 g)" to 60 gives "1 egg (60 g)" rather than "1 egg (50 g) (60 g)".
 */
export function withGrams(label: string, grams: number | null): string {
  const name = splitServingLabel(label).name;
  if (grams === null || !(grams > 0)) return name || label.trim();
  // "1 cup (240 ml)" already says how much; a second bracket would only repeat it.
  if (/\(\s*\d+(?:\.\d+)?\s*(?:ml|l|oz|kg|fl oz)\s*\)/i.test(name)) return name;
  if (!name || /^\d+(?:\.\d+)?\s*g$/i.test(name)) return gramsLabel(grams);
  return `${name} (${formatQuantity(grams)} g)`;
}

/** The other way round: "1 large egg (50 g)" to its name and weight, for prefilling an editor. */
export function splitServingLabel(label: string): { name: string; grams: number | null } {
  const trimmed = label.trim();
  const bracket = /^(.*?)\s*\((\d+(?:\.\d+)?)\s*g\)\s*$/i.exec(trimmed);
  if (bracket) return { name: bracket[1]!.trim(), grams: Number(bracket[2]) };
  const bare = /^(\d+(?:\.\d+)?)\s*g$/i.exec(trimmed);
  if (bare) return { name: '', grams: Number(bare[1]) };
  return { name: trimmed, grams: null };
}

/**
 * `from` at another size. Figures scale by weight when both weights are known;
 * otherwise they are kept as they are, which is right for renaming a serving
 * or for giving a weight to one that had none.
 */
export function servingAt(from: Serving, size: ServingSize, id: string = from.id): Serving {
  const scaled = from.grams && size.grams ? scaleNutrients(from.nutrients, size.grams / from.grams) : from.nutrients;
  return { id, label: size.label.trim() || from.label, grams: size.grams, nutrients: scaled };
}

function sameSize(a: { label: string; grams: number | null }, b: { label: string; grams: number | null }): boolean {
  if (a.grams !== null && b.grams !== null && Math.abs(a.grams - b.grams) < SAME_GRAMS) return true;
  return a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
}

/**
 * Every size to offer for a food: its own servings first, then `extra` (the
 * AI's alternatives, sizes the user added), then 100 g and 1 g. Extras and the
 * gram sizes are worked out from the first serving that knows its weight, and
 * left out when none does. Duplicates (same weight, or same label) are dropped,
 * first one wins.
 */
export function servingOptions(servings: readonly Serving[], extra: readonly ServingSize[] = []): Serving[] {
  const options: Serving[] = [...servings];
  const base = servings.find((s) => s.grams !== null && s.grams > 0);
  if (!base) return options;

  const add = (size: ServingSize, id: string) => {
    if (!size.grams || options.some((option) => sameSize(option, size))) return;
    options.push(servingAt(base, size, id));
  };
  extra.forEach((size, index) => add(size, `extra:${index}`));
  for (const grams of GRAM_SIZES) add({ label: gramsLabel(grams), grams }, `g:${grams}`);
  return options;
}

/** True for a size that is only a weight ("1 g", "100 g"), where the amount reads as grams. */
export function isGramServing(serving: { label: string }): boolean {
  return /^\d+(?:\.\d+)?\s*g$/i.test(serving.label.trim());
}

/**
 * How many of `to` weigh the same as `quantity` of `from`, so switching from
 * "2 × 1 egg (50 g)" to "1 g" reads 100 rather than 2. Unchanged when either
 * weight is unknown.
 */
export function convertQuantity(quantity: number, from: { grams: number | null }, to: { grams: number | null }): number {
  if (!from.grams || !to.grams) return quantity;
  return (quantity * from.grams) / to.grams;
}

/**
 * An amount as a person would say it: "150 g" for 150 of "1 g" (or 1.5 of
 * "100 g"), "2 × 1 large egg (50 g)", or just the label for one serving.
 */
export function describeAmount(item: { quantity: number; servingLabel: string }): string {
  const weight = /^(\d+(?:\.\d+)?)\s*g$/i.exec(item.servingLabel.trim());
  if (weight) return gramsLabel(item.quantity * Number(weight[1]));
  return item.quantity === 1 ? item.servingLabel : `${formatQuantity(item.quantity)} × ${item.servingLabel}`;
}
