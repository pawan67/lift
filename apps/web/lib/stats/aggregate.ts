/**
 * Statistics over the in-memory model.
 *
 * Ports of the phone's SQL-backed analytics (`apps/mobile/src/features/analytics/`)
 * onto `useModel()`'s arrays: same rules, same numbers. Warm-up sets never count,
 * a secondary muscle gets half a set (`SECONDARY_SET_WEIGHT`), and a window is
 * half-open, `[from, to)`, on the session's start time.
 *
 * Everything here is pure and cheap enough to run in a `useMemo`: one pass over
 * `model.facts` or `model.sessions` per call.
 */

import {
  MUSCLE_TO_BODY_PART,
  type BodyPart,
  type Equipment,
  type MuscleGroup,
  type TrackingType,
} from "@lift/shared";

import type { ExerciseInfo, Model, Session } from "../data/model";
import { addDays, startOfWeek, type WeekStart } from "./windows";

/** How much a set counts toward a muscle the exercise only trains indirectly. */
export const SECONDARY_SET_WEIGHT = 0.5;

export interface Span {
  /** Inclusive, epoch ms. Null means "since the first session". */
  from: number | null;
  /** Exclusive, epoch ms. */
  to: number;
}

const inSpan = (time: number, span: Span) => (span.from === null || time >= span.from) && time < span.to;

// ---------------------------------------------------------------------------
// Period totals
// ---------------------------------------------------------------------------

export interface PeriodTotals {
  sessions: number;
  volumeKg: number;
  sets: number;
  reps: number;
  durationSeconds: number;
  records: number;
  activeDays: number;
}

export function emptyTotals(): PeriodTotals {
  return { sessions: 0, volumeKg: 0, sets: 0, reps: 0, durationSeconds: 0, records: 0, activeDays: 0 };
}

export function periodTotals(model: Model, span: Span): PeriodTotals {
  const totals = emptyTotals();
  const days = new Set<string>();

  for (const session of model.sessions) {
    if (!inSpan(session.startedAt, span)) continue;
    totals.sessions += 1;
    totals.volumeKg += session.volumeKg;
    totals.sets += session.workingSets;
    totals.reps += session.reps;
    totals.durationSeconds += session.durationSeconds;
    const date = new Date(session.startedAt);
    days.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
  }

  for (const record of model.records) if (inSpan(record.achievedAt, span)) totals.records += 1;
  totals.activeDays = days.size;
  return totals;
}

export function sessionsIn(model: Model, span: Span): Session[] {
  return model.sessions.filter((session) => inSpan(session.startedAt, span));
}

// ---------------------------------------------------------------------------
// Muscles
// ---------------------------------------------------------------------------

export interface MuscleTally {
  muscle: MuscleGroup;
  bodyPart: BodyPart;
  /** Weighted: direct sets plus half of each indirect one. */
  sets: number;
  directSets: number;
  reps: number;
  volumeKg: number;
  /** Distinct exercises that touched it. */
  exercises: number;
}

export function tallyMuscles(model: Model, span: Span): MuscleTally[] {
  const tallies = new Map<MuscleGroup, { entry: MuscleTally; seen: Set<string> }>();

  const touch = (muscle: MuscleGroup) => {
    let slot = tallies.get(muscle);
    if (!slot) {
      slot = {
        entry: { muscle, bodyPart: MUSCLE_TO_BODY_PART[muscle], sets: 0, directSets: 0, reps: 0, volumeKg: 0, exercises: 0 },
        seen: new Set(),
      };
      tallies.set(muscle, slot);
    }
    return slot;
  };

  for (const fact of model.facts) {
    if (!fact.isWorking || !inSpan(fact.startedAt, span)) continue;
    const exercise = model.exercises.get(fact.exerciseId);
    if (!exercise) continue;

    const primary = touch(exercise.primaryMuscle);
    primary.entry.sets += 1;
    primary.entry.directSets += 1;
    primary.entry.reps += fact.reps ?? 0;
    primary.entry.volumeKg += fact.volumeKg;
    primary.seen.add(exercise.id);

    for (const other of exercise.secondaryMuscles) {
      if (other === exercise.primaryMuscle) continue;
      const slot = touch(other);
      slot.entry.sets += SECONDARY_SET_WEIGHT;
      slot.seen.add(exercise.id);
    }
  }

  return [...tallies.values()]
    .map((slot) => ({ ...slot.entry, exercises: slot.seen.size }))
    .sort((a, b) => b.sets - a.sets);
}

export interface BodyPartTally {
  bodyPart: BodyPart;
  sets: number;
  directSets: number;
  volumeKg: number;
}

export function tallyBodyParts(muscles: readonly MuscleTally[]): Map<BodyPart, BodyPartTally> {
  const out = new Map<BodyPart, BodyPartTally>();
  for (const tally of muscles) {
    const entry = out.get(tally.bodyPart) ?? { bodyPart: tally.bodyPart, sets: 0, directSets: 0, volumeKg: 0 };
    entry.sets += tally.sets;
    entry.directSets += tally.directSets;
    entry.volumeKg += tally.volumeKg;
    out.set(tally.bodyPart, entry);
  }
  return out;
}

