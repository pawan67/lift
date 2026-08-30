/**
 * Turning identified CSV sessions into routines on this device.
 *
 * Detection is pure and lives in `@lift/shared/import`. This half matches
 * names to the library, skips titles that already exist as routines, and
 * writes through `createRoutineFromPrescription` so a second writer cannot
 * disagree with share-import on set order or one-exercise supersets.
 */

import { identifyRoutines, type ImportedWorkout } from '@lift/shared/import';
import { isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { routines } from '@/db/schema';
import { commitExercises, planExercises } from '@/features/import/exercise-resolver';
import {
  createRoutineFromPrescription,
  type PrescribedExercise,
} from '@/features/routines/repository';

export { identifyRoutines };

/** Lower-cased names of non-deleted routines on this device. */
export async function loadExistingRoutineKeys(): Promise<Set<string>> {
  const rows = await db
    .select({ name: routines.name })
    .from(routines)
    .where(isNull(routines.deletedAt));

  return new Set(rows.map((row) => row.name.trim().toLowerCase()).filter(Boolean));
}

export interface ImportedRoutineResult {
  name: string;
  exercises: number;
  sets: number;
}

export interface ImportRoutinesSummary {
  created: ImportedRoutineResult[];
  /** Titles skipped because a routine of that name already existed. */
  skipped: string[];
}

export interface RoutineToCreate {
  /** Name to write. May have been renamed in the picker. */
  name: string;
  workout: ImportedWorkout;
}

/**
 * Writes each selected session as a new routine.
 *
 * Always additive: a name that already exists is skipped rather than merged.
 * Exercises are planned against the library as it stands after the workout
 * import, so custom names created a moment ago resolve to those rows.
 */
export async function importIdentifiedRoutines(
  selected: readonly RoutineToCreate[],
  picks?: ReadonlyMap<string, string>,
): Promise<ImportRoutinesSummary> {
  const summary: ImportRoutinesSummary = { created: [], skipped: [] };
  if (selected.length === 0) return summary;

  const existing = await loadExistingRoutineKeys();

  for (const entry of selected) {
    const name = entry.name.trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (existing.has(key)) {
      summary.skipped.push(name);
      continue;
    }

    const plan = await planExercises([entry.workout], { picks });
    await commitExercises(plan);

    const exercises: PrescribedExercise[] = [];
    let position = 1;
    let sets = 0;

    for (const block of entry.workout.exercises) {
      const exerciseId = plan.idByName.get(block.name.toLowerCase());
      if (!exerciseId || block.sets.length === 0) continue;

      exercises.push({
        exerciseId,
        position,
        notes: block.notes,
        restSeconds: null,
        supersetGroup: block.supersetGroup,
        sets: block.sets.map((set) => ({
          setType: set.setType,
          targetReps: set.reps,
          targetWeightKg: set.weightKg,
          targetDurationSeconds: set.durationSeconds,
          targetDistanceKm: set.distanceKm,
          targetRpe: set.rpe,
        })),
      });

      sets += block.sets.length;
      position += 1;
    }

    if (exercises.length === 0) continue;

    const created = await createRoutineFromPrescription({
      name,
      notes: entry.workout.notes,
      exercises,
    });

    existing.add(key);
    summary.created.push({ name: created.name, exercises: exercises.length, sets });
  }

  return summary;
}
