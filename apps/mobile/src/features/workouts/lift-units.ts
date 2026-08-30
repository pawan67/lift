/**
 * Consecutive exercises as the logging screen pages through them.
 *
 * A lone lift is a unit of one. A superset is one unit of every member of the
 * run, because those lifts are performed back to back and collapsing them
 * separately would hide the second half while you are still in the pair.
 *
 * Grouping is derived from `supersetPlacements`, not stored: the same rule the
 * chips and the tie already follow, so a unit cannot disagree with the letter
 * on screen.
 */

import type { SupersetPlacement } from '@lift/shared';

import type { WorkoutExerciseDetail } from './repository';

export interface LiftUnit {
  /** First member's link id. Stable while the run's leading exercise is. */
  id: string;
  /** `A` / `B` when this is a superset; null for a single lift. */
  label: string | null;
  members: WorkoutExerciseDetail[];
}

export function groupLiftUnits(
  details: readonly WorkoutExerciseDetail[],
  placements: ReadonlyMap<string, SupersetPlacement>,
): LiftUnit[] {
  const units: LiftUnit[] = [];

  for (const detail of details) {
    const placement = placements.get(detail.workoutExercise.id);
    const continues = placement !== undefined && placement.first === false;
    if (continues && units.length > 0) {
      units[units.length - 1]!.members.push(detail);
      continue;
    }

    units.push({
      id: detail.workoutExercise.id,
      label: placement?.label ?? null,
      members: [detail],
    });
  }

  return units;
}

export function unitSetProgress(unit: LiftUnit): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const member of unit.members) {
    total += member.sets.length;
    for (const set of member.sets) {
      if (set.isCompleted) done += 1;
    }
  }
  return { done, total };
}

export function unitIsComplete(unit: LiftUnit): boolean {
  const { done, total } = unitSetProgress(unit);
  return total > 0 && done === total;
}

/** The unit to have open when nothing has been pinned: first unfinished, else the first. */
export function defaultExpandedUnit(units: readonly LiftUnit[]): LiftUnit | undefined {
  return units.find((unit) => !unitIsComplete(unit)) ?? units[0];
}
