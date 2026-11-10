/**
 * What a food can carry, and how each figure is labelled and rounded.
 *
 * Every nutrient value in the app and on the server is a plain map from a key
 * to a number, `NutrientValues`. The built-in keys are listed below; a custom
 * nutrient the user defines is keyed by its own id, which is a UUID and so can
 * never collide with a built-in name. One map rather than a column per figure
 * is what lets a user add "caffeine" or "omega-3" without a migration, and lets
 * the AI estimate fill whichever of them it can.
 *
 * Values are always per one serving of whatever they are attached to. An entry
 * stores the serving's figures and a quantity, and the logged amount is the
 * product, worked out by `scaleNutrients`.
 */

export const NUTRIENT_GROUPS = ['energy', 'macros', 'fats', 'carbs', 'minerals', 'vitamins', 'custom'] as const;
export type NutrientGroup = (typeof NUTRIENT_GROUPS)[number];

export const NUTRIENT_GROUP_LABELS: Record<NutrientGroup, string> = {
  energy: 'Energy',
  macros: 'Macros',
  fats: 'Fats',
  carbs: 'Carbohydrates',
  minerals: 'Minerals',
  vitamins: 'Vitamins',
  custom: 'Your nutrients',
};

export interface NutrientDefinition {
  key: string;
  label: string;
  /** Short label for tight spaces such as a macro bar. */
  short: string;
  unit: 'kcal' | 'g' | 'mg' | 'µg';
  group: NutrientGroup;
  /** Decimal places worth showing. Nobody needs a tenth of a calorie. */
  decimals: number;
}

export const BUILT_IN_NUTRIENTS = [
  { key: 'calories', label: 'Calories', short: 'kcal', unit: 'kcal', group: 'energy', decimals: 0 },
  { key: 'protein', label: 'Protein', short: 'P', unit: 'g', group: 'macros', decimals: 1 },
  { key: 'carbs', label: 'Carbs', short: 'C', unit: 'g', group: 'macros', decimals: 1 },
  { key: 'fat', label: 'Fat', short: 'F', unit: 'g', group: 'macros', decimals: 1 },
  { key: 'saturatedFat', label: 'Saturated fat', short: 'Sat', unit: 'g', group: 'fats', decimals: 1 },
  { key: 'monounsaturatedFat', label: 'Monounsaturated fat', short: 'Mono', unit: 'g', group: 'fats', decimals: 1 },
  { key: 'polyunsaturatedFat', label: 'Polyunsaturated fat', short: 'Poly', unit: 'g', group: 'fats', decimals: 1 },
  { key: 'transFat', label: 'Trans fat', short: 'Trans', unit: 'g', group: 'fats', decimals: 1 },
  { key: 'cholesterol', label: 'Cholesterol', short: 'Chol', unit: 'mg', group: 'fats', decimals: 0 },
  { key: 'fiber', label: 'Fiber', short: 'Fiber', unit: 'g', group: 'carbs', decimals: 1 },
  { key: 'sugar', label: 'Sugar', short: 'Sugar', unit: 'g', group: 'carbs', decimals: 1 },
  { key: 'addedSugar', label: 'Added sugar', short: 'Added', unit: 'g', group: 'carbs', decimals: 1 },
  { key: 'sodium', label: 'Sodium', short: 'Na', unit: 'mg', group: 'minerals', decimals: 0 },
  { key: 'potassium', label: 'Potassium', short: 'K', unit: 'mg', group: 'minerals', decimals: 0 },
  { key: 'calcium', label: 'Calcium', short: 'Ca', unit: 'mg', group: 'minerals', decimals: 0 },
  { key: 'iron', label: 'Iron', short: 'Fe', unit: 'mg', group: 'minerals', decimals: 1 },
  { key: 'magnesium', label: 'Magnesium', short: 'Mg', unit: 'mg', group: 'minerals', decimals: 0 },
  { key: 'vitaminA', label: 'Vitamin A', short: 'Vit A', unit: 'µg', group: 'vitamins', decimals: 0 },
  { key: 'vitaminC', label: 'Vitamin C', short: 'Vit C', unit: 'mg', group: 'vitamins', decimals: 1 },
  { key: 'vitaminD', label: 'Vitamin D', short: 'Vit D', unit: 'µg', group: 'vitamins', decimals: 1 },
  { key: 'vitaminB12', label: 'Vitamin B12', short: 'B12', unit: 'µg', group: 'vitamins', decimals: 1 },
] as const satisfies readonly NutrientDefinition[];

export type BuiltInNutrientKey = (typeof BUILT_IN_NUTRIENTS)[number]['key'];

export const BUILT_IN_NUTRIENT_KEYS: readonly BuiltInNutrientKey[] = BUILT_IN_NUTRIENTS.map((n) => n.key);

/** The four figures every food must have and every screen shows. */
export const CORE_NUTRIENT_KEYS = ['calories', 'protein', 'carbs', 'fat'] as const;
export type CoreNutrientKey = (typeof CORE_NUTRIENT_KEYS)[number];

/** Built-in keys, or a custom nutrient's id. Absent means "not known", never zero. */
export type NutrientValues = Record<string, number>;

const BY_KEY = new Map<string, NutrientDefinition>(BUILT_IN_NUTRIENTS.map((n) => [n.key, n]));

export function isBuiltInNutrient(key: string): key is BuiltInNutrientKey {
  return BY_KEY.has(key);
}

/** A nutrient the user added. Its `id` is the key its values are stored under. */
export interface CustomNutrient {
  id: string;
  name: string;
  /** Free text: "mg", "g", "IU", "cups". Only ever displayed. */
  unit: string;
  createdAt: number;
}

/**
 * Every nutrient this user can see, built-ins first, as one list of
 * definitions, so a screen renders custom ones with the same code path.
 */
export function nutrientDefinitions(custom: readonly CustomNutrient[]): NutrientDefinition[] {
  return [
    ...BUILT_IN_NUTRIENTS,
    ...custom.map((c) => ({
      key: c.id,
      label: c.name,
      short: c.name,
      // Custom units are free text; the narrow union is only for built-ins.
      unit: c.unit as NutrientDefinition['unit'],
      group: 'custom' as const,
      decimals: 1,
    })),
  ];
}

export function nutrientDefinition(
  key: string,
  custom: readonly CustomNutrient[] = [],
): NutrientDefinition | null {
  const builtIn = BY_KEY.get(key);
  if (builtIn) return builtIn;
  const c = custom.find((n) => n.id === key);
  return c
    ? { key: c.id, label: c.name, short: c.name, unit: c.unit as NutrientDefinition['unit'], group: 'custom', decimals: 1 }
    : null;
}

/** Calories per gram of each macro, for the energy split and the macro-percent goals. */
export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;
