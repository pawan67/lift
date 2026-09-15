/**
 * Which muscles are under- or over-trained, arrived at by arithmetic.
 *
 * This is the deterministic half of the volume advisor, and it is deliberately
 * the whole feature on its own. The app already knows the two numbers involved:
 * `setsPerWeek` comes off the same tally the body map is coloured from, and the
 * landmarks come from the table `landmarks.ts` already publishes. What was
 * missing was never a calculation, it was saying the result out loud as advice
 * instead of as a colour.
 *
 * So nothing here needs a model, a key or a network. A language model can be
 * layered on top to turn "side delts, 4 sets against an MEV of 10" into "add 3
 * sets of lateral raises to Push A and Push B", but it is given these figures
 * and told not to recompute them. Every number a user sees comes from this file.
 */

import {
  landmarksFor,
  volumeZone,
  DEFAULT_TRAINING_LEVEL,
  type TrainingLevel,
  type VolumeLandmarks,
  type VolumeZone,
} from '../landmarks.ts';
import { MUSCLE_GROUPS, type MuscleGroup } from '../types.ts';

export interface VolumeGap {
  muscle: MuscleGroup;
  /** The measured rate. Fractional, because indirect work counts at a half. */
  setsPerWeek: number;
  landmarks: VolumeLandmarks;
  zone: VolumeZone;
  /**
   * Whole sets per week short of MEV, rounded up, or 0 when at or above it.
   *
   * Rounded up rather than to nearest because the advice it becomes is "add
   * this many sets", and rounding 2.5 down prescribes a week that is still
   * under the line the whole figure was calculated against.
   */
  shortfall: number;
  /** Whole sets per week past MRV, rounded down, or 0 when at or below it. */
  excess: number;
  /**
   * How far out of the productive band this is, as a fraction of the band edge
   * it missed. A muscle that got no work at all scores 1; one just under the
   * line scores near 0. Sorting runs on this.
   */
  severity: number;
}

export interface VolumeGapOptions {
  level?: TrainingLevel;
  /**
   * Gaps below this severity are dropped.
   *
   * Defaults to a tenth, which is a little under one set on most rows. The
   * figures behind this are rates over a window rather than counts, so a muscle
   * a fraction under its MEV is inside the noise of where the window happened to
   * be cut, and reporting it trains the user to ignore the card.
   */
  minSeverity?: number;
}

const DEFAULT_MIN_SEVERITY = 0.1;

/**
 * Ranks every muscle that is outside its productive band, worst first.
 *
 * `setsPerWeek` is the map `getMuscleBoard` returns, and it is *partial*: a
 * muscle that was never trained in the window has no entry rather than an entry
 * of zero. Iterating the muscle list rather than the map's keys is therefore
 * load-bearing, because the muscles worth reporting hardest are exactly the ones
 * missing from it.
 *
 * The rate is only as meaningful as the window it came from. Four weeks is the
 * shortest span over which a weekly set count says anything; over three days it
 * mostly says which day it is. Choosing that window belongs to the caller.
 */
export function findVolumeGaps(
  setsPerWeek: Partial<Record<MuscleGroup, number>>,
  options: VolumeGapOptions = {},
): VolumeGap[] {
  const level = options.level ?? DEFAULT_TRAINING_LEVEL;
  const minSeverity = options.minSeverity ?? DEFAULT_MIN_SEVERITY;

  const gaps: VolumeGap[] = [];

  for (const muscle of MUSCLE_GROUPS) {
    const landmarks = landmarksFor(muscle, level);

    // `cardio`, `full_body` and `other` are tabulated as all-zero because they
    // are not muscles with a recoverable volume. Every comparison below would be
    // meaningless for them, and "you are over your MRV of 0 for cardio" is
    // actively wrong advice.
    if (landmarks.mrv <= 0) continue;

    const sets = setsPerWeek[muscle] ?? 0;
    const zone = volumeZone(sets, landmarks);

    // Roughly a third of the table has an MEV of zero: glutes, abs, traps,
    // forearms and the rest whose published row assumes they are covered by
    // compound work. There is no line to fall under, so there is no shortfall to
    // report, however few direct sets they got. Only the ceiling applies.
    const shortfall = landmarks.mev > 0 && sets < landmarks.mev ? ceilSets(landmarks.mev - sets) : 0;
    const excess = sets > landmarks.mrv ? Math.floor(sets - landmarks.mrv) : 0;

    if (shortfall === 0 && excess === 0) continue;

    const severity =
      shortfall > 0 ? (landmarks.mev - sets) / landmarks.mev : (sets - landmarks.mrv) / landmarks.mrv;

    if (severity < minSeverity) continue;

    gaps.push({ muscle, setsPerWeek: sets, landmarks, zone, shortfall, excess, severity });
  }

  // Severity descending, then the muscle list's own order, so two muscles that
  // are equally short come out in the same sequence every render rather than in
  // whatever order the tally happened to build. A card that reshuffles between
  // two visits reads as a bug even when both orders are correct.
  return gaps.sort((a, b) => b.severity - a.severity || indexOf(a.muscle) - indexOf(b.muscle));
}

/**
 * Sets short, rounded up, but never rounded up from nothing.
 *
 * A deficit of 0.2 sets is one set of advice, and prescribing it is right. A
 * deficit that floating-point arithmetic left at 1e-15 is not, and `Math.ceil`
 * would call it a whole set.
 */
function ceilSets(deficit: number): number {
  const rounded = Math.ceil(deficit - 1e-9);
  return rounded > 0 ? rounded : 0;
}

function indexOf(muscle: MuscleGroup): number {
  return MUSCLE_GROUPS.indexOf(muscle);
}

/**
 * The gap list as one line per muscle, for a model to read.
 *
 * Every figure carries its unit on the figure, and the sets-per-week rate is
 * printed to one decimal because indirect work makes it fractional and a rate
 * silently rounded to "4" invites a reply prescribing exactly 6 more. The same
 * rule the training document is built under, for the same reason.
 */
export function describeVolumeGaps(gaps: readonly VolumeGap[], labels: Record<MuscleGroup, string>): string {
  if (gaps.length === 0) return 'Every muscle trained in this window sits inside its productive range.';

  return gaps
    .map((gap) => {
      const rate = `${round1(gap.setsPerWeek)} sets/week`;
      return gap.shortfall > 0
        ? `- ${labels[gap.muscle]}: ${rate}, which is ${gap.shortfall} short of an MEV of ${gap.landmarks.mev} sets/week.`
        : `- ${labels[gap.muscle]}: ${rate}, which is ${gap.excess} past an MRV of ${gap.landmarks.mrv} sets/week.`;
    })
    .join('\n');
}

function round1(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
