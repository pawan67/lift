/**
 * The log, joined and indexed once per change, for every screen to read.
 *
 * Built from the raw tables in one linear pass and memoised on the store's
 * `version`, so a screen asks for `useModel()` and gets plain arrays and maps:
 * no queries, no per-row subscriptions. Anything screen-specific (a range, a
 * chart's buckets) is derived from this with `useMemo` in the screen.
 *
 * Conventions every consumer can rely on:
 * - Tombstoned rows (`deletedAt !== null`) are absent everywhere.
 * - `sessions` holds finished workouts only, newest first. An unfinished
 *   workout is a session in progress on the phone, not history.
 * - `facts` holds completed sets of those sessions, oldest first, with volume
 *   and estimated 1RM already worked out under the current settings.
 */

"use client";

import type { LibraryExercise } from "@lift/shared/exercises";
import { buildTrainingIndex, type TrainingIndex } from "@lift/shared/exercises/search";
import {
  effectiveWeightKg,
  isWorkingSet,
  setOneRepMaxKg,
  setVolumeKg,
  type Equipment,
  type MeasurementKind,
  type MuscleGroup,
  type OneRepMaxFormula,
  type SetType,
  type TrackingType,
} from "@lift/shared";
import { useMemo } from "react";

import { useSettings } from "../settings";
import { getCatalog } from "./catalog";
import { useData } from "./store";
import type {
  BodyMeasurementRow,
  ExerciseRow,
  PersonalRecordRow,
  RoutineExerciseRow,
  RoutineFolderRow,
  RoutineRow,
  RoutineSetRow,
  Tables,
  WorkoutExerciseRow,
  WorkoutRow,
  WorkoutSetRow,
} from "./types";

export interface ExerciseInfo {
  id: string;
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  trackingType: TrackingType;
  isCustom: boolean;
  isArchived: boolean;
  notes: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  /** The synced row, for custom exercises. */
  row: ExerciseRow | null;
  /**
   * A custom exercise that has since been deleted. Kept in `exercises` so past
   * sessions still show its name, as the phone does, but left out of
   * `exerciseList` so nothing offers it for new use.
   */
  isDeleted?: boolean;
}

export interface SessionSet extends WorkoutSetRow {
  isWorking: boolean;
  volumeKg: number;
  oneRepMaxKg: number;
}

export interface SessionExercise {
  row: WorkoutExerciseRow;
  exercise: ExerciseInfo;
  sets: SessionSet[];
}

export interface Session {
  row: WorkoutRow;
  /** Convenience copies of `row` fields. */
  id: string;
  name: string;
  startedAt: number;
  finishedAt: number;
  durationSeconds: number;
  exercises: SessionExercise[];
  /** Recomputed from the sets with current settings. */
  volumeKg: number;
  workingSets: number;
  reps: number;
  records: PersonalRecordRow[];
}

/** One completed set of a finished session, flattened for analytics. */
export interface SetFact {
  id: string;
  sessionId: string;
  workoutExerciseId: string;
  exerciseId: string;
  startedAt: number;
  setType: SetType;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceKm: number | null;
  rpe: number | null;
  isWorking: boolean;
  /** Load including bodyweight where the tracking type counts it. */
  effectiveKg: number;
  volumeKg: number;
  oneRepMaxKg: number;
}

export interface RoutineExerciseView {
  row: RoutineExerciseRow;
  /** Undefined when the exercise is gone (deleted custom) or unknown. */
  exercise: ExerciseInfo | undefined;
  sets: RoutineSetRow[];
}

export interface RoutineView {
  row: RoutineRow;
  id: string;
  name: string;
  exercises: RoutineExerciseView[];
  /** Most recent finished session started from this routine. */
  lastPerformedAt: number | null;
}

export interface Model {
  exercises: Map<string, ExerciseInfo>;
  /** Live exercises (catalog plus custom), alphabetical. */
  exerciseList: ExerciseInfo[];
  sessions: Session[];
  sessionById: Map<string, Session>;
  facts: SetFact[];
  factsByExercise: Map<string, SetFact[]>;
  /** Sessions each exercise appears in, newest first. */
  sessionsByExercise: Map<string, Session[]>;
  records: PersonalRecordRow[];
  recordsByExercise: Map<string, PersonalRecordRow[]>;
  /** Oldest first, per kind. */
  measurements: Map<MeasurementKind, BodyMeasurementRow[]>;
  latestBodyweightKg: number | null;
  folders: RoutineFolderRow[];
  routines: RoutineView[];
  routineById: Map<string, RoutineView>;
  trainingIndex: TrainingIndex;
  /** Epoch ms of the first finished session, or null. */
  firstSessionAt: number | null;
}

