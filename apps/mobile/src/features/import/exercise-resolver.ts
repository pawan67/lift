/**
 * Getting imported exercise names onto rows in the library.
 *
 * This is where an import quietly succeeds or quietly ruins itself. A name that
 * fails to find its catalog entry creates a second exercise with the same
 * meaning, and from then on the user's bench press history is split in two:
 * across the progress chart, the records list and every muscle rollup: with
 * nothing on screen to explain why. So the matching runs in one pass over the
 * whole file rather than per row, and it is exact-then-normalised rather than
 * fuzzy: a near miss the user can pick from beats a confident wrong answer.
 */

import { uuidv7, type Equipment, type MuscleGroup, type TrackingType } from '@lift/shared';
import {
  collectExerciseNames,
  exerciseMatchKey,
  inferEquipment,
  inferMuscles,
  inferTrackingType,
  matchImportedName,
  buildImportMatchIndex,
  type ImportMatchCandidate,
  type ImportedSet,
  type ImportedWorkout,
} from '@lift/shared/import';
import { isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { trackUpsertMany } from '@/db/mutations';
import { exercises } from '@/db/schema';

export interface UnresolvedImportName {
  name: string;
  suggestions: ImportMatchCandidate[];
}

export interface ExercisePlan {
  /** Keyed by the lower-cased name as the file spelled it. */
  idByName: Map<string, string>;
  /**
   * Tracking type per resolved id.
   *
   * Carried out of here rather than re-read later because the importer needs it
   * for every set it values. It decides whether a rep counts as `weight ×
   * reps` or as bodyweight, and the read that produced the id already had it.
   */
  trackingTypeById: Map<string, TrackingType>;
  /** Names that found an existing library entry. */
  matched: string[];
  /** Names that did not. Rows for these are built but not yet written. */
  created: string[];
  /**
   * Names that missed an exact match but have catalog rows worth offering.
   *
   * Still in `created` until the user picks one of `suggestions`. Saving the
   * import as routines is what turns a pick into a library id, via `picks` on
   * the next `planExercises` call.
   */
  unresolved: UnresolvedImportName[];
  pending: NewCustomExercise[];
}

/**
 * Works out where every name in a file lands, writing nothing.
 *
 * Planning and committing are separate calls because the confirmation screen
 * has to be able to say "12 exercises will be added to your library" while the
 * user is still deciding. A resolver that created rows as it matched would make
 * that sentence a side effect: back out of the import and the library keeps the
 * twelve exercises anyway, attached to no history at all.
 */
export async function planExercises(
  workouts: readonly ImportedWorkout[],
  options: { picks?: ReadonlyMap<string, string> } = {},
): Promise<ExercisePlan> {
  const names = collectExerciseNames(workouts);
  const idByName = new Map<string, string>();
  const matched: string[] = [];
  const created: string[] = [];
  const unresolved: UnresolvedImportName[] = [];
  const pending: NewCustomExercise[] = [];

  if (names.length === 0) {
    return { idByName, trackingTypeById: new Map(), matched, created, unresolved, pending };
  }

  const { index, trackingTypeById } = await loadLibraryIndex();
  const setsByName = groupSetsByName(workouts);

  for (const name of names) {
    const key = name.toLowerCase();
    const picked = options.picks?.get(key);
    if (picked && trackingTypeById.has(picked)) {
      idByName.set(key, picked);
      matched.push(name);
      continue;
    }

    const decision = matchImportedName(name, index);

    if (decision.kind === 'hit') {
      idByName.set(key, decision.id);
      matched.push(name);
      continue;
    }

    if (decision.kind === 'ask') unresolved.push({ name, suggestions: decision.suggestions });

    const row = buildCustomExercise(name, setsByName.get(key) ?? []);
    pending.push(row);
    idByName.set(key, row.id);
    trackingTypeById.set(row.id, row.trackingType);
    created.push(name);

    // A file can spell the same exercise two ways: "Ab Wheel" and "Ab Wheels",
    // and both miss the catalog. Registering the new row against its own
    // normalised key means the second spelling finds the first rather than
    // creating a twin.
    index.byKey.set(exerciseMatchKey(name), {
      id: row.id,
      name: row.name,
      equipment: row.equipment,
    });
    index.byExact.set(key, { id: row.id, name: row.name, equipment: row.equipment });
  }

  return { idByName, trackingTypeById, matched, created, unresolved, pending };
}

/** Writes the exercises a plan invented. Safe to call with nothing pending. */
export async function commitExercises(plan: ExercisePlan): Promise<void> {
  if (plan.pending.length === 0) return;

  for (let i = 0; i < plan.pending.length; i += CHUNK_SIZE) {
    await db.insert(exercises).values(plan.pending.slice(i, i + CHUNK_SIZE));
  }

  // Custom exercises replicate; the history about to reference them would
  // arrive at the server pointing at nothing otherwise.
  await trackUpsertMany('exercises', plan.pending);
}

const CHUNK_SIZE = 50;

type NewCustomExercise = ReturnType<typeof buildCustomExercise>;

function buildCustomExercise(name: string, sets: ImportedSet[]) {
  const now = Date.now();
  const muscles = inferMuscles(name);

  return {
    id: uuidv7(),
    name: name.trim(),
    equipment: inferEquipment(name) as Equipment,
    // Nothing in an export says which muscle a lift trains, so this reads it
    // off the name, and only where the catalog's own rows for that movement
    // agree on the answer. Everything else keeps `other`: visibly unset is the
    // state that gets corrected, where a plausible wrong muscle is the state
    // that silently skews the body map. The reason it guesses at all is that
    // `other` is not neutral either. It is absent from the body map and from
    // every muscle rollup, so a file that lands mostly here reads as an import
    // that half worked.
    primaryMuscle: muscles.primary as MuscleGroup,
    secondaryMuscles: muscles.secondary as MuscleGroup[],
    trackingType: inferTrackingType(name, sets) as TrackingType,
    isCustom: true as const,
    notes: null,
    imageUrl: null,
    thumbnailUrl: null,
    videoUrl: null,
    isArchived: false,
    defaultRestSeconds: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };
}

/**
 * Two lookups over the library, built in one read.
 *
 * The catalog is ~6,800 rows and this pulls two columns of it, which is the
 * same read the exercise picker already makes on open. Doing it once here is
 * the whole reason the resolver takes the file rather than a name.
 */
async function loadLibraryIndex(): Promise<{
  index: ReturnType<typeof buildImportMatchIndex>;
  trackingTypeById: Map<string, TrackingType>;
}> {
  const rows = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      equipment: exercises.equipment,
      trackingType: exercises.trackingType,
    })
    .from(exercises)
    .where(isNull(exercises.deletedAt));

  const trackingTypeById = new Map<string, TrackingType>();
  const candidates: ImportMatchCandidate[] = [];

  for (const row of rows) {
    trackingTypeById.set(row.id, row.trackingType);
    candidates.push({ id: row.id, name: row.name, equipment: row.equipment });
  }

  return { index: buildImportMatchIndex(candidates), trackingTypeById };
}

/** Every set logged against each name, so a created exercise can be typed from its data. */
function groupSetsByName(workouts: readonly ImportedWorkout[]): Map<string, ImportedSet[]> {
  const byName = new Map<string, ImportedSet[]>();

  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      const key = exercise.name.toLowerCase();
      const bucket = byName.get(key);
      if (bucket) bucket.push(...exercise.sets);
      else byName.set(key, [...exercise.sets]);
    }
  }

  return byName;
}
