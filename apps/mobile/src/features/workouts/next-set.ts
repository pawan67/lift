/**
 * The set the user is about to do, and how to say it in one line.
 *
 * Two surfaces read this and they must never disagree. The set row it names is
 * drawn with the focus outline, and the docked rest bar names the same set
 * while the countdown runs, so the line under the clock is a description of the
 * row with the outline on it rather than a second guess at it.
 */

import {
  formatDistance,
  formatDuration,
  formatWeight,
  isWorkingSet,
  TRACKING_FIELDS,
} from '@lift/shared';

import type { WorkoutSet } from '@/db/schema';
import type { DisplayUnits } from '@/features/exercises/units';

import type { LiftUnit } from './lift-units';
import type { WorkoutExerciseDetail } from './repository';

export interface NextSet {
  detail: WorkoutExerciseDetail;
  set: WorkoutSet;
}

/**
 * The first set in a unit that is not checked off.
 *
 * For a lone lift that is simply the first open row. A superset is worked in
 * rounds, one set of each member in turn, so the next set is the one in the
 * earliest round that still has an open set, and the earlier member within that
 * round. Reading the members one after another instead would send the outline
 * through every set of the first exercise before it ever reached the second,
 * which is not how anybody performs a pair.
 *
 * Checked-off sets further down are ignored rather than treated as the place to
 * resume from. A skipped row is still the next thing to do; a user who meant to
 * drop it deletes it.
 */
export function nextOpenSet(unit: LiftUnit): NextSet | undefined {
  let best: (NextSet & { round: number }) | undefined;

  for (const detail of unit.members) {
    const round = detail.sets.findIndex((set) => !set.isCompleted);
    if (round === -1) continue;
    if (best === undefined || round < best.round) {
      best = { detail, set: detail.sets[round]!, round };
    }
  }

  return best && { detail: best.detail, set: best.set };
}

/**
 * The next set as the rest bar prints it: "Set 3 · 30 kg × 10".
 *
 * Figures are what the check-off will commit: the row's own numbers where it
 * has them, and last session's where it does not, because a bare tap writes
 * the ghost (`ghostFill`). Naming any other number here would describe a set
 * the tap does not log.
 *
 * `sameExercise` swaps the set's ordinal for the exercise's name. Mid-lift the
 * name is already on screen and the ordinal is what moves; across a hand-off to
 * the next lift, "Set 1" on its own says nothing about which bar to walk to.
 */
export function describeNextSet(
  next: NextSet,
  previous: WorkoutSet | undefined,
  units: DisplayUnits,
  sameExercise: boolean,
): string {
  const { detail, set } = next;
  const fields = TRACKING_FIELDS[detail.exercise.trackingType];
  const parts: string[] = [];

  const weightKg = set.weightKg ?? previous?.weightKg ?? null;
  const durationSeconds = set.durationSeconds ?? previous?.durationSeconds ?? null;
  const distanceKm = set.distanceKm ?? previous?.distanceKm ?? null;
  const reps = set.reps ?? previous?.reps ?? null;

  if (fields.weight && weightKg != null && weightKg > 0) {
    parts.push(formatWeight(weightKg, units.weightUnit));
  }
  if (fields.duration && durationSeconds != null) parts.push(formatDuration(durationSeconds));
  if (fields.distance && distanceKm != null) {
    parts.push(formatDistance(distanceKm, units.distanceUnit));
  }
  if (fields.reps && reps != null) {
    parts.push(parts.length > 0 ? `× ${reps}` : `${reps} ${reps === 1 ? 'rep' : 'reps'}`);
  }

  const who = sameExercise ? setOrdinal(detail.sets, set) : detail.exercise.name;
  return parts.length > 0 ? `${who} · ${parts.join(' ')}` : who;
}

/** "Set 3", counting working sets only, or "Warm-up". The row's own naming rule. */
function setOrdinal(sets: readonly WorkoutSet[], set: WorkoutSet): string {
  if (!isWorkingSet(set.setType)) return 'Warm-up';

  let ordinal = 0;
  for (const row of sets) {
    if (isWorkingSet(row.setType)) ordinal += 1;
    if (row.id === set.id) break;
  }

  return `Set ${ordinal}`;
}
