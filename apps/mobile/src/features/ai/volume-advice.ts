/**
 * Reading the volume gaps off the log.
 *
 * The arithmetic is in `@lift/shared`'s `findVolumeGaps` and is unit-tested
 * there. This is the two lines around it that need a database: pick a window,
 * count the sets in it, hand the rate over.
 *
 * Nothing here calls a model, and that is the point of the file existing
 * separately from the rest of `features/ai`. The card this feeds renders with
 * AI switched off, with no key, and on a plane. A model is only ever asked for
 * the sentence that turns "side delts, 4 sets against an MEV of 10" into
 * "add 3 sets of lateral raises to Push A and Push B", and the numbers it is
 * given are these.
 */

import { findVolumeGaps, type VolumeGap } from '@lift/shared';

import { getMuscleBoard } from '@/features/analytics/muscle-stats';
import { addDays, startOfDay } from '@/features/analytics/windows';
import { useSettings } from '@/store/settings';

/**
 * Four weeks.
 *
 * The shortest window over which a weekly set count says anything about
 * training rather than about which day of the week it currently is. Over seven
 * days a push/pull/legs split reports every muscle it did not train that week as
 * a gap, which is both true and useless. Over four weeks a muscle that is
 * genuinely short stays short.
 */
export const ADVICE_WINDOW_DAYS = 28;

export interface VolumeAdvice {
  gaps: VolumeGap[];
  /** Working sets in the window. Zero means there is nothing to advise on yet. */
  totalSets: number;
  windowDays: number;
}

/**
 * The gaps in the last four weeks, worst first.
 *
 * Returns an empty list two ways that mean different things, which is why
 * `totalSets` comes back alongside it: no gaps because the training is balanced,
 * and no gaps worth naming because there is barely any training in the window
 * yet. A card telling somebody on their third session that they are eleven sets
 * short in six muscles is technically correct and reads as an accusation.
 */
export async function getVolumeAdvice(): Promise<VolumeAdvice> {
  // Tomorrow's midnight, matching every other window in the app: a session
  // finished this evening belongs to the window that is meant to be counting it.
  const to = addDays(startOfDay(new Date()), 1);
  const from = addDays(to, -ADVICE_WINDOW_DAYS);

  const board = await getMuscleBoard(from, to);

  return {
    gaps: findVolumeGaps(board.setsPerWeek, { level: useSettings.getState().trainingLevel }),
    totalSets: board.totalSets,
    windowDays: ADVICE_WINDOW_DAYS,
  };
}

/**
 * Below this, the window is too thin to advise from.
 *
 * Ten working sets over four weeks is somebody who has just installed the app or
 * has stopped training, and neither wants a list of deficits. The advisor stays
 * quiet rather than guessing which.
 */
export const MIN_SETS_FOR_ADVICE = 10;

export function hasEnoughData(advice: VolumeAdvice): boolean {
  return advice.totalSets >= MIN_SETS_FOR_ADVICE;
}
