/**
 * What to put on the bar for the sets you have left, from the set you just did.
 *
 * `progression.ts` answers a question about next week. It reads whole sessions
 * back out of the log and says "add a rep" or "add 2.5 kg" before the first set
 * of the day is touched, and it is deliberately blind to the session you are
 * standing in: `getPreviousPerformance` is called with the open workout
 * excluded, because a half-logged session is not evidence about anything yet.
 *
 * This answers the same question about the next ten minutes. You rate set one
 * at five reps in reserve, and sets two and three are still sitting there
 * carrying a weight that has just been shown to be too light. Waiting until
 * next Tuesday to act on that is the whole of what this file exists to stop.
 *
 * Where the two disagree, this one wins, and it should: it is reading a set
 * performed four minutes ago under today's sleep, today's food and today's
 * warm-up, against a session-level rule reading a month of history. The history
 * says what you can usually do. The set says what you can do now.
 *
 * It writes nothing. Like every other suggestion in the app it reaches a row
 * only when the user presses the line that states it, for the reason spelled
 * out at the top of `suggestion.ts`: one field per set means a pre-filled
 * number is committed by a bare check-off, and the log would then hold a lift
 * nobody performed.
 *
 * Pure and unit-agnostic, kilograms in and kilograms out, so it runs inside the
 * logging screen's render and inside a test with no database anywhere.
 */

import {
  UNOPINIONATED_TRACKING,
  setLoadKg,
  setRepCount,
  setRpe,
  type PerformedSet,
  type SetSuggestion,
  type Suggestion,
} from './progression.ts';
import {
  TRACKING_FIELDS,
  USES_BODYWEIGHT,
  isWorkingSet,
  type TrackingType,
} from './types.ts';
import { roundToIncrement } from './units.ts';

// ---------------------------------------------------------------------------
// The scale, as a load
// ---------------------------------------------------------------------------

/**
 * Load as a fraction of one-rep max for a set taken all the way to failure at
 * `n` reps, indexed by `n - 1`.
 *
 * This is the published RPE chart, and the reason it is one row here rather
 * than the nine-by-twelve grid it is usually printed as is that the grid is one
 * row repeated. The chart's own structure is that a set of 8 with 2 left in
 * reserve is loaded like a set of 10 to failure: what fixes the percentage is
 * reps plus reps in reserve, not either one alone. Reading 8 @ RPE 8 off the
 * RPE 8 column gives 73.9%, and so does reading 10 off this array. Every cell
 * in the printed grid falls out of that, including the half-point rows, which
 * are the linear interpolations between neighbours to the decimal place the
 * chart is printed at: 8 @ RPE 8.5 is 9.5 reps to failure, and the midpoint of
 * 76.2 and 73.9 is 75.05, which is the 75.1 in the cell. So the table is stored
 * the way it is actually shaped, and `loadPercent` does the arithmetic the grid
 * was hiding.
 *
 * 1 through 16 are all published, which is further than the grid looks: its
 * rows stop at 12 reps, but 12 @ RPE 6 is 16 reps to failure, so the corner of
 * the grid pins this row well past its own last column. The kink at 11 is the
 * chart's, not a typo: it is two regressions stitched together there, and
 * smoothing it would stop the half-point rows reproducing. From 11 on it is
 * arithmetic, a flat 2.7 points per rep, which is what makes 13 through 16 fall
 * straight out of the published cells.
 *
 * 17 through 20 continue that same slope past the last thing anybody measured.
 * They are the only invented numbers here, they are what the refusal below
 * exists to bound, and they land close to where Brzycki puts a 20-rep set,
 * which is the most that can be said for them.
 */
const FAILURE_LOAD_PERCENT = [
  1.0, 0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707,
  0.68, 0.653, 0.626, 0.599, 0.572, 0.545, 0.518, 0.491, 0.464,
] as const;

/**
 * Past this many reps to failure the table stops and the engine stops with it.
 *
 * The regressions behind the chart are fitted to sets somebody would take to a
 * countable failure, and past twenty the load barely moves per rep while the
 * rep count a human guesses moves a great deal: a set called "20 with 5 left"
 * and a set called "25 with nothing left" are the same set, and dividing a
 * weight by a percentage that flat produces a one-rep max with an enormous
 * error bar on it. `progression.ts` declines to speak about a run for the same
 * kind of reason. A confident wrong number in a weight field costs more than a
 * line that never appears.
 */
