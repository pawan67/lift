/**
 * Matching imported exercise names to the library, and describing the ones that
 * miss.
 *
 * Both halves are pure so they can be tested, but only the first is interesting:
 * an import that fails to recognise "Bench Press (Barbell)" as the catalog's
 * bench press creates a duplicate custom exercise, and from then on the user's
 * history is split across two rows that no screen will ever add back together.
 */

import type { Equipment, MuscleGroup, TrackingType } from '../types.ts';
import type { ImportedSet } from './parse.ts';

/**
 * A name reduced to something two apps can agree on.
 *
 * The three differences that actually show up between catalogs are word order
 * ("Barbell Bench Press" against "Bench Press (Barbell)"), punctuation
 * ("Bent-Over Row", "Seated Row - V Grip") and plurals ("Push Ups"). Sorting
 * the tokens handles the first, stripping non-letters the second, and a
 * conservative singular the third. Conservative because it only has to be
 * *consistent*, not correct: both sides run through the same function, so
 * "triceps" collapsing to "tricep" matches as long as it always does.
 *
 * Nothing here is fuzzy. A near-miss creating a custom exercise is a row the
 * user can see and merge; a fuzzy hit filing squats under front squats is a
 * silent corruption of their history.
 */
export function exerciseMatchKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singular);

  return [...new Set(tokens)].sort().join(' ');
}

/** `curls` → `curl`, but `press` and `cross` are left alone. */
function singular(token: string): string {
  // Three letters is not too short to matter: `ups` is the second half of the
  // most common bodyweight exercise there is.
  if (token.length <= 2) return token;
  if (token.endsWith('ss') || token.endsWith('us') || token.endsWith('is')) return token;
  return token.endsWith('s') ? token.slice(0, -1) : token;
}

// ---------------------------------------------------------------------------
// Guessing the muscle
// ---------------------------------------------------------------------------

/** The muscles a name admits to, in the shape a custom exercise row wants. */
export interface InferredMuscles {
  primary: MuscleGroup;
  secondary: MuscleGroup[];
}

/**
 * Movement words that name their own muscle, longest phrase first.
 *
 * Every row here was read off the catalog rather than reasoned about: the
 * assignment is the one the catalog's own entry for that movement uses, and a
 * phrase only earns a row when the catalog's rows containing it agree. "Calf
 * raise" is 99% calves across 82 rows, so it is here. "Fly" splits 42% chest
 * against 32% shoulders, so it is not, and names built on it keep `other`.
 *
 * Longest first is doing real work in three places. "Leg curl" is hamstrings
 * and would otherwise be caught by the bare "curl" as biceps; "upright row" is
 * shoulders, not the upper back every other row is; "split squat" is quads
 * where a plain squat is glutes. A shorter phrase placed above a longer one it
 * is a substring of silently steals every name the longer one exists for, so
 * the order of this list is the whole of its correctness.
 */
