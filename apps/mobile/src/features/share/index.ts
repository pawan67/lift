/**
 * Sending one routine, or one session, to another person's phone.
 *
 * This is deliberately not the backup format. A backup is every row the app
 * owns, keyed by this device's ids, written for the bad day: restoring one onto
 * a friend's phone would merge a stranger's entire training history into
 * theirs. A share is one thing, small enough to send in a chat, and it carries
 * no ids at all.
 *
 * ## Why it carries names and not ids
 *
 * An `exerciseId` means nothing on the other phone. Built-in catalog rows might
 * happen to line up; a custom exercise never will, and a routine importing
 * against a dangling id is a routine of blank rows. So the file spells every
 * exercise the way its owner sees it, and the receiving device runs the same
 * `planExercises` resolver an import from Strong or Hevy goes through: exact
 * match, then normalised match, then a custom exercise as a last resort. One
 * matching path, already proven against real files, rather than a second one
 * written for this.
 *
 * ## What a shared session is for
 *
 * Not a feed. Two people training together, where one logged the session and
 * the other should not have to type it in again. It lands in the receiver's log
 * as their own completed workout, awarded records and all, because they did
 * train it. That is why a session share rides `importWorkouts` rather than
 * getting a read-only viewer of its own.
 */

import { File, Paths } from 'expo-file-system';

import { commitExercises, planExercises } from '@/features/import/exercise-resolver';
import {
  createRoutineFromPrescription,
  getRoutineDetail,
  type PrescribedExercise,
} from '@/features/routines/repository';
import { getWorkoutDetail } from '@/features/workouts/repository';

import {
  envelope,
  routineAsImportedWorkout,
  slug,
  type SharedFile,
  type SharedRoutine,
} from './format';

export * from './format';

export async function buildRoutineShare(routineId: string): Promise<SharedFile> {
  const detail = await getRoutineDetail(routineId);
  if (!detail) throw new Error('That routine could not be read.');

  return {
    ...envelope(),
    kind: 'routine',
    routine: {
      name: detail.routine.name,
      notes: detail.routine.notes,
      exercises: detail.exercises.map((entry) => ({
        name: entry.exercise.name,
        notes: entry.routineExercise.notes,
        restSeconds: entry.routineExercise.restSeconds,
        supersetGroup: entry.routineExercise.supersetGroup,
        sets: entry.sets.map((set) => ({
          setType: set.setType,
          targetReps: set.targetReps,
          targetWeightKg: set.targetWeightKg,
          targetDurationSeconds: set.targetDurationSeconds,
          targetDistanceKm: set.targetDistanceKm,
          targetRpe: set.targetRpe,
        })),
      })),
    },
  };
}

export async function buildSessionShare(workoutId: string): Promise<SharedFile> {
  const detail = await getWorkoutDetail(workoutId);
  if (!detail) throw new Error('That workout could not be read.');

  const { workout } = detail;
  if (!workout.finishedAt) throw new Error('Finish this workout before sharing it.');

  const exercises = detail.exercises.flatMap((entry) => {
    // Completed sets only. A set left unticked was planned and not performed,
    // and sending it would have the receiver's log claim reps nobody did.
    const performed = entry.sets.filter((set) => set.isCompleted);
    if (performed.length === 0) return [];

    return [
      {
        name: entry.exercise.name,
        notes: entry.workoutExercise.notes,
        supersetGroup: entry.workoutExercise.supersetGroup,
        sets: performed.map((set) => ({
          setType: set.setType,
          weightKg: set.weightKg,
          reps: set.reps,
          durationSeconds: set.durationSeconds,
          distanceKm: set.distanceKm,
          rpe: set.rpe,
        })),
      },
    ];
  });

  if (exercises.length === 0) throw new Error('This session has no completed sets to share.');

  return {
    ...envelope(),
    kind: 'session',
    session: {
      name: workout.name,
      notes: workout.notes,
      startedAt: workout.startedAt.getTime(),
      finishedAt: workout.finishedAt.getTime(),
      durationSeconds: workout.durationSeconds,
      exercises,
    },
  };
}

/**
 * Writes a share to the cache directory and returns the file for the share
 * sheet.
 *
 * The name is the thing being shared rather than a timestamp, because it is
 * what the recipient sees in the chat before they open anything: "push-day-a"
 * is a reason to tap and "lift-share-2026-08-29" is not. Slugged rather than
 * passed through, since a routine can be called anything and a `/` in a
 * filename is not a filename.
 */
export async function writeShareFile(shared: SharedFile): Promise<File> {
  const label = shared.kind === 'routine' ? shared.routine.name : shared.session.name;
  const file = new File(Paths.cache, `${slug(label)}.lift.json`);

  // Overwrite so sharing the same routine twice doesn't fail.
  file.create({ overwrite: true });
  file.write(JSON.stringify(shared, null, 2));

  return file;
}

export interface SharedRoutineResult {
  name: string;
  exercises: number;
  sets: number;
  /** Names that had no library entry and were added as custom exercises. */
  added: string[];
}

/**
 * Writes a shared routine into the receiver's routines.
 *
 * Always a new routine, never a merge into one that happens to share a name.
 * Two people's "Push Day A" are not the same routine, and silently folding a
 * friend's prescription into the one you have been running is the single
 * change here nobody could undo.
 *
 * The exercises are committed before the routine rows that reference them, and
 * only after the plan is known: `planExercises` writes nothing, so a file that
 * fails to resolve leaves the library exactly as it found it.
 */
export async function importSharedRoutine(
  routine: SharedRoutine,
  picks?: ReadonlyMap<string, string>,
): Promise<SharedRoutineResult> {
  const plan = await planExercises([routineAsImportedWorkout(routine)], { picks });
  await commitExercises(plan);

  const exercises: PrescribedExercise[] = [];
  let position = 1;
  let sets = 0;

  for (const entry of routine.exercises) {
    const exerciseId = plan.idByName.get(entry.name.toLowerCase());
    // Unreachable in practice: the resolver either matches a name or invents a
    // row for it. Skipping rather than throwing means one unresolvable line
    // costs that line instead of the whole routine.
    if (!exerciseId) continue;

    exercises.push({
      exerciseId,
      position,
      notes: entry.notes,
      restSeconds: entry.restSeconds,
      supersetGroup: entry.supersetGroup,
      sets: entry.sets.map((set) => ({
        setType: set.setType as PrescribedExercise['sets'][number]['setType'],
        targetReps: set.targetReps,
        targetWeightKg: set.targetWeightKg,
        targetDurationSeconds: set.targetDurationSeconds,
        targetDistanceKm: set.targetDistanceKm,
        targetRpe: set.targetRpe,
      })),
    });

    sets += entry.sets.length;
    position += 1;
  }

  if (exercises.length === 0) throw new Error('That routine has no exercises to add.');

  const created = await createRoutineFromPrescription({
    name: routine.name,
    notes: routine.notes,
    exercises,
  });

  return { name: created.name, exercises: exercises.length, sets, added: plan.created };
}