const MAX_REPS_TO_FAILURE = FAILURE_LOAD_PERCENT.length;

/** The top of the RPE scale, where nothing is left in reserve. */
const MAX_RPE = 10;

/** The bottom of the scale the app stores, matching the importer and the dialog. */
const MIN_RPE = 1;

/**
 * The fraction of a set's load this is allowed to move it by, either way.
 *
 * Ten percent, which is the same size of step `progression.ts` takes when it
 * backs off a stall, and it is a cap rather than a step: the arithmetic below
 * usually asks for less. It is here because the whole estimate hangs off one
 * number a human guessed while out of breath, and the guess is worst exactly
 * where it is most expensive. Somebody new to rating effort who calls an honest
 * RPE 8 a 5 is asking this engine for a jump that would end the set. Capped,
 * the same mistake costs an increment or two more than it should, they see it,
 * and they type over it.
 */
const MAX_MOVE_FRACTION = 0.1;

/**
 * How far from the target an effort has to sit before this acts on it, in
 * points of RPE, which are reps in reserve.
 *
 * Half a point, where `progression.ts` uses two, and the gap between those
 * numbers is the difference between the two questions. That engine is deciding
 * whether a month of training should change direction, so it waits for a signal
 * the noise cannot fake. This one is deciding whether the next four minutes
 * should use a different weight, and it is reading the freshest fact available:
 * a rating an hour old is history, a rating from the set that just ended is a
 * measurement. Half a point is also the resolution the effort dialog steps in,
 * so anything finer is a number the user cannot enter.
 */
const RPE_SLACK = 0.5;

/**
 * The effort a working set is assumed to be meant for when nobody has said.
 * The same 8 `progression.ts` assumes, and for the same reason: two reps in
 * reserve is where a set that has to be repeated twice more, and again next
 * week, generally belongs.
 */
const DEFAULT_TARGET_RPE = 8;

/** Loads are user-typed decimals; compare them with a hair of room. */
const EPSILON = 1e-9;

/**
 * Load as a fraction of one-rep max for `reps` taken to `rpe`, or null when
 * that lands outside the table.
 *
 * Half points are real (the effort dialog steps in them) so the lookup
 * interpolates rather than rounding: the chart's own half-point rows are the
 * midpoints, so this reproduces them exactly instead of approximating them.
 */
export function loadPercent(reps: number, rpe: number): number | null {
  if (!Number.isFinite(reps) || !Number.isFinite(rpe)) return null;
  if (reps < 1 || rpe < MIN_RPE || rpe > MAX_RPE) return null;

  // Reps in reserve added back on: what the set would have been if taken all
  // the way. This is the single number the chart is a function of.
  const toFailure = reps + (MAX_RPE - rpe);
  if (toFailure < 1 || toFailure > MAX_REPS_TO_FAILURE) return null;

  const lower = Math.floor(toFailure);
  const upper = Math.ceil(toFailure);
  const low = FAILURE_LOAD_PERCENT[lower - 1];
  const high = FAILURE_LOAD_PERCENT[upper - 1];
  if (low === undefined || high === undefined) return null;
  if (lower === upper) return low;

  return low + (high - low) * (toFailure - lower);
}

/**
 * The one-rep max a set implies, given what it cost.
 *
 * Distinct from `estimateOneRepMax` in `calculations.ts`, which reads a weight
 * and a rep count and has to assume the set was taken to failure, because that
 * is all a set without an effort rating can be read as. Three sets of 8 at
 * 80 kg produce one number there whether they were easy or the hardest thing in
 * the session. Here the rating is the input that tells them apart, so 8 @ RPE 6
 * and 8 @ RPE 10 come back as two different lifters, which is the point.
 *
 * Kept out of the analytics and the 1RM chart on purpose. Those are a record,
 * and a record whose value depends on whether somebody happened to tap the
 * effort chip that day is not one. This number exists to be turned straight
 * back into a load for the next set, and is never stored.
 */