const live = <T extends { deletedAt: number | null }>(map: Map<string, T>): T[] => {
  const out: T[] = [];
  for (const row of map.values()) if (row.deletedAt === null) out.push(row);
  return out;
};

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

function fromLibrary(entry: LibraryExercise): ExerciseInfo {
  return {
    id: entry.id,
    name: entry.name,
    equipment: entry.equipment,
    primaryMuscle: entry.primaryMuscle,
    secondaryMuscles: entry.secondaryMuscles,
    trackingType: entry.trackingType,
    isCustom: false,
    isArchived: false,
    notes: null,
    thumbnailUrl: entry.thumbnailUrl,
    videoUrl: entry.videoUrl,
    row: null,
  };
}

function fromRow(row: ExerciseRow): ExerciseInfo {
  return {
    id: row.id,
    name: row.name,
    equipment: row.equipment,
    primaryMuscle: row.primaryMuscle,
    secondaryMuscles: Array.isArray(row.secondaryMuscles) ? row.secondaryMuscles : [],
    trackingType: row.trackingType,
    isCustom: row.isCustom,
    isArchived: row.isArchived,
    notes: row.notes,
    thumbnailUrl: row.imageUrl,
    videoUrl: null,
    row,
  };
}

/** Placeholder for a set whose exercise is not in the catalog or the log. */
function unknownExercise(id: string): ExerciseInfo {
  return {
    id,
    name: "Unknown exercise",
    equipment: "other",
    primaryMuscle: "other",
    secondaryMuscles: [],
    trackingType: "weight_reps",
    isCustom: true,
    isArchived: true,
    notes: null,
    thumbnailUrl: null,
    videoUrl: null,
    row: null,
  };
}

