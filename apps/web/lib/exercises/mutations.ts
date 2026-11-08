/**
 * Writes for custom exercises, with the phone's semantics
 * (`apps/mobile/src/features/exercises/repository.ts`).
 *
 * Only custom exercises sync. Built-ins are identical on every device and an
 * edit to one would never reach the phone, so nothing here touches them.
 */

import type { Equipment, MuscleGroup, TrackingType } from "@lift/shared";

import { remove, upsert, uuidv7, write } from "@/lib/data/mutate";
import type { ExerciseInfo, Model } from "@/lib/data/model";

export interface CustomExerciseInput {
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  trackingType: TrackingType;
  notes: string | null;
  defaultRestSeconds: number | null;
}

/** Returns a reason the name cannot be used, or null. Case-insensitive, like the phone. */
export function nameConflict(model: Model, name: string, exceptId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the exercise a name.";
  const lower = trimmed.toLowerCase();
  const clash = model.exerciseList.find((exercise) => exercise.id !== exceptId && exercise.name.toLowerCase() === lower);
  if (!clash) return null;
  return clash.isArchived ? `${clash.name} already exists, archived. Unarchive it instead.` : `${clash.name} already exists.`;
}

function clean(input: CustomExerciseInput) {
  return {
    name: input.name.trim(),
    equipment: input.equipment,
    primaryMuscle: input.primaryMuscle,
    // The primary is never also a secondary: the filter and the muscle counts would count it twice.
    secondaryMuscles: input.secondaryMuscles.filter((muscle) => muscle !== input.primaryMuscle),
    trackingType: input.trackingType,
    notes: input.notes?.trim() ? input.notes.trim() : null,
    defaultRestSeconds: input.defaultRestSeconds,
  };
}

export async function createCustomExercise(input: CustomExerciseInput): Promise<string> {
  const id = uuidv7();
  await write([
    upsert("exercises", {
      id,
      ...clean(input),
      isCustom: true,
      isArchived: false,
      imageUrl: null,
      // Null rather than today's unit setting: an exercise follows the app's
      // units until someone sets it explicitly on the phone.
      weightUnit: null,
      distanceUnit: null,
    }),
  ]);
  return id;
}

export async function updateCustomExercise(exercise: ExerciseInfo, input: CustomExerciseInput): Promise<void> {
  if (!exercise.isCustom || !exercise.row) return;
  await write([upsert("exercises", { id: exercise.id, ...clean(input) })]);
}

export async function setExerciseArchived(exercise: ExerciseInfo, isArchived: boolean): Promise<void> {
  if (!exercise.isCustom || !exercise.row) return;
  await write([upsert("exercises", { id: exercise.id, isArchived })]);
}

/** A tombstone, never a removal. Past sessions keep referring to the id. */
export async function deleteCustomExercise(exercise: ExerciseInfo): Promise<void> {
  if (!exercise.isCustom || !exercise.row) return;
  await write([remove("exercises", exercise.id)]);
}

/** True when any finished session logged this exercise: its tracking type is then locked. */
export function hasHistory(model: Model, exerciseId: string): boolean {
  return (model.sessionsByExercise.get(exerciseId)?.length ?? 0) > 0;
}