export function oneRepMaxAtEffort(
  loadKg: number,
  reps: number,
  rpe: number,
): number | null {
  if (!Number.isFinite(loadKg) || loadKg <= 0) return null;
  const percent = loadPercent(reps, rpe);
  if (percent === null || percent <= 0) return null;
  return loadKg / percent;
}

/** The load that puts `reps` at `rpe`, for a lifter with this one-rep max. */
export function loadAtEffort(
  oneRepMaxKg: number,
  reps: number,
  rpe: number,
): number | null {
  if (!Number.isFinite(oneRepMaxKg) || oneRepMaxKg <= 0) return null;
  const percent = loadPercent(reps, rpe);
  if (percent === null) return null;
  return oneRepMaxKg * percent;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface AutoregulationConfig {
  trackingType: TrackingType;
  /**
   * The smallest load step this equipment has, in kilograms, and zero where it
   * has none. Zero is not "unknown" here any more than it is in
   * `progression.ts`: it routes the whole adjustment onto reps instead, which
   * is the only axis a push-up has.
   */
  incrementKg: number;
  /**
   * The effort the working sets are meant to be taken to, on the 1-10 scale.
   * Defaults to `DEFAULT_TARGET_RPE`, which is where a set that has to be done
   * three times and again next week generally belongs.
   */
  targetRpe?: number;
  /**
   * The rep range in play. Only the reps path is clamped by it: on a loaded
   * exercise the reps are held and the weight moves, so the band is already
   * satisfied by the row the user is looking at.
   */
  minReps: number;
  maxReps: number;
  /**
   * The lifter's bodyweight, for the three tracking types whose real load is a
   * function of it.
   *
   * Required rather than convenient on those three. A weighted pull-up entered
   * as "+10 kg" moves bodyweight plus ten, and running the percentages on the
   * ten alone says a lifter's one-rep max is 13 kg and then prescribes the next
   * set off it. Absent, those exercises fall back to adjusting reps, which is
   * always honest and merely less useful. Everything else ignores this.
   */
  bodyweightKg?: number | null;
}

// ---------------------------------------------------------------------------
// Reading the session so far
// ---------------------------------------------------------------------------

/** One set of this exercise in this session, numbered the way the screen is. */
interface SessionSet {
  /**
   * 1-based ordinal among working sets, counting the open ones too.
   *
   * Deliberately not the numbering `readSets` does in `progression.ts`, which
   * walks only completed sets because a finished session has nothing else in
   * it. Half of this walk has not happened yet, so skipping the open rows would
   * hand set four the number two and patch the wrong row. This is the count
   * `pairWithPrevious` does on the logging screen, which is what the ordinals
   * coming back out of here get matched against.
   */
  workingIndex: number;
  isCompleted: boolean;
  /** The number in the weight field, which is not always the load moved. */
  enteredKg: number | null;
  reps: number | null;
  rpe: number | null;
}

function readSession(
  sets: readonly PerformedSet[],
  trackingType: TrackingType,
): SessionSet[] {
  const read: SessionSet[] = [];
  let workingIndex = 0;

  for (const set of sets) {
    // A warm-up ramp is neither adjusted nor read from. It is not taken to an
    // effort worth rating, and it does not consume a working-set ordinal.
    if (!isWorkingSet(set.setType)) continue;
    workingIndex += 1;
    read.push({
      workingIndex,
      isCompleted: set.isCompleted,
      enteredKg: setLoadKg(set, trackingType),
      reps: setRepCount(set),
      rpe: setRpe(set),
    });
  }

  return read;
}

/**
 * The set the adjustment is computed from: the most recent completed working
 * set carrying both a rated effort and a rep count.
 *
 * The *most recent* rather than the first, or an average, and that choice is
 * what lets this file get away with having no fatigue model in it. A load
 * prescribed off set one is too heavy by set four, because a lifter's one-rep
 * max falls through a session. Every app that plans the whole exercise up front
 * needs a curve to describe that fall, and the curve is different for everyone
 * and for every exercise. Re-anchoring on the newest rating instead means the
 * drop is measured rather than modelled: set three is planned from set two,
 * which already contains whatever set one cost. Nothing has to be assumed about
 * how fast anybody fatigues, because by the time it matters it has been seen.
 *
 * It also means a rating the user goes back and corrects re-plans immediately,
 * and that a set left unrated is skipped over rather than read as an easy one.
 */
function anchorSet(sets: readonly SessionSet[]): SessionSet | null {
  for (let i = sets.length - 1; i >= 0; i -= 1) {
    const set = sets[i]!;
    if (!set.isCompleted || set.rpe === null || set.reps === null) continue;
    return set;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The number typed against the load moved
// ---------------------------------------------------------------------------

/**
 * The load a set actually moves, from the number in its weight field.
 *
 * The same translation `effectiveWeightKg` does for volume and for the 1RM
 * chart, and it has to be the same or this engine would prescribe against a
 * different exercise than the analytics report on. It is written out here
 * rather than imported because this pair has to be exact inverses of each
 * other, and the one place that is checkable is with both of them on screen.
 */
function effectiveKg(
  enteredKg: number,
  trackingType: TrackingType,
  bodyweightKg: number,
): number {
  switch (trackingType) {
    case 'weighted_bodyweight':
      return bodyweightKg + enteredKg;
    case 'assisted_bodyweight':
      // Assistance can exceed bodyweight on a machine; never go negative.
      return Math.max(0, bodyweightKg - enteredKg);
    default:
      return enteredKg;
  }
}

/**
 * The number to put in the weight field to move `effective` kilograms.
 *
 * The inverse of the above, and the whole of how assistance gets its direction
 * right without a sign flag anywhere. `progression.ts` carries one because it
 * reasons in steps: it has to know that adding an increment to the entered
 * number makes an assisted dip *easier*. This reasons in loads, where a harder
 * set is unambiguously a bigger one, and the subtraction here turns that back
 * into the smaller number the machine wants. The one direction that could still
 * go wrong, a lifter assisted past their own bodyweight, is the clamp above.
 */
function enteredForEffective(
  effectiveKgWanted: number,
  trackingType: TrackingType,
  bodyweightKg: number,
): number {
  switch (trackingType) {
    case 'weighted_bodyweight':
      return Math.max(0, effectiveKgWanted - bodyweightKg);
    case 'assisted_bodyweight':
      return Math.max(0, bodyweightKg - effectiveKgWanted);
    default:
      return Math.max(0, effectiveKgWanted);
  }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * What to put in front of the sets that have not happened yet, from the ones
 * that have, or null when there is nothing worth saying.
 *
 * `sets` is this exercise's rows in this session, in screen order, open ones
 * included. Null covers every reason to stay quiet and they are one answer
 * rather than eight, because the screen does the same thing with all of them:
 * renders no line. No rated set yet, nothing left to adjust, a rating that
 * agrees with what is already in the rows, a rep count off the end of the
 * chart, or a tracking type this has no business having an opinion about.
 */
export function autoregulateRemaining(
  sets: readonly PerformedSet[],
  config: AutoregulationConfig,
): Suggestion | null {
  const { trackingType } = config;
  if (UNOPINIONATED_TRACKING.has(trackingType)) return null;
  // Effort is defined in reps left in reserve, so an exercise with no rep count
  // has no effort to read. The set row gates its own chip the same way.
  if (!TRACKING_FIELDS[trackingType].reps) return null;

  const session = readSession(sets, trackingType);
  const anchor = anchorSet(session);
  if (anchor === null || anchor.reps === null || anchor.rpe === null) return null;

  const open = session.filter((set) => !set.isCompleted);
  if (open.length === 0) return null;

  // None of the config is trusted: these numbers land in a weight field.
  const targetRpe = clamp(finiteOr(config.targetRpe, DEFAULT_TARGET_RPE), MIN_RPE, MAX_RPE);
  const minReps = Math.max(1, Math.round(finiteOr(config.minReps, 1)));
  const maxReps = Math.max(minReps, Math.round(finiteOr(config.maxReps, minReps)));
  const incrementKg = Math.max(0, finiteOr(config.incrementKg, 0));
  const bodyweightKg = Math.max(0, finiteOr(config.bodyweightKg ?? undefined, 0));

  // Already at the target effort, within the resolution anybody rates a set to.
  if (Math.abs(anchor.rpe - targetRpe) < RPE_SLACK) return null;

  /*
   * Which axis this exercise can move on.
   *
   * The load, when there is a step to take it in, a number to take it from, and
   * (on the bodyweight variants) a bodyweight to read that number against.
   * Otherwise the reps, which is the only axis a push-up or a band has ever
   * had. The three conditions are the same ones `progression.ts` checks before
   * it allows itself to change a weight, plus the bodyweight one, which is new
   * here because this engine divides by the load where that one only steps it.
   */
  const knowsBodyweight = !USES_BODYWEIGHT.has(trackingType) || bodyweightKg > 0;
  const anchorLoadKg =
    TRACKING_FIELDS[trackingType].weight && knowsBodyweight && anchor.enteredKg !== null
      ? effectiveKg(anchor.enteredKg, trackingType, bodyweightKg)
      : null;

  // The load moved has to be a positive number, not merely a known one, because
  // the step after this divides by it. A set logged at zero, and an assisted
  // lifter being helped by more than they weigh, both land here and both go to
  // reps, which is the honest answer rather than the absent one: a percentage
  // of nothing is not a lighter set, it is not a set.
  const canStepLoad = incrementKg > 0 && anchorLoadKg !== null && anchorLoadKg > 0;

  const adjusted = canStepLoad
    ? adjustLoad(open, anchor, {
        anchorLoadKg,
        trackingType,
        targetRpe,
        incrementKg,
        bodyweightKg,
      })
    : adjustReps(open, anchor, { targetRpe, minReps, maxReps });

  if (adjusted === null) return null;

  return {
    kind: 'autoregulate',
    reason: writeReason(anchor, targetRpe),
    sets: adjusted,
  };
}

/**
 * Hold the reps, move the weight. The loaded case, and the common one.
 *
 * Reps are held rather than recalculated because the rep count is the part of
 * the prescription the user already chose, or their routine chose for them:
 * somebody working in fives who rates a set at 5 in reserve is asking for a
 * heavier five, not for a set of nine. It is also the only version of this that
 * stays legible on the line, where "87.5 kg × 8" reads as one changed number
 * against the rows underneath it.
 */
function adjustLoad(
  open: readonly SessionSet[],
  anchor: SessionSet,
  opts: {
    /** The load the anchor actually moved, already positive. */
    anchorLoadKg: number;
    trackingType: TrackingType;
    targetRpe: number;
    incrementKg: number;
    bodyweightKg: number;
  },
): SetSuggestion[] | null {
  const { anchorLoadKg: anchorLoad, trackingType, targetRpe, incrementKg, bodyweightKg } =
    opts;

  const oneRepMax = oneRepMaxAtEffort(anchorLoad, anchor.reps!, anchor.rpe!);
  if (oneRepMax === null) return null;

  // The cap is stated in the load that was moved rather than the number that
  // was typed, which is the only version of it that means the same thing on all
  // four tracking types. Ten percent of a weighted pull-up is ten percent of
  // bodyweight plus the belt, not ten percent of the belt.
  const ceiling = anchorLoad * (1 + MAX_MOVE_FRACTION);
  const floor = anchorLoad * (1 - MAX_MOVE_FRACTION);

  const suggestions: SetSuggestion[] = [];

  for (const set of open) {
    // The reps this row already asks for. An empty rep box on an open set is a
    // row nobody has planned yet, so it inherits the set that was rated, which
    // is the number the user would have copied down by hand.
    const reps = set.reps ?? anchor.reps!;

    const wanted = loadAtEffort(oneRepMax, reps, targetRpe);
    if (wanted === null) continue;

    // Capped, then translated back into the number the equipment wants, then
    // rounded, in that order. The rounding is last so the value that reaches
    // the field is always one that can actually be loaded.
    const capped = clamp(wanted, floor, ceiling);
    const entered = enteredForEffective(capped, trackingType, bodyweightKg);
    const weightKg = Math.max(0, roundToIncrement(entered, incrementKg));

    suggestions.push({ workingIndex: set.workingIndex, weightKg, reps });
  }

  if (suggestions.length === 0) return null;

  /*
   * Nothing to say when the rounding lands back on what the rows already hold.
   *
   * This is not a rare edge. A point of RPE is worth a few percent, and a few
   * percent of a 20 kg dumbbell is less than the 2 kg the rack steps in, so the
   * honest answer on light exercises is very often "same weight". The line
   * disappearing is that answer. Offering a tappable control that writes the
   * number already in the field is worse than silence: it costs a press to find
   * out it did nothing, and by the time the line means something the user has
   * learned to ignore it.
   */
  const moved = suggestions.some((entry, index) => {
    const current = open[index]!.enteredKg;
    if (entry.weightKg === null) return false;
    if (current === null) return entry.weightKg > 0;
    return Math.abs(entry.weightKg - current) > EPSILON;
  });

  return moved ? suggestions : null;
}

/**
 * Move the reps. Push-ups, bands, and anything else with no load step under it.
 *
 * The same arithmetic as the loaded path, one stage earlier: reps plus reps in
 * reserve is what the chart is a function of, so holding that total and solving
 * for the reps at the target effort is what "the same set, rated correctly"
 * means. A set of 10 with 5 left is 15 reps of capacity; asked for 2 in
 * reserve, that is a set of 13.
 *
 * Clamped to the band, which the loaded path does not need: there, the top of
 * the range is what makes the weight go up, so a lifter who runs past it has
 * somewhere to be sent. Here there is nowhere. Bodyweight work progresses by
 * reps or by nothing, and the band is the only thing standing between a good
 * day on the pull-up bar and a suggestion of thirty.
 */
function adjustReps(
  open: readonly SessionSet[],
  anchor: SessionSet,
  opts: { targetRpe: number; minReps: number; maxReps: number },
): SetSuggestion[] | null {
  const { targetRpe, minReps, maxReps } = opts;

  const capacity = anchor.reps! + (MAX_RPE - anchor.rpe!);
  const reps = clamp(Math.round(capacity - (MAX_RPE - targetRpe)), minReps, maxReps);

  const suggestions = open.map((set) => ({
    workingIndex: set.workingIndex,
    // The weight field is left exactly as it is. On `bodyweight_reps` there is
    // none, and on an exercise that has one but no step to take it in, the
    // number in it is the user's and this engine has no better one.
    weightKg: set.enteredKg,
    reps,
  }));

  // Same rule as the loaded path: a line that would write back what is already
  // in every row is a line that should not appear.
  const moved = suggestions.some((entry, index) => entry.reps !== open[index]!.reps);
  return moved ? suggestions : null;
}

// ---------------------------------------------------------------------------
// The one line of justification
// ---------------------------------------------------------------------------

/**
 * Why the numbers changed, in one short sentence, sentence case, no trailing
 * period. It renders as a quiet second line under the figure, not as prose.
 *
 * Written in reps in reserve rather than in RPE, even though RPE is what gets
 * stored, because reserve is the thing the user was actually asked for and the
 * thing that carries the argument: "set 1 left 4 in reserve" contains the case
 * for a heavier set 2, where "set 1 was RPE 6" makes the reader do the
 * subtraction first. The effort dialog makes the same call one screen over.
 */
function writeReason(anchor: SessionSet, targetRpe: number): string {
  const reserve = MAX_RPE - anchor.rpe!;
  const target = MAX_RPE - targetRpe;
  const set = `Set ${anchor.workingIndex}`;

  if (reserve <= 0) return `${set} had nothing left`;
  if (reserve < target) {
    return `${set} left ${countReserve(reserve)}, under the ${trimReserve(target)} you train to`;
  }
  return `${set} left ${countReserve(reserve)} in reserve`;
}

/** "1 rep" but "4 reps", and "2.5 reps" rather than "2.5000 reps". */
function countReserve(reserve: number): string {
  const text = trimReserve(reserve);
  return `${text} ${reserve === 1 ? 'rep' : 'reps'}`;
}

/** Half points are real on this scale, whole ones are the common case. */
function trimReserve(reserve: number): string {
  return Number(reserve.toFixed(1)).toString();
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
