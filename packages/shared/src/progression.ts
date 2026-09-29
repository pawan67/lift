/**
 * What to lift next: double progression over the last few sessions.
 *
 * This is the one piece of the app that has an opinion. Everything else records
 * what happened; this reads the record and says "add a rep" or "add 2.5 kg", so
 * the number the user is walking to the rack with is arrived at by the app
 * rather than by arithmetic done between sets.
 *
 * Deliberately *not* a program: it has no notion of a week, a block, a deload
 * or a target set count. It answers one question about one exercise from that
 * exercise's own history, which is the only question a tracker is entitled to
 * answer without being asked.
 *
 * It will autoregulate on effort where the user has recorded any, and only
 * there. RPE moves a suggestion one step in the direction the numbers already
 * pointed: forward to the load when every set was logged with reps to spare,
 * back to a repeat when none of them had any. A history with no RPE in it gets
 * the same answer it got before that existed, which is what most histories are.
 *
 * Pure and unit-agnostic, kilograms in and kilograms out, so the same function
 * can run inside the logging screen's render and inside a test with no
 * database anywhere.
 */

import {
  TRACKING_FIELDS,
  USES_BODYWEIGHT,
  isWorkingSet,
  type Equipment,
  type SetType,
  type TrackingType,
} from './types.ts';
import { roundToIncrement, trimZeros } from './units.ts';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The minimum shape the engine needs: satisfied by DB rows and drafts alike. */
export interface PerformedSet {
  weightKg: number | null;
  reps: number | null;
  setType: SetType;
  isCompleted: boolean;
  /**
   * How hard the set was, on the 1-10 RPE scale, where 10 is a set with
   * nothing left and 8 leaves two reps in reserve.
   *
   * Optional, where the three above it are `T | null`, and the difference is
   * deliberate rather than sloppy. Those are the measurements a set *is*: a
   * caller that leaves one out is withholding a fact the engine needs, so the
   * type makes them say `null` and mean it. Effort is a note somebody chose to
   * leave, and most people never do. Optional lets a draft, a routine target or
   * a warm-up builder stay silent without writing `rpe: null` at every
   * construction site to assert the thing the engine already assumes. Absent
   * and null mean exactly the same thing here: nobody recorded an effort, so
   * the engine reasons the way it always has.
   */
  rpe?: number | null;
}

/** One past session of a single exercise. */
export interface ExerciseSession {
  /** Epoch milliseconds. Only used to keep sessions in order. */
  startedAt: number;
  sets: readonly PerformedSet[];
}