export function buildModel(tables: Tables, formula: OneRepMaxFormula): Model {
  // --- Exercises -----------------------------------------------------------
  const exercises = new Map<string, ExerciseInfo>();
  for (const entry of getCatalog()) exercises.set(entry.id, fromLibrary(entry));
  for (const row of tables.exercises.values()) {
    // A synced row for a catalog id (rare) keeps the catalog's media.
    const base = exercises.get(row.id);
    const info = fromRow(row);
    if (row.deletedAt !== null) {
      // A tombstone over a catalog id cannot remove a built-in.
      if (base) continue;
      info.isDeleted = true;
      info.isArchived = true;
    }
    if (base) {
      info.thumbnailUrl ??= base.thumbnailUrl;
      info.videoUrl = base.videoUrl;
    }
    exercises.set(row.id, info);
  }
  const exerciseList = [...exercises.values()]
    .filter((exercise) => !exercise.isDeleted)
    .sort((a, b) => a.name.localeCompare(b.name));

  const resolve = (id: string): ExerciseInfo => {
    let info = exercises.get(id);
    if (!info) {
      info = unknownExercise(id);
      exercises.set(id, info);
    }
    return info;
  };

  // --- Measurements --------------------------------------------------------
  const measurements = new Map<MeasurementKind, BodyMeasurementRow[]>();
  for (const row of live(tables.body_measurements)) {
    const list = measurements.get(row.kind);
    if (list) list.push(row);
    else measurements.set(row.kind, [row]);
  }
  for (const list of measurements.values()) list.sort((a, b) => a.measuredAt - b.measuredAt);
  const latestBodyweightKg = measurements.get("bodyweight")?.at(-1)?.value ?? null;
  const bodyweightKg = latestBodyweightKg ?? 0;

  // --- Records ---------------------------------------------------------------
  const records = live(tables.personal_records).sort((a, b) => b.achievedAt - a.achievedAt);
  const recordsByExercise = new Map<string, PersonalRecordRow[]>();
  const recordsByWorkout = new Map<string, PersonalRecordRow[]>();
  for (const record of records) {
    push(recordsByExercise, record.exerciseId, record);
    if (record.workoutId) push(recordsByWorkout, record.workoutId, record);
  }

  // --- Sessions --------------------------------------------------------------
  const setsByParent = new Map<string, WorkoutSetRow[]>();
  for (const set of live(tables.workout_sets)) push(setsByParent, set.workoutExerciseId, set);

  const blocksByWorkout = new Map<string, WorkoutExerciseRow[]>();
  for (const block of live(tables.workout_exercises)) push(blocksByWorkout, block.workoutId, block);

  const sessions: Session[] = [];
  const facts: SetFact[] = [];

  const finished = live(tables.workouts)
    .filter((row) => row.finishedAt !== null)
    .sort((a, b) => a.startedAt - b.startedAt);

  for (const row of finished) {
    const blocks = (blocksByWorkout.get(row.id) ?? []).sort(byPosition);
    let volumeKg = 0;
    let workingSets = 0;
    let reps = 0;

    const sessionExercises: SessionExercise[] = blocks.map((block) => {
      const exercise = resolve(block.exerciseId);
      const ctx = { trackingType: exercise.trackingType, bodyweightKg, formula };

      const sets: SessionSet[] = (setsByParent.get(block.id) ?? []).sort(byPosition).map((set) => {
        const like = { ...set, isCompleted: set.isCompleted };
        const working = set.isCompleted && isWorkingSet(set.setType);
        const volume = setVolumeKg(like, ctx);
        const oneRm = setOneRepMaxKg(like, ctx);

        if (set.isCompleted) {
          facts.push({
            id: set.id,
            sessionId: row.id,
            workoutExerciseId: block.id,
            exerciseId: block.exerciseId,
            startedAt: row.startedAt,
            setType: set.setType,
            weightKg: set.weightKg,
            reps: set.reps,
            durationSeconds: set.durationSeconds,
            distanceKm: set.distanceKm,
            rpe: set.rpe,
            isWorking: working,
            effectiveKg: effectiveWeightKg(like, ctx),
            volumeKg: volume,
            oneRepMaxKg: oneRm,
          });
        }

        if (working) {
          workingSets += 1;
          reps += set.reps ?? 0;
          volumeKg += volume;
        }

        return { ...set, isWorking: working, volumeKg: volume, oneRepMaxKg: oneRm };
      });

      return { row: block, exercise, sets };
    });

    sessions.push({
      row,
      id: row.id,
      name: row.name,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt!,
      durationSeconds: row.durationSeconds ?? Math.max(0, Math.round((row.finishedAt! - row.startedAt) / 1000)),
      exercises: sessionExercises,
      volumeKg,
      workingSets,
      reps,
      records: recordsByWorkout.get(row.id) ?? [],
    });
  }

  const factsByExercise = new Map<string, SetFact[]>();
  for (const fact of facts) push(factsByExercise, fact.exerciseId, fact);

  sessions.reverse(); // newest first
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const sessionsByExercise = new Map<string, Session[]>();
  for (const session of sessions) {
    const seen = new Set<string>();
    for (const block of session.exercises) {
      if (seen.has(block.exercise.id)) continue;
      seen.add(block.exercise.id);
      push(sessionsByExercise, block.exercise.id, session);
    }
  }

  const trainingIndex = buildTrainingIndex(
    sessions.flatMap((session) =>
      session.exercises.map((block) => ({
        workoutId: session.id,
        exerciseId: block.exercise.id,
        startedAt: new Date(session.startedAt),
      })),
    ),
  );

  // --- Routines ----------------------------------------------------------------
  const routineSetsByParent = new Map<string, RoutineSetRow[]>();
  for (const set of live(tables.routine_sets)) push(routineSetsByParent, set.routineExerciseId, set);
  const routineBlocks = new Map<string, RoutineExerciseRow[]>();
  for (const block of live(tables.routine_exercises)) push(routineBlocks, block.routineId, block);

  const lastByRoutine = new Map<string, number>();
  for (const session of sessions) {
    const routineId = session.row.routineId;
    if (routineId && !lastByRoutine.has(routineId)) lastByRoutine.set(routineId, session.startedAt);
  }

  const routines: RoutineView[] = live(tables.routines)
    .sort(byPosition)
    .map((row) => ({
      row,
      id: row.id,
      name: row.name,
      exercises: (routineBlocks.get(row.id) ?? []).sort(byPosition).map((block) => ({
        row: block,
        exercise: exercises.get(block.exerciseId),
        sets: (routineSetsByParent.get(block.id) ?? []).sort(byPosition),
      })),
      lastPerformedAt: lastByRoutine.get(row.id) ?? row.lastPerformedAt ?? null,
    }));

  return {
    exercises,
    exerciseList,
    sessions,
    sessionById,
    facts,
    factsByExercise,
    sessionsByExercise,
    records,
    recordsByExercise,
    measurements,
    latestBodyweightKg,
    folders: live(tables.routine_folders).sort(byPosition),
    routines,
    routineById: new Map(routines.map((routine) => [routine.id, routine])),
    trainingIndex,
    firstSessionAt: sessions.at(-1)?.startedAt ?? null,
  };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

let cache: { version: number; formula: OneRepMaxFormula; model: Model } | null = null;

/** One model per data version and formula, shared by every screen that asks. */
function modelFor(version: number, formula: OneRepMaxFormula): Model {
  if (cache && cache.version === version && cache.formula === formula) return cache.model;
  const model = buildModel(useData.getState().tables, formula);
  cache = { version, formula, model };
  return model;
}

/** The model for the current data. Re-renders the caller when the data changes. */
export function useModel(): Model {
  const version = useData((state) => state.version);
  const formula = useSettings((state) => state.oneRepMaxFormula);
  return useMemo(() => modelFor(version, formula), [version, formula]);
}
