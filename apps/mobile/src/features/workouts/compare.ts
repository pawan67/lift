/**
 * One lift, this session against the last time it was trained, in a word or
 * two: "+2.5 kg", "+2 reps", "Same", "1 rep fewer".
 *
 * The summary screen prints this beside each exercise. A total says how much
 * work a session was; this says whether each lift moved, which is the thing a
 * lifter actually checks on the way out of the gym and used to work out by
 * opening last week's session beside this one.
 *
 * The comparison is the top set, because that is how lifters keep score: the
 * heaviest working weight, and at that weight the most reps. A volume or 1RM
 * delta would be more complete and less legible, and it would disagree with
 * what the user remembers lifting.
 *
 * Only for the tracking types where "more" plainly means "better". Assisted
 * work runs the other way (less help is progress) and a duration or a distance
 * is a different kind of question, so those return null and draw nothing
 * rather than a verdict that might be backwards.
 */

import { formatWeight, isWorkingSet, type TrackingType, type WeightUnit } from '@lift/shared';

import type { WorkoutSet } from '@/db/schema';

export type Trend = 'better' | 'same' | 'worse';

export interface LastTimeComparison {
  text: string;
  trend: Trend;
}

const LOADED: ReadonlySet<TrackingType> = new Set(['weight_reps', 'weighted_bodyweight']);
const UNLOADED: ReadonlySet<TrackingType> = new Set(['bodyweight_reps', 'reps_only']);

/** Below this a weight difference is float noise from a unit round trip. */
const WEIGHT_EPSILON = 0.001;

export function compareWithLastTime(
  today: readonly WorkoutSet[],
  last: readonly WorkoutSet[],
  trackingType: TrackingType,
  unit: WeightUnit,
): LastTimeComparison | null {
  const now = topSet(today);
  const before = topSet(last);
  if (!now || !before) return null;

  if (LOADED.has(trackingType)) {
    const delta = now.weightKg - before.weightKg;
    if (Math.abs(delta) > WEIGHT_EPSILON) {
      const amount = formatWeight(Math.abs(delta), unit);
      return delta > 0
        ? { text: `+${amount}`, trend: 'better' }
        : { text: `${amount} lighter`, trend: 'worse' };
    }
    return describeReps(now.reps - before.reps);
  }

  if (UNLOADED.has(trackingType)) return describeReps(now.reps - before.reps);

  return null;
}

function describeReps(delta: number): LastTimeComparison {
  if (delta === 0) return { text: 'Same', trend: 'same' };

  const count = Math.abs(delta);
  return delta > 0
    ? { text: `+${count} ${count === 1 ? 'rep' : 'reps'}`, trend: 'better' }
    : { text: `${count} ${count === 1 ? 'rep' : 'reps'} fewer`, trend: 'worse' };
}

/** The heaviest completed working set, and the most reps at that weight. */
function topSet(sets: readonly WorkoutSet[]): { weightKg: number; reps: number } | null {
  let best: { weightKg: number; reps: number } | null = null;

  for (const set of sets) {
    if (!set.isCompleted || !isWorkingSet(set.setType)) continue;

    const weightKg = set.weightKg ?? 0;
    const reps = set.reps ?? 0;

    if (
      best === null ||
      weightKg > best.weightKg + WEIGHT_EPSILON ||
      (Math.abs(weightKg - best.weightKg) <= WEIGHT_EPSILON && reps > best.reps)
    ) {
      best = { weightKg, reps };
    }
  }

  return best;
}
