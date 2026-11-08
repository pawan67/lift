/**
 * One exercise's history, rolled up per session for the detail page.
 *
 * The per-session figures follow the phone's `getExerciseProgress`
 * (`apps/mobile/src/features/analytics/repository.ts`): warm-ups excluded,
 * best estimated 1RM, heaviest load, summed volume and reps. Load here is the
 * effective load, so a weighted pull-up's heaviest includes bodyweight, the
 * same figure its 1RM is computed from.
 */

import { TRACKING_FIELDS, USES_BODYWEIGHT, type PrKind, type TrackingType } from "@lift/shared";

import type { Model, Session, SessionSet } from "@/lib/data/model";
import type { PersonalRecordRow } from "@/lib/data/types";

export interface SessionPoint {
  session: Session;
  t: number;
  /** This exercise's sets in the session, every block of it, in order. */
  sets: SessionSet[];
  oneRepMaxKg: number;
  heaviestKg: number;
  volumeKg: number;
  bestReps: number;
  totalReps: number;
  workingSets: number;
  longestSeconds: number;
  totalSeconds: number;
  distanceKm: number;
}

export type ProgressMetric = "e1rm" | "heaviest" | "volume" | "reps" | "totalReps" | "duration" | "distance";

export const METRIC_LABELS: Record<ProgressMetric, string> = {
  e1rm: "Est. 1RM",
  heaviest: "Heaviest",
  volume: "Volume",
  reps: "Best reps",
  totalReps: "Total reps",
  duration: "Duration",
  distance: "Distance",
};

export function metricsFor(trackingType: TrackingType): ProgressMetric[] {
  const fields = TRACKING_FIELDS[trackingType];
  const loaded = fields.weight || USES_BODYWEIGHT.has(trackingType);
  const metrics: ProgressMetric[] = [];
  if (loaded && fields.reps) metrics.push("e1rm", "heaviest", "volume");
  if (fields.weight && !fields.reps) metrics.push("heaviest");
  if (fields.reps) metrics.push("reps", "totalReps");
  if (fields.distance) metrics.push("distance");
  if (fields.duration) metrics.push("duration");
  return metrics.length > 0 ? metrics : ["totalReps"];
}

export function metricValue(point: SessionPoint, metric: ProgressMetric): number {
  switch (metric) {
    case "e1rm":
      return point.oneRepMaxKg;
    case "heaviest":
      return point.heaviestKg;
    case "volume":
      return point.volumeKg;
    case "reps":
      return point.bestReps;
    case "totalReps":
      return point.totalReps;
    case "duration":
      return point.totalSeconds;
    case "distance":
      return point.distanceKm;
  }
}

/** Sessions containing the exercise, oldest first. */
export function sessionPoints(model: Model, exerciseId: string): SessionPoint[] {
  const sessions = model.sessionsByExercise.get(exerciseId) ?? [];
  const points: SessionPoint[] = [];

  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const session = sessions[index]!;
    const sets = session.exercises.filter((block) => block.exercise.id === exerciseId).flatMap((block) => block.sets);
    const point: SessionPoint = {
      session,
      t: session.startedAt,
      sets,
      oneRepMaxKg: 0,
      heaviestKg: 0,
      volumeKg: 0,
      bestReps: 0,
      totalReps: 0,
      workingSets: 0,
      longestSeconds: 0,
      totalSeconds: 0,
      distanceKm: 0,
    };

    for (const set of sets) {
      if (!set.isWorking) continue;
      point.workingSets += 1;
      point.oneRepMaxKg = Math.max(point.oneRepMaxKg, set.oneRepMaxKg);
      point.volumeKg += set.volumeKg;
      point.bestReps = Math.max(point.bestReps, set.reps ?? 0);
      point.totalReps += set.reps ?? 0;
      point.longestSeconds = Math.max(point.longestSeconds, set.durationSeconds ?? 0);
      point.totalSeconds += set.durationSeconds ?? 0;
      point.distanceKm += set.distanceKm ?? 0;
    }
    points.push(point);
  }

  // Heaviest uses the effective load the model already worked out per set.
  const facts = model.factsByExercise.get(exerciseId) ?? [];
  const heaviest = new Map<string, number>();
  for (const fact of facts) {
    if (!fact.isWorking) continue;
    heaviest.set(fact.sessionId, Math.max(heaviest.get(fact.sessionId) ?? 0, fact.effectiveKg));
  }
  for (const point of points) point.heaviestKg = heaviest.get(point.session.id) ?? 0;

  return points;
}

export interface ExerciseTotals {
  sessions: number;
  workingSets: number;
  totalReps: number;
  volumeKg: number;
  bestOneRepMaxKg: number;
  heaviestKg: number;
  bestSetVolumeKg: number;
  bestReps: number;
  longestSeconds: number;
  farthestKm: number;
  totalSeconds: number;
  totalKm: number;
  firstAt: number | null;
  lastAt: number | null;
}

export function exerciseTotals(model: Model, exerciseId: string, points: SessionPoint[]): ExerciseTotals {
  const totals: ExerciseTotals = {
    sessions: points.length,
    workingSets: 0,
    totalReps: 0,
    volumeKg: 0,
    bestOneRepMaxKg: 0,
    heaviestKg: 0,
    bestSetVolumeKg: 0,
    bestReps: 0,
    longestSeconds: 0,
    farthestKm: 0,
    totalSeconds: 0,
    totalKm: 0,
    firstAt: points[0]?.t ?? null,
    lastAt: points.at(-1)?.t ?? null,
  };

  for (const fact of model.factsByExercise.get(exerciseId) ?? []) {
    if (!fact.isWorking) continue;
    totals.workingSets += 1;
    totals.totalReps += fact.reps ?? 0;
    totals.volumeKg += fact.volumeKg;
    totals.bestOneRepMaxKg = Math.max(totals.bestOneRepMaxKg, fact.oneRepMaxKg);
    totals.heaviestKg = Math.max(totals.heaviestKg, fact.effectiveKg);
    totals.bestSetVolumeKg = Math.max(totals.bestSetVolumeKg, fact.volumeKg);
    totals.bestReps = Math.max(totals.bestReps, fact.reps ?? 0);
    totals.longestSeconds = Math.max(totals.longestSeconds, fact.durationSeconds ?? 0);
    totals.farthestKm = Math.max(totals.farthestKm, fact.distanceKm ?? 0);
    totals.totalSeconds += fact.durationSeconds ?? 0;
    totals.totalKm += fact.distanceKm ?? 0;
  }

  return totals;
}

/** The best record of each kind, highest value, earliest to reach it. */
export function bestRecords(model: Model, exerciseId: string): PersonalRecordRow[] {
  const best = new Map<PrKind, PersonalRecordRow>();
  for (const record of model.recordsByExercise.get(exerciseId) ?? []) {
    const current = best.get(record.kind);
    if (!current || record.value > current.value || (record.value === current.value && record.achievedAt < current.achievedAt)) {
      best.set(record.kind, record);
    }
  }
  return [...best.values()];
}