/** Weeks the span covers, never below one so a 3-day log is not divided by 0.4. */
export function spanWeeks(span: Span, firstSessionAt: number | null): number {
  const from = span.from ?? firstSessionAt ?? span.to;
  return Math.max(1, (span.to - from) / (7 * 86_400_000));
}

export function setsPerWeek(muscles: readonly MuscleTally[], weeks: number): Partial<Record<MuscleGroup, number>> {
  const out: Partial<Record<MuscleGroup, number>> = {};
  for (const tally of muscles) out[tally.muscle] = tally.sets / weeks;
  return out;
}

/**
 * Weighted sets per week for one muscle (or all, when null), for the last
 * `weeks` calendar weeks ending with the current one.
 */
export function weeklyMuscleSets(
  model: Model,
  muscles: readonly MuscleGroup[],
  weeks: number,
  firstDayOfWeek: WeekStart,
  now = new Date(),
): { start: number; values: number[] }[] {
  const current = startOfWeek(now, firstDayOfWeek);
  const starts: number[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) starts.push(addDays(current, -7 * i).getTime());
  const buckets = starts.map((start) => ({ start, values: muscles.map(() => 0) }));
  const first = starts[0]!;
  const index = new Map(muscles.map((muscle, i) => [muscle, i]));

  for (const fact of model.facts) {
    if (!fact.isWorking || fact.startedAt < first) continue;
    const exercise = model.exercises.get(fact.exerciseId);
    if (!exercise) continue;
    // Rounded rather than floored: a daylight-saving change makes a week 167 or 169 hours.
    const week = Math.round((startOfWeek(new Date(fact.startedAt), firstDayOfWeek).getTime() - first) / (7 * 86_400_000));
    const bucket = buckets[week];
    if (!bucket) continue;

    const primary = index.get(exercise.primaryMuscle);
    if (primary !== undefined) bucket.values[primary]! += 1;
    for (const other of exercise.secondaryMuscles) {
      if (other === exercise.primaryMuscle) continue;
      const slot = index.get(other);
      if (slot !== undefined) bucket.values[slot]! += SECONDARY_SET_WEIGHT;
    }
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export interface ExerciseSummary {
  exercise: ExerciseInfo;
  /** Sessions it appeared in, within the span. */
  times: number;
  sets: number;
  reps: number;
  volumeKg: number;
  bestOneRepMaxKg: number;
  heaviestKg: number;
  lastPerformedAt: number;
}

export function summarizeExercises(model: Model, span: Span): ExerciseSummary[] {
  const byExercise = new Map<string, ExerciseSummary & { sessions: Set<string> }>();

  for (const fact of model.facts) {
    if (!fact.isWorking || !inSpan(fact.startedAt, span)) continue;
    const exercise = model.exercises.get(fact.exerciseId);
    if (!exercise) continue;

    let entry = byExercise.get(exercise.id);
    if (!entry) {
      entry = {
        exercise,
        times: 0,
        sets: 0,
        reps: 0,
        volumeKg: 0,
        bestOneRepMaxKg: 0,
        heaviestKg: 0,
        lastPerformedAt: 0,
        sessions: new Set(),
      };
      byExercise.set(exercise.id, entry);
    }
    entry.sets += 1;
    entry.reps += fact.reps ?? 0;
    entry.volumeKg += fact.volumeKg;
    entry.bestOneRepMaxKg = Math.max(entry.bestOneRepMaxKg, fact.oneRepMaxKg);
    entry.heaviestKg = Math.max(entry.heaviestKg, fact.effectiveKg);
    entry.lastPerformedAt = Math.max(entry.lastPerformedAt, fact.startedAt);
    entry.sessions.add(fact.sessionId);
  }

  return [...byExercise.values()]
    .map(({ sessions, ...rest }) => ({ ...rest, times: sessions.size }))
    .sort((a, b) => b.times - a.times || b.sets - a.sets || a.exercise.name.localeCompare(b.exercise.name));
}

/** Best estimated 1RM per session, oldest first, for one exercise. */
export function oneRepMaxSeries(model: Model, exerciseId: string, span: Span): { t: number; value: number }[] {
  const best = new Map<string, { t: number; value: number }>();
  for (const fact of model.factsByExercise.get(exerciseId) ?? []) {
    if (!fact.isWorking || fact.oneRepMaxKg <= 0 || !inSpan(fact.startedAt, span)) continue;
    const current = best.get(fact.sessionId);
    if (!current || fact.oneRepMaxKg > current.value) best.set(fact.sessionId, { t: fact.startedAt, value: fact.oneRepMaxKg });
  }
  return [...best.values()].sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export const LEADERBOARD_MIN_SESSIONS = 3;
const LEADERBOARD_EQUIPMENT: readonly Equipment[] = ["barbell", "dumbbell", "kettlebell", "smith_machine", "bodyweight"];
const LEADERBOARD_TRACKING: readonly TrackingType[] = ["weight_reps", "weighted_bodyweight"];

/** Free-weight lifts measured by load: the ones a 1RM comparison means something for. */
export function isLeaderboardEligible(exercise: ExerciseInfo): boolean {
  return (
    !exercise.isCustom &&
    !exercise.isArchived &&
    LEADERBOARD_EQUIPMENT.includes(exercise.equipment) &&
    LEADERBOARD_TRACKING.includes(exercise.trackingType)
  );
}

export interface LeaderboardEntry {
  exercise: ExerciseInfo;
  sessions: number;
  bestOneRepMaxKg: number;
  bestSetWeightKg: number;
  bestSetReps: number;
  achievedAt: number;
  heaviestKg: number;
  bodyweightMultiple: number | null;
}

export function leaderboard(model: Model): { qualified: LeaderboardEntry[]; pending: LeaderboardEntry[] } {
  const bodyweightKg = model.latestBodyweightKg;
  const entries = new Map<string, LeaderboardEntry & { seen: Set<string> }>();

  for (const fact of model.facts) {
    if (!fact.isWorking || fact.oneRepMaxKg <= 0) continue;
    const exercise = model.exercises.get(fact.exerciseId);
    if (!exercise || !isLeaderboardEligible(exercise)) continue;

    let entry = entries.get(exercise.id);
    if (!entry) {
      entry = {
        exercise,
        sessions: 0,
        bestOneRepMaxKg: 0,
        bestSetWeightKg: 0,
        bestSetReps: 0,
        achievedAt: 0,
        heaviestKg: 0,
        bodyweightMultiple: null,
        seen: new Set(),
      };
      entries.set(exercise.id, entry);
    }
    if (fact.oneRepMaxKg > entry.bestOneRepMaxKg) {
      entry.bestOneRepMaxKg = fact.oneRepMaxKg;
      entry.bestSetWeightKg = fact.effectiveKg;
      entry.bestSetReps = fact.reps ?? 0;
      entry.achievedAt = fact.startedAt;
    }
    entry.heaviestKg = Math.max(entry.heaviestKg, fact.effectiveKg);
    entry.seen.add(fact.sessionId);
  }

  const all: LeaderboardEntry[] = [...entries.values()].map(({ seen, ...rest }) => ({
    ...rest,
    sessions: seen.size,
    bodyweightMultiple: bodyweightKg && bodyweightKg > 0 ? rest.bestOneRepMaxKg / bodyweightKg : null,
  }));
  const byStrength = (a: LeaderboardEntry, b: LeaderboardEntry) =>
    b.bestOneRepMaxKg - a.bestOneRepMaxKg || a.exercise.name.localeCompare(b.exercise.name);

  return {
    qualified: all.filter((entry) => entry.sessions >= LEADERBOARD_MIN_SESSIONS).sort(byStrength),
    pending: all
      .filter((entry) => entry.sessions < LEADERBOARD_MIN_SESSIONS)
      .sort((a, b) => b.sessions - a.sessions || byStrength(a, b)),
  };
}

// ---------------------------------------------------------------------------
// Buckets over time
// ---------------------------------------------------------------------------

export interface TimeBucket extends PeriodTotals {
  start: number;
  label: string;
}

/**
 * Sessions summed into consecutive buckets. `starts` must be ascending; a
 * session lands in the last bucket whose start is at or before it.
 */
export function bucketSessions(
  model: Model,
  buckets: readonly { start: number; label: string }[],
  to: number,
  /** Window start, when the first bucket opens before it (a 30-day window starting mid-week). */
  from: number | null = null,
): TimeBucket[] {
  const out: TimeBucket[] = buckets.map((bucket) => ({ ...bucket, ...emptyTotals() }));
  if (out.length === 0) return out;
  const daySets = out.map(() => new Set<string>());
  const floor = Math.max(out[0]!.start, from ?? -Infinity);

  for (const session of model.sessions) {
    if (session.startedAt < floor || session.startedAt >= to) continue;
    let index = out.length - 1;
    while (index > 0 && out[index]!.start > session.startedAt) index -= 1;
    const bucket = out[index]!;
    bucket.sessions += 1;
    bucket.volumeKg += session.volumeKg;
    bucket.sets += session.workingSets;
    bucket.reps += session.reps;
    bucket.durationSeconds += session.durationSeconds;
    const date = new Date(session.startedAt);
    daySets[index]!.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
  }

  for (const record of model.records) {
    if (record.achievedAt < floor || record.achievedAt >= to) continue;
    let index = out.length - 1;
    while (index > 0 && out[index]!.start > record.achievedAt) index -= 1;
    out[index]!.records += 1;
  }

  out.forEach((bucket, index) => (bucket.activeDays = daySets[index]!.size));
  return out;
}
