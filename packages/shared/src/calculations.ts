/**
 * Training analytics: 1RM estimation, volume, and personal-record detection.
 *
 * Everything here is pure and unit-agnostic (kilograms in, kilograms out) so it
 * can run identically on-device for the live workout screen and on the server
 * when recomputing aggregates.
 */

import {
  isWorkingSet,
  type PrKind,
  type SetType,
  type TrackingType,
  type WeightUnit,
} from './types.ts';
import { formatDurationShort, formatVolume, formatWeight } from './units.ts';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The minimum shape the analytics need: satisfied by DB rows and draft sets alike. */
export interface SetLike {
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceKm: number | null;
  setType: SetType;
  isCompleted: boolean;
}

export interface AnalyticsContext {
  trackingType: TrackingType;
  /** Required for bodyweight-based exercises; falls back to 0 when unknown. */
  bodyweightKg?: number;
  formula?: OneRepMaxFormula;
}

// ---------------------------------------------------------------------------
// One-rep max
// ---------------------------------------------------------------------------

export const ONE_REP_MAX_FORMULAS = [
  'brzycki',
  'epley',
  'lombardi',
  'oconner',
  'wathan',
  'lander',
] as const;

export type OneRepMaxFormula = (typeof ONE_REP_MAX_FORMULAS)[number];

export const ONE_REP_MAX_FORMULA_LABELS: Record<OneRepMaxFormula, string> = {
  brzycki: 'Brzycki',
  epley: 'Epley',
  lombardi: 'Lombardi',
  oconner: "O'Conner",
  wathan: 'Wathan',
  lander: 'Lander',
};

/**
 * Estimates a one-rep max from a submaximal set.
 *
 * All of these are regressions fitted to population data and they diverge badly
 * past ~12 reps. A 20-rep set says more about work capacity than maximal
 * strength. We still return a number (users expect the chart to keep moving)
 * but Brzycki and Lander are clamped because their linear denominators go to
 * zero and then negative, which would otherwise produce absurd or negative 1RMs.
 */
export function estimateOneRepMax(
  weightKg: number,
  reps: number,
  formula: OneRepMaxFormula = 'brzycki',
): number {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return 0;
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return weightKg;

  switch (formula) {
    case 'epley':
      return weightKg * (1 + reps / 30);

    case 'brzycki':
      // Denominator hits zero at 37 reps. Past ~30 the curve is meaningless
      // anyway, so hand off to Epley which stays monotonic and finite.
      if (reps >= 30) return weightKg * (1 + reps / 30);
      return weightKg * (36 / (37 - reps));

    case 'lombardi':
      return weightKg * Math.pow(reps, 0.1);

    case 'oconner':
      return weightKg * (1 + 0.025 * reps);

    case 'wathan':
      return (100 * weightKg) / (48.8 + 53.8 * Math.exp(-0.075 * reps));

    case 'lander':
      // Same failure mode as Brzycki: zero denominator at ~37.9 reps.
      if (reps >= 30) return weightKg * (1 + reps / 30);
      return (100 * weightKg) / (101.3 - 2.67123 * reps);
  }
}

// ---------------------------------------------------------------------------
// Effective load
// ---------------------------------------------------------------------------

/**
 * The load actually moved by a set, which is not always the number the user typed.
 *
 * A weighted pull-up at "+20 kg" moves bodyweight + 20. An assisted dip at
 * "40 kg" moves bodyweight − 40. Ignoring this makes bodyweight exercises look
 * like they contribute nothing to volume.
 */
export function effectiveWeightKg(set: SetLike, ctx: AnalyticsContext): number {
  const entered = set.weightKg ?? 0;
  const bodyweight = ctx.bodyweightKg ?? 0;

  switch (ctx.trackingType) {
    case 'weight_reps':
    case 'weight_distance':
      return entered;

    case 'bodyweight_reps':
      return bodyweight;

    case 'weighted_bodyweight':
      return bodyweight + entered;

    case 'assisted_bodyweight':
      // Assistance can exceed bodyweight on machines; never go negative.
      return Math.max(0, bodyweight - entered);

    case 'duration':
    case 'distance_duration':
    case 'reps_only':
      return 0;
  }
}

