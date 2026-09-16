/**
 * Lining today's sets up with last session's, and committing what that pairing
 * promises.
 *
 * The pairing was written twice: once in the exercise block, to fill the
 * Previous column, and once in the logging screen, to decide which numbers a
 * bare check-off commits. They have to be the same function or the app offers
 * one set as a placeholder and writes another, which is the worst failure this
 * screen has: a number the user never lifted, in the column they trust to be a
 * record of what happened. Now there is one of each, and the editor for a
 * finished session reads them too.
 */

import {
  TRACKING_FIELDS,
  USES_BODYWEIGHT,
  isWorkingSet,
  type SetType,
  type TrackingType,
} from '@lift/shared';

import type { WorkoutSet } from '@/db/schema';

import type { SetInput } from './repository';

export interface SetRowModel<T = WorkoutSet> {
  set: T;
  /** 1-based ordinal among working sets; a warm-up carries the count so far. */
  workingIndex: number;
  /** The set that occupied this ordinal last session, if there was one. */
  previous: WorkoutSet | undefined;
}

/**
 * Lines today's sets up with last session's, by ordinal **within set class**.
 *
 * Pairing by raw array position compares today's first working set against last
 * week's second warm-up the moment the two sessions disagree about how many
 * warm-ups they had (which is most of the time) and everything downstream of
 * the pairing goes quietly wrong with it: the Previous column, the placeholder
 * built from it, and any warm-up ramp that reads the same numbers later.
 *
 * A class that runs out has no partner and is left undefined. Repeating the
 * last set to fill the gap would put a number the user never lifted in front of
 * them.
 *
 * Warm-ups don't consume a working-set number either, so the ordinal shown in
 * the set column is counted here rather than taken from the array index.
 *
 * Generic in the left-hand side because the rows being paired are not always
 * `workoutSets`: starting a session from a routine pairs the routine's
 * *targets* against the same history, so that a prescription only fills a slot
 * history cannot. Anything carrying a `setType` is enough to walk.
 */
export function pairWithPrevious<T extends { setType: SetType }>(
  sets: readonly T[],
  previousSets: readonly WorkoutSet[],
): SetRowModel<T>[] {
  const previousWorking = previousSets.filter((set) => isWorkingSet(set.setType));
  const previousWarmups = previousSets.filter((set) => !isWorkingSet(set.setType));

  let working = 0;
  let warmup = 0;

  return sets.map((set) => {
    if (isWorkingSet(set.setType)) {
      working += 1;
      return { set, workingIndex: working, previous: previousWorking[working - 1] };
    }

    warmup += 1;
    return { set, workingIndex: working, previous: previousWarmups[warmup - 1] };
  });
}

/**
 * Last session's counterpart to one set, paired exactly as the block displays
 * it: the same walk as `pairWithPrevious`, stopped at the row in question.
 *
 * Undefined when today has more sets of a class than last time did. There is no
 * "repeat the last one" fallback: a fifth set has no counterpart, and inventing
 * one would put a number under the check that was never performed.
 */
export function pairedPreviousSet(
  sets: readonly WorkoutSet[],
  previousSets: readonly WorkoutSet[] | undefined,
  set: WorkoutSet,
): WorkoutSet | undefined {
  if (!previousSets || previousSets.length === 0) return undefined;

  const working = isWorkingSet(set.setType);
  const sameClass = (candidate: WorkoutSet) => isWorkingSet(candidate.setType) === working;

  let ordinal = 0;
  for (const row of sets) {
    if (row.id === set.id) break;
    if (sameClass(row)) ordinal += 1;
  }

  return previousSets.filter(sameClass)[ordinal];
}

/**
 * The numbers a bare check-off commits, for `updateSet`'s `fill` argument.
 *
 * The weight and reps fields show last session's numbers as placeholders, so
 * "same as last week, tap the check": the most common gesture in the app.
 * Used to complete a set holding two nulls: no volume, no PR, and a summary
 * that quietly disagreed with what happened. This is what the tap writes.
 *
 * It belongs in `fill` rather than in the patch, so `updateSet` writes it as
 * COALESCE and a column that already holds a number keeps it: the set the
 * caller is looking at is a render-old snapshot of a live query, and a weight
 * typed a moment ago may still be in flight. SQLite decides against storage, at
 * the moment the statement runs.
 *
 * `weightCleared` is the one thing this cannot see for itself. A field the user
 * emptied by hand and one never touched are the same null in the row, but only
 * the untouched one means "same as last time", and only on the tracking types
 * where an empty box is itself a fact: "no belt" on weighted work, "no
 * assistance" on assisted. On a barbell lift it means nothing at all, so the
 * placeholder's promise stands whether or not the box was touched.
 */
export function ghostFill(
  trackingType: TrackingType,
  previous: WorkoutSet | undefined,
  weightCleared = false,
): SetInput {
  const fill: SetInput = {};
  if (!previous) return fill;

  const fields = TRACKING_FIELDS[trackingType];
  const clearedOnPurpose = weightCleared && USES_BODYWEIGHT.has(trackingType);

  if (fields.weight && !clearedOnPurpose) fill.weightKg = previous.weightKg;
  if (fields.reps) fill.reps = previous.reps;
  if (fields.duration) fill.durationSeconds = previous.durationSeconds;
  if (fields.distance) fill.distanceKm = previous.distanceKm;

  return fill;
}