const MUSCLE_WORDS: [string, MuscleGroup, MuscleGroup[]][] = [
  // Arms. Every one of these has to outrank the bare "curl" at the bottom.
  ['overhead triceps extension', 'triceps', []],
  ['triceps extension', 'triceps', []],
  ['tricep extension', 'triceps', []],
  ['close grip bench', 'triceps', ['shoulders', 'chest']],
  ['skull crusher', 'triceps', []],
  ['skullcrusher', 'triceps', []],
  ['triceps dip', 'triceps', ['chest', 'shoulders']],
  ['tricep dip', 'triceps', ['chest', 'shoulders']],
  ['pushdown', 'triceps', []],
  ['push down', 'triceps', []],
  ['pressdown', 'triceps', []],
  ['kickback', 'triceps', []],
  ['triceps', 'triceps', []],
  ['tricep', 'triceps', []],
  ['wrist curl', 'forearms', []],
  ['reverse curl', 'forearms', ['biceps']],
  ['wrist extension', 'forearms', []],
  ['farmer', 'forearms', ['traps']],
  ['hammer curl', 'biceps', ['forearms']],
  ['preacher curl', 'biceps', ['forearms']],
  ['bicep', 'biceps', []],

  // Legs and hips. "Split squat" and "hack squat" both outrank "squat".
  ['leg curl', 'hamstrings', ['glutes']],
  ['hamstring curl', 'hamstrings', ['glutes']],
  ['leg extension', 'quads', []],
  ['calf raise', 'calves', []],
  ['calf press', 'calves', []],
  ['romanian deadlift', 'glutes', ['hamstrings', 'lower_back']],
  ['stiff leg deadlift', 'glutes', ['hamstrings', 'lower_back']],
  ['deadlift', 'glutes', ['hamstrings', 'quads', 'lower_back']],
  ['good morning', 'glutes', ['hamstrings', 'lower_back']],
  ['hip thrust', 'glutes', ['hamstrings']],
  ['glute bridge', 'glutes', ['hamstrings', 'quads']],
  ['hip abduction', 'abductors', ['glutes']],
  ['hip adduction', 'adductors', []],
  ['split squat', 'quads', ['glutes', 'hamstrings']],
  ['hack squat', 'quads', ['hamstrings', 'glutes']],
  ['squat', 'glutes', ['quads', 'calves']],
  ['lunge', 'quads', ['hamstrings', 'glutes']],
  ['leg press', 'glutes', ['quads', 'calves']],
  ['step up', 'quads', ['glutes', 'hamstrings']],
  ['back extension', 'lower_back', ['glutes', 'hamstrings']],
  ['hyperextension', 'lower_back', ['glutes', 'hamstrings']],

  // Back. "Rowing machine" is cardio and has to outrank the bare "row".
  ['rowing machine', 'cardio', []],
  ['upright row', 'shoulders', ['traps']],
  ['pulldown', 'lats', ['biceps', 'upper_back']],
  ['pull down', 'lats', ['biceps', 'upper_back']],
  ['pullover', 'lats', ['chest', 'triceps']],
  ['pull up', 'lats', ['biceps', 'upper_back', 'forearms']],
  ['pullup', 'lats', ['biceps', 'upper_back', 'forearms']],
  ['chin up', 'lats', ['biceps', 'upper_back', 'forearms']],
  ['chinup', 'lats', ['biceps', 'upper_back', 'forearms']],
  ['shrug', 'traps', []],

  // Chest and shoulders.
  ['bench press', 'chest', ['shoulders', 'triceps']],
  ['chest press', 'chest', ['shoulders', 'triceps']],
  ['pec deck', 'chest', ['shoulders']],
  ['push up', 'chest', ['triceps', 'shoulders']],
  ['pushup', 'chest', ['triceps', 'shoulders']],
  ['press up', 'chest', ['triceps', 'shoulders']],
  ['chest dip', 'chest', ['shoulders', 'triceps']],
  ['lateral raise', 'shoulders', []],
  ['side raise', 'shoulders', []],
  ['front raise', 'shoulders', []],
  ['rear delt', 'shoulders', ['upper_back']],
  ['face pull', 'shoulders', ['upper_back']],
  ['overhead press', 'shoulders', ['triceps']],
  ['shoulder press', 'shoulders', ['triceps']],
  ['military press', 'shoulders', ['triceps']],
  ['arnold press', 'shoulders', ['triceps']],
  ['push press', 'shoulders', ['triceps']],

  // Core.
  ['russian twist', 'obliques', ['abs']],
  ['side bend', 'obliques', []],
  ['woodchop', 'obliques', ['abs']],
  ['wood chop', 'obliques', ['abs']],
  ['oblique', 'obliques', ['abs']],
  ['leg raise', 'abs', []],
  ['knee raise', 'abs', []],
  ['ab wheel', 'abs', []],
  ['rollout', 'abs', []],
  ['crunch', 'abs', []],
  ['sit up', 'abs', []],
  ['situp', 'abs', []],
  ['plank', 'abs', []],
  ['hollow hold', 'abs', []],

  // Cardio.
  ['treadmill', 'cardio', []],
  ['elliptical', 'cardio', []],
  ['stair climber', 'cardio', []],
  ['stairmaster', 'cardio', []],
  ['jump rope', 'cardio', []],
  ['skipping', 'cardio', []],
  ['running', 'cardio', []],
  ['jogging', 'cardio', []],
  ['sprint', 'cardio', []],
  ['cycling', 'cardio', []],
  ['swimming', 'cardio', []],
  ['walking', 'cardio', []],
  ['cardio', 'cardio', []],

  // Bare movement words, last so every phrase above wins first.
  ['curl', 'biceps', []],
  ['row', 'upper_back', ['lats', 'biceps']],
  ['dip', 'triceps', ['chest', 'shoulders']],
];

/**
 * The table above compiled once, whole-word and plural-tolerant.
 *
 * Whole-word because `inferEquipment`-style substring matching files "Medicine
 * Ball Throw" under the upper back: "throw" contains "row". The optional `es?`
 * rides on the end of the phrase rather than each word because that is where
 * exporters put it, so "Calf Raises", "Push Ups" and "Crunches" all reach the
 * singular rows the catalog was read for.
 */
const MUSCLE_PATTERNS: [RegExp, MuscleGroup, MuscleGroup[]][] = MUSCLE_WORDS.map(
  ([word, primary, secondary]) => [new RegExp(`\\b${word}(e?s)?\\b`), primary, secondary],
);