/** Volume (weight × reps) for one set. Non-rep exercises contribute nothing. */
export function setVolumeKg(set: SetLike, ctx: AnalyticsContext): number {
  if (!set.isCompleted || !isWorkingSet(set.setType)) return 0;
  const reps = set.reps ?? 0;
  if (reps <= 0) return 0;
  return effectiveWeightKg(set, ctx) * reps;
}

/** Estimated 1RM for one set, using its effective load. */
export function setOneRepMaxKg(set: SetLike, ctx: AnalyticsContext): number {
  if (!set.isCompleted || !isWorkingSet(set.setType)) return 0;
  const reps = set.reps ?? 0;
  if (reps <= 0) return 0;
  return estimateOneRepMax(effectiveWeightKg(set, ctx), reps, ctx.formula ?? 'brzycki');
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface SetSummary {
  volumeKg: number;
  workingSets: number;
  totalReps: number;
  /** Highest effective load moved. */
  heaviestKg: number;
  /** Highest estimated 1RM across the sets. */
  bestOneRepMaxKg: number;
  /** Highest single-set volume. */
  bestSetVolumeKg: number;
  bestReps: number;
  longestDurationSeconds: number;
  farthestDistanceKm: number;
}

export function summarizeSets(sets: readonly SetLike[], ctx: AnalyticsContext): SetSummary {
  const summary: SetSummary = {
    volumeKg: 0,
    workingSets: 0,
    totalReps: 0,
    heaviestKg: 0,
    bestOneRepMaxKg: 0,
    bestSetVolumeKg: 0,
    bestReps: 0,
    longestDurationSeconds: 0,
    farthestDistanceKm: 0,
  };

  for (const set of sets) {
    if (!set.isCompleted || !isWorkingSet(set.setType)) continue;

    const volume = setVolumeKg(set, ctx);
    const oneRm = setOneRepMaxKg(set, ctx);
    const load = effectiveWeightKg(set, ctx);

    summary.workingSets += 1;
    summary.volumeKg += volume;
    summary.totalReps += set.reps ?? 0;
    summary.heaviestKg = Math.max(summary.heaviestKg, load);
    summary.bestOneRepMaxKg = Math.max(summary.bestOneRepMaxKg, oneRm);
    summary.bestSetVolumeKg = Math.max(summary.bestSetVolumeKg, volume);
    summary.bestReps = Math.max(summary.bestReps, set.reps ?? 0);
    summary.longestDurationSeconds = Math.max(
      summary.longestDurationSeconds,
      set.durationSeconds ?? 0,
    );
    summary.farthestDistanceKm = Math.max(summary.farthestDistanceKm, set.distanceKm ?? 0);
  }

  return summary;
}

/**
 * Best weight achieved at each rep count (1–`maxReps`), the "rep max table"
 * shown on an exercise's detail page.
 *
 * A set of 100 kg × 8 also proves you can do 100 kg × 5, so each entry carries
 * forward to lower rep counts. Without that the table is full of holes.
 */
export function repMaxTable(
  sets: readonly SetLike[],
  ctx: AnalyticsContext,
  maxReps = 12,
): Map<number, number> {
  const best = new Map<number, number>();

  for (const set of sets) {
    if (!set.isCompleted || !isWorkingSet(set.setType)) continue;
    const reps = set.reps ?? 0;
    if (reps <= 0) continue;

    const load = effectiveWeightKg(set, ctx);
    if (load <= 0) continue;

    for (let r = Math.min(reps, maxReps); r >= 1; r--) {
      if (load > (best.get(r) ?? 0)) best.set(r, load);
      else break; // lower rep counts already hold a heavier load
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Personal records
// ---------------------------------------------------------------------------

export interface PrCandidate {
  kind: PrKind;
  value: number;
  /** Index into the sets array that produced it; null for session-wide records. */
  setIndex: number | null;
}

export interface PreviousBests {
  heaviestKg?: number;
  bestOneRepMaxKg?: number;
  bestSetVolumeKg?: number;
  bestSessionVolumeKg?: number;
  mostReps?: number;
  bestDurationSeconds?: number;
  bestDistanceKm?: number;
}

/**
 * Compares a session's sets for one exercise against the all-time bests and
 * returns whichever records it broke.
 *
 * Strictly greater-than: matching a previous best is not a new record, and
 * treating it as one would spray PR badges across every repeated workout.
 */
export function detectPrs(
  sets: readonly SetLike[],
  ctx: AnalyticsContext,
  previous: PreviousBests,
): PrCandidate[] {
  const prs: PrCandidate[] = [];
  const summary = summarizeSets(sets, ctx);
  if (summary.workingSets === 0) return prs;

  const bestSetIndexBy = (score: (set: SetLike) => number): number | null => {
    let bestIndex: number | null = null;
    let bestScore = -Infinity;
    sets.forEach((set, index) => {
      if (!set.isCompleted || !isWorkingSet(set.setType)) return;
      const value = score(set);
      if (value > bestScore) {
        bestScore = value;
        bestIndex = index;
      }
    });
    return bestIndex;
  };

  const push = (kind: PrKind, value: number, prev: number | undefined, index: number | null) => {
    if (value > 0 && value > (prev ?? 0)) prs.push({ kind, value, setIndex: index });
  };

  push(
    'heaviest_weight',
    summary.heaviestKg,
    previous.heaviestKg,
    bestSetIndexBy((s) => effectiveWeightKg(s, ctx)),
  );
  push(
    'best_1rm',
    summary.bestOneRepMaxKg,
    previous.bestOneRepMaxKg,
    bestSetIndexBy((s) => setOneRepMaxKg(s, ctx)),
  );
  push(
    'best_set_volume',
    summary.bestSetVolumeKg,
    previous.bestSetVolumeKg,
    bestSetIndexBy((s) => setVolumeKg(s, ctx)),
  );
  push('best_session_volume', summary.volumeKg, previous.bestSessionVolumeKg, null);
  push('most_reps', summary.bestReps, previous.mostReps, bestSetIndexBy((s) => s.reps ?? 0));
  push(
    'best_duration',
    summary.longestDurationSeconds,
    previous.bestDurationSeconds,
    bestSetIndexBy((s) => s.durationSeconds ?? 0),
  );
  push(
    'best_distance',
    summary.farthestDistanceKm,
    previous.bestDistanceKm,
    bestSetIndexBy((s) => s.distanceKm ?? 0),
  );

  return prs;
}

// ---------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------

/** Local-midnight day key, so streaks respect the user's calendar, not UTC. */
function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** ISO-ish week key (weeks start Monday), used for the weekly streak stat. */
function weekKey(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Shift so Monday === 0, then step back to that week's Monday.
  const dayOfWeek = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayOfWeek);
  return dayKey(d);
}

/**
 * Consecutive weeks containing at least one workout, counting back from the
 * current week.
 *
 * Weeks rather than days because almost nobody trains daily. A day-based
 * streak would read "0" for a perfectly consistent 4-day-a-week lifter. The
 * current week is only required to break the streak once it has passed, so
 * training Monday and checking on Wednesday still shows the streak intact.
 */
export function computeWeekStreak(workoutDates: readonly Date[], now: Date = new Date()): number {
  if (workoutDates.length === 0) return 0;

  const weeks = new Set(workoutDates.map(weekKey));
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let streak = 0;
  // If nothing logged this week yet, start counting from last week instead of
  // zeroing out a streak the user still has time to extend.
  if (!weeks.has(weekKey(cursor))) cursor.setDate(cursor.getDate() - 7);

  while (weeks.has(weekKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 7);
  }

  return streak;
}

/** Number of distinct calendar days with a workout, within an optional range. */
export function countActiveDays(workoutDates: readonly Date[]): number {
  return new Set(workoutDates.map(dayKey)).size;
}

export { dayKey, weekKey };

/**
 * A record's value, written in the unit its kind is actually measured in.
 *
 * Seven kinds share one `value` column and four different dimensions between
 * them: a load, a volume, a rep count, a duration and a distance. Formatting
 * them all as a weight prints "8 kg" for an eight-rep record, which is not an
 * ugly number but a wrong one.
 *
 * Here rather than on the summary screen because that is no longer the only
 * reader. The session document a model is handed prints the same records, and
 * two formatters for one column is how the screen and the document end up
 * disagreeing about what a personal best was.
 */
export function formatPrValue(kind: PrKind, value: number, unit: WeightUnit): string {
  switch (kind) {
    case 'most_reps':
      return `${value} reps`;
    case 'best_duration':
      return formatDurationShort(value);
    case 'best_distance':
      return `${value.toFixed(2)} km`;
    case 'best_session_volume':
    case 'best_set_volume':
      return formatVolume(value, unit);
    default:
      return formatWeight(value, unit, { decimals: 1 });
  }
}