export interface ProgressionConfig {
  trackingType: TrackingType;
  /**
   * The rep range the user is working in. Progression runs *within* this band
   * and only adds load at the top of it: the whole of double progression.
   */
  minReps: number;
  maxReps: number;
  /**
   * The smallest load step that exists on this equipment, in kilograms. A
   * suggestion is always rounded to a multiple of it: 82.4 kg is not a weight
   * anyone can load, and offering it once costs more trust than the precision
   * was ever worth.
   */
  incrementKg: number;
  /**
   * Consecutive sessions failing to beat the one before, before the engine
   * stops asking for more and takes some load off instead.
   */
  stallSessions?: number;
  /** How much load a back-off keeps, as a fraction. 0.9 means "drop 10%". */
  backOffFraction?: number;
  /**
   * The effort each working set is meant to be taken to, on the 1-10 RPE
   * scale. Defaults to `DEFAULT_TARGET_RPE`.
   *
   * Read only for a session whose working sets *all* carry an RPE, so a user
   * who logs no effort never meets this number and never notices it is wrong
   * for them.
   */
  targetRpe?: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** The four answers this engine has, all of them about the session after this one. */
export type ProgressionKind =
  /** Same load, one more rep: the normal week. */
  | 'add_reps'
  /**
   * The load goes up. Either the top of the rep range was cleared on every set,
   * in which case the reps reset to the bottom of the band, or every set was
   * logged well under the target effort, in which case the reps stay where they
   * were and the increment is paid for out of the reserve the RPE reported.
   */
  | 'add_weight'
  /** Repeat last session. Mid-range, or not enough agreement to move. */
  | 'hold'
  /** Stalled for `stallSessions`. Take load off and climb back through it. */
  | 'back_off';

/**
 * What a suggestion is, across both engines that make one.
 *
 * The fifth member is never returned by `suggestProgression`, which is why the
 * union is split rather than simply widened: the two switches below stay
 * exhaustive over the four this file can actually produce, instead of carrying
 * a dead branch apiece for a kind that arrives from `autoregulate.ts`. What the
 * screen needs is one type it can render, and that is this one.
 */
export type SuggestionKind =
  | ProgressionKind
  /**
   * Mid-session, from the set that just ended: the rating on it disagreed with
   * the effort these sets are meant to be taken to, so the ones still open have
   * been re-planned around it. See `autoregulate.ts`.
   */
  | 'autoregulate';

/** What to put in front of one working set. */
export interface SetSuggestion {
  /** 1-based ordinal among working sets, matching the logging screen's column. */
  workingIndex: number;
  weightKg: number | null;
  reps: number | null;
}

export interface Suggestion {
  kind: SuggestionKind;
  /**
   * One short sentence, sentence case, no trailing period. It is rendered as
   * a single quiet line under an exercise heading, not as prose. "Cleared 12
   * reps last time" rather than "You have successfully completed...".
   */
  reason: string;
  /** One entry per working set the last session held, in order. */
  sets: SetSuggestion[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * A zero here is not "unknown", it is "this exercise has no load to step".
 * Push-ups and a rubber band progress by reps or by nothing; the engine reads
 * the zero as an instruction to leave the weight alone rather than as a step of
 * no size, which would otherwise suggest the same weight forever.
 */
const INCREMENT_KG: Record<Equipment, number> = {
  barbell: 2.5, // a pair of 1.25s, the smallest thing most racks own
  dumbbell: 2, // fixed racks step in 2s either side of the light end
  kettlebell: 4, // the pood-derived ladder: 8, 12, 16, 20
  machine: 5, // one pin down the stack, and often nothing finer
  cable: 2.5,
  smith_machine: 2.5,
  plate: 2.5,
  resistance_band: 0, // the next band is a different exercise, not a step
  suspension: 0, // load is body angle, which nobody logs in kilograms
  medicine_ball: 1,
  bodyweight: 0,
  cardio_machine: 0,
  other: 2.5,
};

/**
 * The smallest honest load step for a piece of equipment, in kilograms.
 *
 * A barbell moves in 2.5 kg because that is a pair of 1.25s; a dumbbell rack
 * usually steps in 2; a stack machine in 5 and sometimes nothing smaller. These
 * are defaults for a suggestion, not claims about the user's gym. The number
 * is always theirs to overwrite by typing.
 */
export function defaultIncrementKg(equipment: Equipment): number {
  return INCREMENT_KG[equipment] ?? 2.5;
}

/** The band to fall back on when the history says nothing usable. */
const DEFAULT_MIN_REPS = 8;
const DEFAULT_MAX_REPS = 12;

/**
 * A band narrower than two reps is a target, not a range. There is nowhere to
 * progress *within* it, so double progression degenerates into adding weight
 * every session. Wider than eight and the top of it is a different exercise
 * from the bottom: an AMRAP set of 25 shouldn't drag a lifter's 5s up with it.
 */
const MIN_BAND_WIDTH = 2;
const MAX_BAND_WIDTH = 8;

/**
 * The rep range to work in when nothing else says otherwise.
 *
 * Taken from what the sessions actually did rather than from a fixed 8–12: a
 * lifter doing sets of 5 is not asking to be walked up to 12. The low end is
 * theirs untouched (it is the rep count they choose their weights for) and
 * only the top is clamped, since that is where the outliers live.
 */
export function inferRepRange(sessions: readonly ExerciseSession[]): {
  minReps: number;
  maxReps: number;
} {
  let lowest = Infinity;
  let highest = 0;

  for (const session of sessions) {
    for (const set of session.sets) {
      const reps = usableReps(set);
      if (reps === null) continue;
      lowest = Math.min(lowest, reps);
      highest = Math.max(highest, reps);
    }
  }

  if (!Number.isFinite(lowest) || highest < 1) {
    return { minReps: DEFAULT_MIN_REPS, maxReps: DEFAULT_MAX_REPS };
  }

  const minReps = Math.max(1, lowest);
  const maxReps = Math.min(
    Math.max(highest, minReps + MIN_BAND_WIDTH),
    minReps + MAX_BAND_WIDTH,
  );
  return { minReps, maxReps };
}

// ---------------------------------------------------------------------------
// Reading the history
// ---------------------------------------------------------------------------

/**
 * The tracking types this engine declines to answer for.
 *
 * A run's progression is not a rep and a weight: pace, distance and duration
 * trade against each other in ways a set-and-rep rule cannot speak to, and on a
 * screen where every other line is a fact, a confident wrong answer costs more
 * than a blank space.
 */
export const UNOPINIONATED_TRACKING: ReadonlySet<TrackingType> = new Set<TrackingType>([
  'duration',
  'distance_duration',
  'weight_distance',
]);

const DEFAULT_STALL_SESSIONS = 3;
const DEFAULT_BACK_OFF_FRACTION = 0.9;

/**
 * The ends of the RPE scale this app stores, matching `parseRpe` in the CSV
 * importer so a value that survived an import is a value the engine will read.
 */
const MIN_RPE = 1;
const MAX_RPE = 10;

/**
 * The effort a working set is assumed to be taken to when nobody has said.
 *
 * RPE 8 is two reps in reserve, which is where a set that is meant to be
 * repeated three times and again next week generally belongs. It is a default
 * about training rather than a claim about this user, and it is only ever read
 * for a session whose sets all carry an RPE: someone who has already told the
 * app how hard they were working.
 */
const DEFAULT_TARGET_RPE = 8;

/**
 * How far from the target an effort has to sit before the engine acts on it,
 * in points of RPE, which are reps in reserve.
 *
 * Two, and symmetric, which puts both triggers at the far ends of the scale
 * rather than either side of the target: with the default target of 8, load
 * goes up early only at RPE 6 or under, and a rep is withheld only at RPE 10.
 * A tighter margin would have the engine re-plan a session off the difference
 * between an 8 and an 8.5, and that difference is inside the noise of a number
 * a human guesses while out of breath between sets. It is the same argument
 * `MIN_BAND_WIDTH` makes about reps: one is not a signal, four is.
 */
const RPE_SLACK = 2;

/** Loads are user-typed decimals; compare them with a hair of room. */
const EPSILON = 1e-9;

/** One completed working set, reduced to the numbers the engine reasons about. */
interface ReadSet {
  workingIndex: number;
  /** Null when the exercise carries no load, or none was ever recorded. */
  loadKg: number | null;
  reps: number;
  /** Null when no effort was recorded, which is the usual case. */
  rpe: number | null;
}

/**
 * The rep count worth reading off a set: completed, working, and an actual
 * number. A warm-up ramp or a set the user never checked says nothing about
 * whether the range was cleared, and a null rep count is not a zero.
 */
function usableReps(set: PerformedSet): number | null {
  if (!set.isCompleted || !isWorkingSet(set.setType)) return null;
  return setRepCount(set);
}

/**
 * The rep count on a set, whether or not it has happened yet.
 *
 * Split out of `usableReps` because `autoregulate.ts` needs the number off an
 * *open* row, which is the one case the gate above exists to reject: a set
 * nobody has checked off says nothing about what was lifted, but it says
 * exactly what is being asked for next, which is the question one file over.
 * The validation is shared so the two cannot drift about what counts as a rep.
 */
export function setRepCount(set: PerformedSet): number | null {
  if (set.reps === null || !Number.isFinite(set.reps) || set.reps < 1) return null;
  // Reps are whole in the schema; rounding keeps a stray float from coming back
  // out of the engine as "8.5 reps".
  return Math.round(set.reps);
}

/**
 * The load a set was performed at, or null when there isn't one to speak of.
 *
 * An empty weight box means two different things and the tracking type is what
 * tells them apart: on the bodyweight variants it is itself a fact: no belt,
 * no assistance, while on a barbell lift it is a number nobody wrote down, and
 * "2.5 kg" as the next step up from a load we never knew is worse than silence.
 * The logging screen's `ghostFill` draws the same line for the same reason.
 */
export function setLoadKg(set: PerformedSet, trackingType: TrackingType): number | null {
  if (!TRACKING_FIELDS[trackingType].weight) return null;
  if (set.weightKg === null || !Number.isFinite(set.weightKg)) {
    return USES_BODYWEIGHT.has(trackingType) ? 0 : null;
  }
  return set.weightKg;
}

/**
 * The effort worth reading off a set, or null when there isn't one.
 *
 * Out-of-range values are dropped rather than clamped. A 47 in this column is a
 * mis-mapped CSV import, not a very hard set, and reading it as a 10 would
 * quietly withhold reps from someone whose file had the wrong header on it. The
 * importer's `parseRpe` refuses the same numbers at the same two bounds.
 */
export function setRpe(set: PerformedSet): number | null {
  const rpe = set.rpe;
  if (rpe == null || !Number.isFinite(rpe)) return null;
  return rpe >= MIN_RPE && rpe <= MAX_RPE ? rpe : null;
}

/**
 * A session reduced to its completed working sets, numbered the way the logging
 * screen numbers them.
 *
 * Warm-ups don't consume a working-set ordinal, so the number is counted here
 * rather than taken from the array index: the same walk `pairWithPrevious`
 * does when it lines today's sets up against last session's. Pairing by raw
 * position instead would compare this week's first working set against last
 * week's second warm-up the moment the two sessions disagree about the ramp.
 */
function readSets(session: ExerciseSession, trackingType: TrackingType): ReadSet[] {
  const sets: ReadSet[] = [];

  for (const set of session.sets) {
    const reps = usableReps(set);
    if (reps === null) continue;
    sets.push({
      workingIndex: sets.length + 1,
      loadKg: setLoadKg(set, trackingType),
      reps,
      rpe: setRpe(set),
    });
  }

  return sets;
}

/**
 * Did this set improve on the one that held its ordinal last time? More load,
 * or the same load for more reps.
 *
 * Signed, because on assisted work the entered number is help rather than load:
 * 40 kg of assistance beats 45 kg of it, and a comparison that missed that would
 * read a lifter's best month as a stall.
 */
function setImproved(set: ReadSet, previous: ReadSet, sign: number): boolean {
  const load = sign * (set.loadKg ?? 0);
  const previousLoad = sign * (previous.loadKg ?? 0);

  if (load > previousLoad + EPSILON) return true;
  if (load < previousLoad - EPSILON) return false;
  return set.reps > previous.reps;
}

/**
 * Did this session beat the one before it? Any one set improving is enough.
 *
 * Compared set against set, by the ordinal the logging screen numbers them by,
 * rather than by the session's heaviest set alone. A top-set comparison only
 * ever sees the first number of a descending run: 100/95/90 becoming
 * 100/97.5/95 is two sets better and one set the same, and reading only the top
 * of it reports no progress at all. Three of those in a row and the app takes
 * 10% off a lifter who has been improving the whole time: the one failure this
 * function has that costs real weight.
 *
 * "Any set improved" rather than "no set got worse": a stall is nothing moving
 * anywhere, and a session that went up on two sets and down on one is a lot of
 * things, but it is not stuck.
 */
function beatsPrevious(
  session: readonly ReadSet[],
  previous: readonly ReadSet[],
  sign: number,
): boolean {
  // An added working set is more work than last time, whatever is written on it.
  if (session.length > previous.length) return true;

  const byIndex = new Map(previous.map((set) => [set.workingIndex, set]));

  return session.some((set) => {
    const before = byIndex.get(set.workingIndex);
    return before !== undefined && setImproved(set, before, sign);
  });
}

/**
 * `stallSessions` sessions in a row with nothing to show for each other.
 *
 * Read across the window rather than against a session before it: "same weight
 * for three sessions" is what a stall looks like to the person living it, and
 * requiring a fourth session as a baseline would delay the back-off past the
 * point where it helps. Short history is never a stall: two sessions at the
 * same weight is a normal week, and taking 10% off it would be the app
 * inventing a problem.
 */
function isStalled(history: readonly ReadSet[][], stallSessions: number, sign: number): boolean {
  if (history.length < stallSessions) return false;

  for (let index = 0; index + 1 < stallSessions; index++) {
    if (beatsPrevious(history[index]!, history[index + 1]!, sign)) return false;
  }

  return true;
}

/**
 * Which of the two effort rules moved the suggestion, if either did.
 *
 * Carried rather than re-derived in `writeReason`, because re-deriving means
 * restating both thresholds in a second place, and the day the two copies
 * disagree the app prints a sentence that does not describe the number beside
 * it. Null is by far the common case: nobody logged an effort, or one was
 * logged and it said nothing worth acting on.
 */
type EffortRule = 'early_load' | 'at_the_limit' | null;

/** The span of effort a session was logged at. Both ends, because they differ. */
interface Effort {
  /** The RPE of the easiest set: every set was at least this hard. */
  easiest: number;
  /** The RPE of the hardest set: no set was harder than this. */
  hardest: number;
}

/**
 * What the session says about effort, but only when *every* working set in it
 * says something.
 *
 * All or nothing, for the same reason the weight only moves when every set
 * cleared the top: a session where set one is marked RPE 6 and the other three
 * are blank is not a session that was easy, it is a session someone rated once
 * and then got on with. Averaging over the sets that happen to carry a number
 * would let a single tap on the first set of the day re-plan the whole exercise.
 *
 * Both ends are kept because the two rules below need opposite ones, and each
 * needs the end that makes it harder to fire. Adding load early asks about the
 * *hardest* set, so one grinding set is enough to veto it. Withholding a rep
 * asks about the *easiest*, so one grinding set is not enough to trigger it.
 */
function readEffort(sets: readonly ReadSet[]): Effort | null {
  if (sets.length === 0) return null;

  let easiest = MAX_RPE;
  let hardest = MIN_RPE;

  for (const set of sets) {
    if (set.rpe === null) return null;
    easiest = Math.min(easiest, set.rpe);
    hardest = Math.max(hardest, set.rpe);
  }

  return { easiest, hardest };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** One increment in the direction that makes the exercise harder. */
function stepLoad(loadKg: number, incrementKg: number, sign: number): number {
  return Math.max(0, roundToIncrement(loadKg + sign * incrementKg, incrementKg));
}

/**
 * The load to climb back through after a stall.
 *
 * Rounded to the increment, because the point of a back-off is a weight that
 * can be loaded. When the rounding lands back on the weight that caused the
 * stall: a 10% cut of a 10 kg stack is one whole increment short of moving the
 * pin: it steps by a single increment instead, so the suggestion is always
 * different from what the user just failed at.
 */
function backOffLoad(
  loadKg: number,
  incrementKg: number,
  backOffFraction: number,
  sign: number,
): number {
  if (sign < 0) {
    // Assistance: backing off means *more* help, by the same fraction.
    const eased = roundToIncrement(loadKg * (2 - backOffFraction), incrementKg);
    return eased > loadKg + EPSILON ? eased : loadKg + incrementKg;
  }

  const eased = Math.max(0, roundToIncrement(loadKg * backOffFraction, incrementKg));
  return eased < loadKg - EPSILON ? eased : Math.max(0, loadKg - incrementKg);
}

/**
 * What to do next, from the sessions that came before.
 *
 * `sessions` is newest-first and may be empty. Returns null when there is
 * nothing worth saying: no history at all, or a tracking type this engine has
 * no opinion about (a run's progression is not a rep and a weight).
 */
export function suggestProgression(
  sessions: readonly ExerciseSession[],
  config: ProgressionConfig,
): Suggestion | null {
  const { trackingType } = config;
  if (UNOPINIONATED_TRACKING.has(trackingType)) return null;

  // Sorted rather than trusted. `sessions` is documented newest-first, but a
  // caller who hands them over the other way round would be told that every
  // session in the file was a stall, which is the one answer here that loses a
  // user weight they had already earned.
  const history = [...sessions]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((session) => readSets(session, trackingType))
    .filter((sets) => sets.length > 0);

  if (history.length === 0) return null;
  const last = history[0]!;

  // None of the config is trusted either: these numbers land in a weight field.
  const minReps = Math.max(1, Math.round(finiteOr(config.minReps, DEFAULT_MIN_REPS)));
  const maxReps = Math.max(minReps, Math.round(finiteOr(config.maxReps, DEFAULT_MAX_REPS)));
  const incrementKg = Math.max(0, finiteOr(config.incrementKg, 0));
  const stallSessions = Math.max(
    2,
    Math.round(finiteOr(config.stallSessions, DEFAULT_STALL_SESSIONS)),
  );
  const requested = finiteOr(config.backOffFraction, DEFAULT_BACK_OFF_FRACTION);
  const backOffFraction =
    requested > 0 && requested < 1 ? requested : DEFAULT_BACK_OFF_FRACTION;
  const targetRpe = Math.min(
    MAX_RPE,
    Math.max(MIN_RPE, finiteOr(config.targetRpe, DEFAULT_TARGET_RPE)),
  );

  // Assistance is the one number in the app that runs backwards: 40 kg of help
  // is harder work than 45. Both the comparison and the step carry the sign, or
  // the engine would congratulate a lifter for needing more help and then
  // prescribe more of it: an exercise made easier every week, forever.
  const sign = trackingType === 'assisted_bodyweight' ? -1 : 1;

  // A load steps only when there is a step to take and a number to take it
  // from. Push-ups have neither, and a barbell set logged without a weight has
  // no load we are entitled to add to; both fall back to progressing on reps.
  const canStepLoad = incrementKg > 0 && last.every((set) => set.loadKg !== null);

  const clearedTop = last.every((set) => set.reps >= maxReps);
  // A set under the band is not asked for another rep. The load is already too
  // heavy for the range it is meant to be worked in, and the way out is to
  // repeat it until it isn't.
  const canTakeRep = (set: ReadSet): boolean =>
    set.reps >= minReps && (set.reps < maxReps || !canStepLoad);

  // The whole of double progression, and the reason `kind` is one word for the
  // exercise rather than one per set: the weight goes up only when *every* set
  // cleared the top. Bumping it because set one was good and set four was not
  // is how a lifter spends a month failing the same session.
  //
  // Both ways forward are settled before the stall check, and for the same
  // reason. Three sessions at the top of the range read as a stall by the letter
  // of the rule, and so do three sessions parked mid-band, but neither lifter
  // is stuck. One has been waiting for the weight to go up; the other has room
  // to add a rep and was simply never asked, which is true of *everyone* the
  // first time this feature speaks to them. Taking 10% off someone who has never
  // been given a target to miss is the worst thing this engine can do, and
  // checking the stall first did exactly that.
  //
  // What is left when both are ruled out is the honest definition of stuck: no
  // weight to add because the top of the range was not cleared, and no rep to
  // add because the sets are coming in under the bottom of it. Three sessions of
  // that is a stall.
  let kind: ProgressionKind;
  if (clearedTop && canStepLoad) kind = 'add_weight';
  else if (last.some(canTakeRep)) kind = 'add_reps';
  else if (canStepLoad && isStalled(history, stallSessions, sign)) kind = 'back_off';
  else kind = 'hold';

  /*
   * What the effort column has to say, where there is one.
   *
   * Null for almost everybody, and null is the whole safety story: a history
   * with no RPE in it produces exactly the answer it produced before this block
   * existed. Nothing below reads a rep, a load or a stall, so a user who never
   * types an effort cannot tell this code is here.
   *
   * The rules only ever rewrite an `add_reps`, and they move it one step along
   * the axis it was already on: forward to the load, or back to a repeat. The
   * tidier rule, braking on effort whatever the reps did, was written and
   * thrown away. It is the one version of this that can trap somebody: a lifter
   * who clears the top of the band at RPE 10 and is then told to repeat it has
   * no way out at all, because the load step is itself what brings the next
   * session's effort back down towards the target. So a cleared range still
   * takes the weight, whatever it cost. And `back_off` is left alone because it
   * is already the most cautious answer the engine has.
   */
  const effort = readEffort(last);
  let effortRule: EffortRule = null;

  if (kind === 'add_reps' && effort !== null) {
    if (canStepLoad && effort.hardest <= targetRpe - RPE_SLACK) {
      // Two whole reps in reserve past the target, on the set that was hardest.
      // Double progression would walk this lifter to the top of the band one
      // rep a week to earn a step they could have taken today, and every one of
      // those weeks is spent under a load they have already told us is easy.
      kind = 'add_weight';
      effortRule = 'early_load';
    } else if (effort.easiest >= targetRpe + RPE_SLACK) {
      // Nothing in reserve on any set. "One more rep at the same weight" is not
      // a target here, it is a rep that did not exist last time and has been
      // asked for anyway. The engine already answers "hold" when the load is
      // too heavy for the band; this is the same fact arriving by the other
      // road, from what the lifter felt rather than from what they counted.
      kind = 'hold';
      effortRule = 'at_the_limit';
    }
  }

  const suggestedSets: SetSuggestion[] = last.map((set) => {
    switch (kind) {
      case 'add_weight':
        return {
          workingIndex: set.workingIndex,
          weightKg: stepLoad(set.loadKg ?? 0, incrementKg, sign),
          // Dropping to the bottom of the band is right when the *top* of it
          // was cleared: there the step is paid for out of the reps. The early
          // load is paid for out of the reps in reserve the RPE just reported,
          // so cutting the rep count as well would hand back more than the
          // increment costs. 3×10 at RPE 6 answered with 3×8 is less work than
          // was just done in every respect but the 2.5 kg.
          reps: effortRule === 'early_load' ? set.reps : minReps,
        };

      case 'back_off':
        return {
          workingIndex: set.workingIndex,
          weightKg: backOffLoad(set.loadKg ?? 0, incrementKg, backOffFraction, sign),
          reps: minReps,
        };

      case 'add_reps':
        return {
          workingIndex: set.workingIndex,
          weightKg: set.loadKg,
          reps: canTakeRep(set) ? set.reps + 1 : set.reps,
        };

      case 'hold':
        return { workingIndex: set.workingIndex, weightKg: set.loadKg, reps: set.reps };
    }
  });

  return {
    kind,
    reason: writeReason(kind, {
      last,
      minReps,
      maxReps,
      stallSessions,
      backOffFraction,
      sign,
      effort,
      effortRule,
    }),
    sets: suggestedSets,
  };
}

// ---------------------------------------------------------------------------
// The one line of justification
// ---------------------------------------------------------------------------

interface ReasonContext {
  last: readonly ReadSet[];
  minReps: number;
  maxReps: number;
  stallSessions: number;
  backOffFraction: number;
  sign: number;
  effort: Effort | null;
  effortRule: EffortRule;
}

/**
 * The sentence under the heading.
 *
 * This line is the entire justification the user gets for a number the app is
 * asking them to lift, so it says *why* rather than restating the suggestion:
 * "Two reps off the top of the range", not "Add a rep". Sentence case and no
 * full stop, because it is a caption, not prose.
 */
function writeReason(kind: ProgressionKind, ctx: ReasonContext): string {
  const { last, minReps, maxReps, stallSessions, backOffFraction, sign, effort, effortRule } = ctx;

  switch (kind) {
    case 'add_weight':
      // The effort line names the *hardest* set, because that is the one the
      // rule actually cleared: "nothing harder than 6" is the fact, where "RPE
      // 6" alone would read as an average and invite the user to check it
      // against a set that was a 5.
      if (effortRule === 'early_load' && effort) {
        return sign < 0
          ? `Every set at RPE ${formatRpe(effort.hardest)} or easier: take help off`
          : `Every set at RPE ${formatRpe(effort.hardest)} or easier: add load now`;
      }
      return sign < 0
        ? `Cleared ${maxReps} reps on every set: less help next time`
        : `Cleared ${maxReps} reps on every set`;

    case 'back_off': {
      const percent = Math.round((1 - backOffFraction) * 100);
      const under = last.filter((set) => set.reps < minReps).length;
      // A back-off is only reachable once both ways forward are ruled out, so
      // the line names the miss rather than the flatness. "Same weight for three
      // sessions" described a lifter who might simply have been coasting; this
      // one has been failing the reps they set out to do, which is the fact that
      // justifies taking weight off the bar.
      const opening =
        under === last.length
          ? `Short of ${minReps} reps for ${countWord(stallSessions)} sessions`
          : `${capitalize(countWord(under))} of ${countWord(last.length)} sets short for ${countWord(stallSessions)} sessions`;
      return sign < 0
        ? `${opening}. Add ${percent}% more help`
        : `${opening}. Take ${percent}% off`;
    }

    case 'add_reps': {
      const cleared = last.filter((set) => set.reps >= maxReps).length;
      if (cleared === last.length) return `No load to add: climb past ${maxReps} reps instead`;
      if (cleared > 0) {
        const count = `${capitalize(countWord(cleared))} of ${countWord(last.length)}`;
        return `${count} sets cleared ${maxReps}`;
      }
      const gap = maxReps - Math.min(...last.map((set) => set.reps));
      return `${capitalize(countWord(gap))} ${gap === 1 ? 'rep' : 'reps'} off the top of the range`;
    }

    case 'hold': {
      // Named off the *easiest* set for the mirror of the reason above: the
      // rule fires on the whole session clearing the bar, so the sentence
      // quotes the set that only just did.
      if (effortRule === 'at_the_limit' && effort) {
        return `Every set at RPE ${formatRpe(effort.easiest)} or harder: repeat this weight`;
      }
      const under = last.filter((set) => set.reps < minReps).length;
      if (under === last.length) return `Short of ${minReps} reps: repeat this weight`;
      const count = `${capitalize(countWord(under))} of ${countWord(last.length)}`;
      return `${count} sets fell short of ${minReps}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/** `8.5` stays; `8.0` reads as `8`. The same rule the coach prompt prints by. */
function formatRpe(rpe: number): string {
  return trimZeros(rpe.toFixed(1));
}

const COUNT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/** Small counts read better spelled out; rep targets stay as numerals. */
function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