/**
 * The muscles an exercise title admits to, or `other`.
 *
 * This runs only for a name that missed the whole catalog, which is the point
 * at which the alternative is not "a better guess" but no muscle at all. An
 * exercise on `other` is absent from the body map, contributes to no muscle
 * rollup and is invisible to the muscle filter, so a file full of them reads
 * as an import that half worked.
 *
 * It stays a keyword table rather than anything cleverer for the reason the
 * matcher above is not fuzzy: a phrase either names its muscle outright or it
 * gets `other`, and `other` is still the answer for most of what lands here.
 * "Ring Row" is a row and resolves; "Jefferson Curl" is not a curl and is
 * exactly the kind of name this gets wrong, which is the trade accepted by
 * putting the bare words last and keeping the list to movements rather than
 * equipment or body parts.
 */
export function inferMuscles(name: string): InferredMuscles {
  const text = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ');

  for (const [pattern, primary, secondary] of MUSCLE_PATTERNS) {
    if (pattern.test(text)) return { primary, secondary: [...secondary] };
  }

  return { primary: 'other', secondary: [] };
}

// ---------------------------------------------------------------------------
// Describing an unmatched exercise
// ---------------------------------------------------------------------------

/**
 * Equipment names as they appear in exercise titles, longest first.
 *
 * Longest first is what makes "Smith Machine Row" a smith machine rather than a
 * machine. A plain `Object.entries` walk would hit whichever key came first.
 */
const EQUIPMENT_WORDS: [string, Equipment][] = [
  ['smith machine', 'smith_machine'],
  ['resistance band', 'resistance_band'],
  ['medicine ball', 'medicine_ball'],
  ['cardio machine', 'cardio_machine'],
  ['weight plate', 'plate'],
  ['bodyweight', 'bodyweight'],
  ['kettlebell', 'kettlebell'],
  ['suspension', 'suspension'],
  ['dumbbell', 'dumbbell'],
  ['barbell', 'barbell'],
  ['lever', 'machine'],
  ['sled', 'machine'],
  ['machine', 'machine'],
  ['med ball', 'medicine_ball'],
  ['smith', 'smith_machine'],
  ['cable', 'cable'],
  ['plate', 'plate'],
  ['band', 'resistance_band'],
  ['trx', 'suspension'],
];

/**
 * The equipment an exercise title admits to, or `other`.
 *
 * Hevy and Lyfta both suffix the equipment in parentheses, so this is right far
 * more often than it looks, and when it is wrong the cost is one field on a
 * custom exercise the user can edit, not a mis-filed set.
 */
export function inferEquipment(name: string): Equipment {
  const text = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ');

  for (const [word, equipment] of EQUIPMENT_WORDS) {
    if (text.includes(word)) return equipment;
  }

  return 'other';
}

/**
 * What the sets say the exercise measures.
 *
 * This is the single most consequential field on a created exercise: it decides
 * which inputs the set row renders and how volume is derived, so getting it
 * wrong means the logger asks for a weight on a plank forever after.
 *
 * The rule that earns its keep is the last one about weights. A weight column
 * full of zeroes is an exporter saying "this is a bodyweight movement".
 * Hevy writes exactly that for push-ups, whereas *no* weight column at all
 * says nothing, and guessing bodyweight there would value every set at the
 * lifter's weight on no evidence. That case gets `reps_only`, which counts the
 * reps and claims no volume.
 */
export function inferTrackingType(name: string, sets: readonly ImportedSet[]): TrackingType {
  const hasReps = sets.some((set) => set.reps !== null);
  const hasDuration = sets.some((set) => set.durationSeconds !== null);
  const hasDistance = sets.some((set) => set.distanceKm !== null);
  const hasWeightColumn = sets.some((set) => set.weightKg !== null);
  const hasLoad = sets.some((set) => (set.weightKg ?? 0) > 0);

  if (hasDistance) {
    if (hasLoad) return 'weight_distance';
    return 'distance_duration';
  }

  const text = name.toLowerCase();
  if (hasReps && text.includes('assisted')) return 'assisted_bodyweight';
  if (hasReps && (text.includes('weighted') || inferEquipment(name) === 'bodyweight')) {
    return hasLoad ? 'weighted_bodyweight' : 'bodyweight_reps';
  }

  if (hasReps && hasLoad) return 'weight_reps';
  if (hasReps && hasWeightColumn) return 'bodyweight_reps';
  if (hasReps) return 'reps_only';
  if (hasDuration) return 'duration';

  return 'weight_reps';
}
