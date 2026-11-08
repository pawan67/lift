/**
 * Row shapes as they travel over `/api/sync`: the Postgres columns, camelCase,
 * with every timestamp as epoch milliseconds. `userId` and `seq` arrive on
 * pulled rows and are ignored; the server owns them and drops them on push.
 */

import type {
  Equipment,
  MeasurementKind,
  MuscleGroup,
  PrKind,
  SetType,
  SyncableTable,
  TrackingType,
  WeightUnit,
  DistanceUnit,
} from "@lift/shared";

interface SyncColumns {
  id: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface ExerciseRow extends SyncColumns {
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  trackingType: TrackingType;
  isCustom: boolean;
  notes: string | null;
  imageUrl: string | null;
  isArchived: boolean;
  defaultRestSeconds: number | null;
  weightUnit: WeightUnit | null;
  distanceUnit: DistanceUnit | null;
}

export interface RoutineFolderRow extends SyncColumns {
  name: string;
  position: number;
}

export interface RoutineRow extends SyncColumns {
  folderId: string | null;
  name: string;
  notes: string | null;
  position: number;
  lastPerformedAt: number | null;
}

export interface RoutineExerciseRow extends SyncColumns {
  routineId: string;
  exerciseId: string;
  position: number;
  notes: string | null;
  restSeconds: number | null;
  supersetGroup: number | null;
}

export interface RoutineSetRow extends SyncColumns {
  routineExerciseId: string;
  position: number;
  setType: SetType;
  targetReps: number | null;
  targetWeightKg: number | null;
  targetDurationSeconds: number | null;
  targetDistanceKm: number | null;
  targetRpe: number | null;
}

export interface WorkoutRow extends SyncColumns {
  routineId: string | null;
  name: string;
  notes: string | null;
  startedAt: number;
  finishedAt: number | null;
  durationSeconds: number | null;
  totalVolumeKg: number;
  totalSets: number;
  totalReps: number;
  prCount: number;
}

export interface WorkoutExerciseRow extends SyncColumns {
  workoutId: string;
  exerciseId: string;
  position: number;
  notes: string | null;
  restSeconds: number | null;
  supersetGroup: number | null;
}

export interface WorkoutSetRow extends SyncColumns {
  workoutExerciseId: string;
  position: number;
  setType: SetType;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceKm: number | null;
  rpe: number | null;
  isCompleted: boolean;
  completedAt: number | null;
}

export interface PersonalRecordRow extends SyncColumns {
  exerciseId: string;
  kind: PrKind;
  value: number;
  reps: number | null;
  setId: string | null;
  workoutId: string | null;
  achievedAt: number;
}

export interface BodyMeasurementRow extends SyncColumns {
  kind: MeasurementKind;
  value: number;
  measuredAt: number;
  notes: string | null;
}

export interface TableRows {
  exercises: ExerciseRow;
  routine_folders: RoutineFolderRow;
  routines: RoutineRow;
  routine_exercises: RoutineExerciseRow;
  routine_sets: RoutineSetRow;
  workouts: WorkoutRow;
  workout_exercises: WorkoutExerciseRow;
  workout_sets: WorkoutSetRow;
  personal_records: PersonalRecordRow;
  body_measurements: BodyMeasurementRow;
}

export type AnyRow = TableRows[SyncableTable];

/** One table's rows, by id. Tombstoned rows are kept so a later pull can't resurrect them. */
export type TableMap<T extends SyncableTable> = Map<string, TableRows[T]>;

export type Tables = { [T in SyncableTable]: TableMap<T> };
