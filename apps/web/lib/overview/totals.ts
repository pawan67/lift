/**
 * Period totals and body-part tallies shared by the dashboard, history and the
 * session detail. Everything here is a pure function of model data.
 */

import { BODY_PARTS, MUSCLE_TO_BODY_PART, type BodyPart } from "@lift/shared";

import type { Session, SessionExercise } from "@/lib/data/model";
import { advance, startOfWeek, type WeekStart } from "@/lib/stats/windows";

/** A set aimed at a muscle only indirectly counts half. Same rule as the phone. */
export const SECONDARY_SET_WEIGHT = 0.5;

export type TrendMetric = "volume" | "duration" | "reps" | "sets";

export interface PeriodTotals {
  sessions: number;
  volumeKg: number;
  durationSeconds: number;
  sets: number;
  reps: number;
}

export const EMPTY_TOTALS: PeriodTotals = { sessions: 0, volumeKg: 0, durationSeconds: 0, sets: 0, reps: 0 };

export function pickMetric(totals: PeriodTotals, metric: TrendMetric): number {
  switch (metric) {
    case "volume":
      return totals.volumeKg;
    case "duration":
      return totals.durationSeconds;
    case "reps":
      return totals.reps;
    case "sets":
      return totals.sets;
  }
}

function add(totals: PeriodTotals, session: Session): void {
  totals.sessions += 1;
  totals.volumeKg += session.volumeKg;
  totals.durationSeconds += session.durationSeconds;
  totals.sets += session.workingSets;
  totals.reps += session.reps;
}

/** Totals of sessions started in [from, to). */
export function totalsBetween(sessions: readonly Session[], from: number, to: number): PeriodTotals {
  const totals = { ...EMPTY_TOTALS };
  for (const session of sessions) {
    if (session.startedAt >= from && session.startedAt < to) add(totals, session);
  }
  return totals;
}

export interface WeekBucket {
  start: Date;
  totals: PeriodTotals;
}

/** The last `weeks` calendar weeks, oldest first, the current week last. */
export function weeklyBuckets(sessions: readonly Session[], weeks: number, firstDayOfWeek: WeekStart, now = new Date()): WeekBucket[] {
  const current = startOfWeek(now, firstDayOfWeek);
  const buckets: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) buckets.push({ start: advance(current, "week", -i), totals: { ...EMPTY_TOTALS } });

  const first = buckets[0]!.start.getTime();
  for (const session of sessions) {
    if (session.startedAt < first) continue;
    const index = Math.floor((startOfWeek(new Date(session.startedAt), firstDayOfWeek).getTime() - first) / (7 * 86_400_000) + 0.5);
    const bucket = buckets[index];
    if (bucket) add(bucket.totals, session);
  }
  return buckets;
}

/**
 * Working sets per body part since `from`, primary muscle whole and secondary
 * muscles at half. That is a stimulus question ("what has been trained lately"),
 * so the shares do not have to add to the session's own set count.
 */
export function setsByBodyPart(sessions: readonly Session[], from: number): { part: BodyPart; sets: number }[] {
  const tally = new Map<BodyPart, number>();
  for (const session of sessions) {
    if (session.startedAt < from) continue;
    for (const block of session.exercises) {
      const working = block.sets.filter((set) => set.isWorking).length;
      if (working === 0) continue;
      const primary = MUSCLE_TO_BODY_PART[block.exercise.primaryMuscle];
      tally.set(primary, (tally.get(primary) ?? 0) + working);
      // One credit per body part: a curl's biceps and forearms are both "arms".
      const secondaryParts = new Set(block.exercise.secondaryMuscles.map((muscle) => MUSCLE_TO_BODY_PART[muscle]));
      secondaryParts.delete(primary);
      for (const part of secondaryParts) tally.set(part, (tally.get(part) ?? 0) + working * SECONDARY_SET_WEIGHT);
    }
  }
  return BODY_PARTS.map((part) => ({ part, sets: tally.get(part) ?? 0 }))
    .filter((entry) => entry.sets > 0)
    .sort((a, b) => b.sets - a.sets);
}

/**
 * One session's sets by body part, primary muscle only, so the shares add to
 * 100% and can be checked against the set count beside them.
 */
export function sessionMuscleSplit(blocks: readonly SessionExercise[]): { part: BodyPart; sets: number; share: number }[] {
  const byPart = new Map<BodyPart, number>();
  let total = 0;
  for (const block of blocks) {
    const part = MUSCLE_TO_BODY_PART[block.exercise.primaryMuscle];
    for (const set of block.sets) {
      if (!set.isWorking) continue;
      byPart.set(part, (byPart.get(part) ?? 0) + 1);
      total += 1;
    }
  }
  if (total === 0) return [];
  return [...byPart].map(([part, sets]) => ({ part, sets, share: sets / total })).sort((a, b) => b.sets - a.sets);
}

/** "Bench Press ×4, Squat ×3, +2 more" style one-liner for a session row. */
export function exerciseSummary(session: Session, limit = 3): string {
  const parts = session.exercises.slice(0, limit).map((block) => {
    const working = block.sets.filter((set) => set.isWorking).length;
    return working > 0 ? `${working} × ${block.exercise.name}` : block.exercise.name;
  });
  const rest = session.exercises.length - limit;
  if (rest > 0) parts.push(`+${rest} more`);
  return parts.join(", ");
}
