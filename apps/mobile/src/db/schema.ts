/**
 * On-device SQLite schema (Drizzle).
 *
 * Conventions that hold across every syncable table:
 *
 * - **`id` is a client-generated UUIDv7** (or a stable slug for built-in
 *   exercises). Nothing waits on the server to learn its own identity.
 * - **`updatedAt` / `deletedAt` are raw epoch-ms integers.** They are sync
 *   bookkeeping, compared numerically on both ends, never displayed.
 * - **Domain timestamps use Drizzle's `timestamp_ms` mode** and surface as
 *   `Date`, because the UI actually formats them.
 * - **Deletes are soft.** A hard DELETE cannot replicate. The other device has
 *   no way to learn the row ever existed. `deletedAt` is the tombstone.
 * - **`position` is a REAL, not an INTEGER.** Drag-to-reorder can then insert
 *   between two neighbours (1.0, 1.5, 2.0) by writing one row instead of
 *   renumbering the whole list.
 */

import { relations, sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type {
  AiRole,
  CoachThreadKind,
  DistanceUnit,
  Equipment,
  MeasurementKind,
  MuscleGroup,
  PrKind,
  SetType,
  SyncState,
  TrackingType,
  WeightUnit,
} from '@lift/shared';

// ---------------------------------------------------------------------------
// Shared column groups
// ---------------------------------------------------------------------------

const now = () => Date.now();

/** Sync bookkeeping carried by every replicated table. */
const syncColumns = {
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
  /** Non-null means deleted. Rows are retained so the tombstone can replicate. */
  deletedAt: integer('deleted_at'),
  /** Local-only: has this row been pushed yet? Never sent to the server. */
  syncState: text('sync_state').notNull().$type<SyncState>().default('pending'),
};

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export const exercises = sqliteTable(
  'exercises',
  {
    /** Slug (`bench-press-barbell`) for built-ins, UUIDv7 for custom. */
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    equipment: text('equipment').notNull().$type<Equipment>(),
    primaryMuscle: text('primary_muscle').notNull().$type<MuscleGroup>(),
    secondaryMuscles: text('secondary_muscles', { mode: 'json' })
      .notNull()
      .$type<MuscleGroup[]>()
      .default([]),
    trackingType: text('tracking_type').notNull().$type<TrackingType>(),
    /** Built-ins ship with the app and never sync; only custom rows replicate. */
    isCustom: integer('is_custom', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes'),
    imageUrl: text('image_url'),
    /**
     * Demonstration media from the bundled catalog. Remote URLs, not downloaded
     * assets. The catalog is ~6,800 exercises and shipping their clips would
     * be gigabytes. Both are null for custom exercises and for the slice of the
     * catalog the upstream source has no media for.
     */
    thumbnailUrl: text('thumbnail_url'),
    videoUrl: text('video_url'),
    /** Hidden from pickers without losing the history that references it. */
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    /** Per-exercise rest override; falls back to the global default when null. */
    defaultRestSeconds: integer('default_rest_seconds'),
    /**
     * Per-exercise display units; null follows the app-wide setting.
     *
     * A gym is not one unit. The dumbbell rack is stamped in pounds, the plates
     * on the rack next to it are kilos, and a treadmill reports miles whatever
     * the rest of the room does, so the unit belongs to the movement, the way
     * `defaultRestSeconds` does, and not to the app or to one session. The
     * column changes nothing about storage: weights are still kept in kilos and
     * distances in kilometres, and this only decides what the user is shown and
     * what their typing is read as.
     *
     * Null rather than a default so that "I have never said" stays
     * distinguishable from "I said kilos". Someone who flips the app-wide
     * setting expects every exercise they have not spoken for to follow.
     */
    weightUnit: text('weight_unit').$type<WeightUnit>(),
    distanceUnit: text('distance_unit').$type<DistanceUnit>(),
    ...syncColumns,
  },
  (table) => [
    index('exercises_name_idx').on(table.name),
    index('exercises_muscle_idx').on(table.primaryMuscle),
    index('exercises_equipment_idx').on(table.equipment),
  ],
);

// ---------------------------------------------------------------------------
// Routines (templates)
// ---------------------------------------------------------------------------

export const routineFolders = sqliteTable(
  'routine_folders',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    position: real('position').notNull().default(0),
    ...syncColumns,
  },
  (table) => [index('routine_folders_position_idx').on(table.position)],
);

export const routines = sqliteTable(
  'routines',
  {
    id: text('id').primaryKey(),
    /** Null means the routine sits at the top level, outside any folder. */
    folderId: text('folder_id').references(() => routineFolders.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    notes: text('notes'),
    isNotesPinned: integer('is_notes_pinned', { mode: 'boolean' }).notNull().default(false),
    position: real('position').notNull().default(0),
    lastPerformedAt: integer('last_performed_at', { mode: 'timestamp_ms' }),
    ...syncColumns,
  },
  (table) => [
    index('routines_folder_idx').on(table.folderId),
    index('routines_position_idx').on(table.position),
  ],
);

export const routineExercises = sqliteTable(
  'routine_exercises',
  {
    id: text('id').primaryKey(),
    routineId: text('routine_id')
      .notNull()
      .references(() => routines.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    position: real('position').notNull().default(0),
    notes: text('notes'),
    isNotesPinned: integer('is_notes_pinned', { mode: 'boolean' }).notNull().default(false),
    restSeconds: integer('rest_seconds'),
    /**
     * Exercises sharing a non-null group id are performed as a superset.
     * Nullable because most exercises stand alone.
     */
    supersetGroup: integer('superset_group'),
    ...syncColumns,
  },
  (table) => [
    index('routine_exercises_routine_idx').on(table.routineId),
    index('routine_exercises_exercise_idx').on(table.exerciseId),
  ],
);

/** The prescribed sets of a routine. Targets, not performed work. */
export const routineSets = sqliteTable(
  'routine_sets',
  {
    id: text('id').primaryKey(),
    routineExerciseId: text('routine_exercise_id')
      .notNull()
      .references(() => routineExercises.id, { onDelete: 'cascade' }),
    position: real('position').notNull().default(0),
    setType: text('set_type').notNull().$type<SetType>().default('normal'),
    targetReps: integer('target_reps'),
    targetWeightKg: real('target_weight_kg'),
    targetDurationSeconds: integer('target_duration_seconds'),
    targetDistanceKm: real('target_distance_km'),
    targetRpe: real('target_rpe'),
    ...syncColumns,
  },
  (table) => [index('routine_sets_parent_idx').on(table.routineExerciseId)],
);

// ---------------------------------------------------------------------------
// Workouts (performed sessions)
// ---------------------------------------------------------------------------

export const workouts = sqliteTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    /** Which routine this was started from, if any. Kept for "last time" lookups. */
    routineId: text('routine_id').references(() => routines.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    notes: text('notes'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * Null marks the session as *in progress*. Making the active workout an
     * ordinary row rather than in-memory state means a crash or force-quit
     * loses nothing: the logger just reopens it on next launch.
     */
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    /** Wall-clock minus paused time; not derivable from the timestamps alone. */
    durationSeconds: integer('duration_seconds'),
    /** Denormalised so the history list doesn't aggregate thousands of sets. */
    totalVolumeKg: real('total_volume_kg').notNull().default(0),
    totalSets: integer('total_sets').notNull().default(0),
    totalReps: integer('total_reps').notNull().default(0),
    prCount: integer('pr_count').notNull().default(0),
    ...syncColumns,
  },
  (table) => [
    index('workouts_started_idx').on(table.startedAt),
    index('workouts_finished_idx').on(table.finishedAt),
    index('workouts_routine_idx').on(table.routineId),
  ],
);

export const workoutExercises = sqliteTable(
  'workout_exercises',
  {
    id: text('id').primaryKey(),
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    position: real('position').notNull().default(0),
    notes: text('notes'),
    restSeconds: integer('rest_seconds'),
    supersetGroup: integer('superset_group'),
    ...syncColumns,
  },
  (table) => [
    index('workout_exercises_workout_idx').on(table.workoutId),
    // Drives the entire per-exercise history and progress screen.
    index('workout_exercises_exercise_idx').on(table.exerciseId),
  ],
);

export const workoutSets = sqliteTable(
  'workout_sets',
  {
    id: text('id').primaryKey(),
    workoutExerciseId: text('workout_exercise_id')
      .notNull()
      .references(() => workoutExercises.id, { onDelete: 'cascade' }),
    position: real('position').notNull().default(0),
    setType: text('set_type').notNull().$type<SetType>().default('normal'),
    /** Always kilograms. Display units are applied at the edge. */
    weightKg: real('weight_kg'),
    reps: integer('reps'),
    durationSeconds: integer('duration_seconds'),
    distanceKm: real('distance_km'),
    rpe: real('rpe'),
    /** Unchecked sets are planned-but-not-done; they contribute nothing to stats. */
    isCompleted: integer('is_completed', { mode: 'boolean' }).notNull().default(false),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    ...syncColumns,
  },
  (table) => [index('workout_sets_parent_idx').on(table.workoutExerciseId)],
);

// ---------------------------------------------------------------------------
// Records & measurements
// ---------------------------------------------------------------------------

export const personalRecords = sqliteTable(
  'personal_records',
  {
    id: text('id').primaryKey(),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<PrKind>(),
    /** Canonical unit for the kind: kg, reps, seconds or km. */
    value: real('value').notNull(),
    /** Reps at which a weight record was set, for "100 kg × 5" style display. */
    reps: integer('reps'),
    setId: text('set_id').references(() => workoutSets.id, { onDelete: 'set null' }),
    workoutId: text('workout_id').references(() => workouts.id, { onDelete: 'cascade' }),
    achievedAt: integer('achieved_at', { mode: 'timestamp_ms' }).notNull(),
    ...syncColumns,
  },
  (table) => [
    // The hot path: "best ever for this exercise and kind".
    index('personal_records_exercise_kind_idx').on(table.exerciseId, table.kind),
    index('personal_records_workout_idx').on(table.workoutId),
  ],
);

export const bodyMeasurements = sqliteTable(
  'body_measurements',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull().$type<MeasurementKind>(),
    /** kg for bodyweight, percent for body fat, cm for every circumference. */
    value: real('value').notNull(),
    measuredAt: integer('measured_at', { mode: 'timestamp_ms' }).notNull(),
    notes: text('notes'),
    ...syncColumns,
  },
  (table) => [index('body_measurements_kind_date_idx').on(table.kind, table.measuredAt)],
);

// ---------------------------------------------------------------------------
// Local-only tables (never synced)
// ---------------------------------------------------------------------------

/** Simple key/value store for preferences. Values are JSON-encoded. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
});

/**
 * Outbound mutation log.
 *
 * Every local write appends here. The sync engine drains it in `seq` order,
 * which preserves causality. A set can never reach the server before the
 * workout it belongs to. Entries are deleted once the server acknowledges them.
 */
export const syncOplog = sqliteTable(
  'sync_oplog',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    op: text('op').notNull().$type<'upsert' | 'delete'>(),
    /** Full row snapshot as JSON; null for deletes. */
    payload: text('payload'),
    updatedAt: integer('updated_at').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    /** Retry counter, so a permanently-rejected mutation can be quarantined. */
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (table) => [index('sync_oplog_row_idx').on(table.tableName, table.rowId)],
);

/** Sync bookkeeping: pull cursor, device id, last successful sync. */
export const syncMeta = sqliteTable('sync_meta', {
  key: text('key').primaryKey(),
  value: text('value'),
});

// ---------------------------------------------------------------------------
// Coach threads
// ---------------------------------------------------------------------------

/**
 * Conversations with a language model, and why they do not replicate.
 *
 * These two tables are **deliberately absent from `SYNCABLE_TABLES`**, and that
 * is a wire-compatibility decision rather than a privacy one. `sync.controller`
 * parses a whole push body against `z.enum(SYNCABLE_TABLES)` and rejects it
 * entire, so a phone that took an over-the-air update and queued `coach_threads`
 * rows against a self-hosted API that has not been redeployed gets a 400 for
 * every mutation in the batch, including the workout it just finished. The
 * engine only retires an entry on a returned conflict, so nothing would drain
 * and the oplog would wedge permanently.
 *
 * The type system already enforces it: `trackUpsert` takes a `SyncableTable`, so
 * these tables cannot be handed to it even by accident. They are written with
 * plain inserts.
 *
 * Not replicating is not the same as not being the user's, so both tables are
 * listed explicitly in `buildBackup`. That function dumps a hardcoded set, and a
 * table missing from it disappears from the escape hatch without a word.
 */
export const coachThreads = sqliteTable(
  'coach_threads',
  {
    id: text('id').primaryKey(),
    /**
     * Which surface opened it. `review` is the coach chat, `session` a finish
     * screen summary, `advice` the volume advisor, `stats` a statistics reading.
     */
    kind: text('kind').notNull().$type<CoachThreadKind>(),
    title: text('title').notNull(),
    /**
     * What the thread is about, for the kinds that are about one row: the
     * workout id for a session summary. Null for a free conversation.
     *
     * This is what stops a summary being regenerated, and re-billed, every time
     * someone reopens a workout they finished last Tuesday.
     */
    subjectId: text('subject_id'),
    /**
     * `COACH_PROMPT_VERSION` at the time it was asked.
     *
     * A stored answer outlives the document it was written against. Someone
     * comparing two reviews months apart can see whether they were even asked
     * the same question.
     */
    promptVersion: integer('prompt_version').notNull(),
    /** The model that answered, for the same reason. Opinions are not portable. */
    model: text('model').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => [index('coach_threads_subject_idx').on(table.kind, table.subjectId)],
);

/**
 * One turn.
 *
 * The first user message of a `review` thread is the whole training document,
 * tens of thousands of characters of it. Stored rather than rebuilt because the
 * log moves: rebuilding it to ask a follow-up would silently change the evidence
 * under an answer that has already been given.
 */
export const coachMessages = sqliteTable(
  'coach_messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => coachThreads.id, { onDelete: 'cascade' }),
    role: text('role').notNull().$type<AiRole>(),
    content: text('content').notNull(),
    position: real('position').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (table) => [index('coach_messages_thread_idx').on(table.threadId, table.position)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const exercisesRelations = relations(exercises, ({ many }) => ({
  workoutExercises: many(workoutExercises),
  routineExercises: many(routineExercises),
  personalRecords: many(personalRecords),
}));

export const routineFoldersRelations = relations(routineFolders, ({ many }) => ({
  routines: many(routines),
}));

export const routinesRelations = relations(routines, ({ one, many }) => ({
  folder: one(routineFolders, {
    fields: [routines.folderId],
    references: [routineFolders.id],
  }),
  exercises: many(routineExercises),
}));

export const routineExercisesRelations = relations(routineExercises, ({ one, many }) => ({
  routine: one(routines, {
    fields: [routineExercises.routineId],
    references: [routines.id],
  }),
  exercise: one(exercises, {
    fields: [routineExercises.exerciseId],
    references: [exercises.id],
  }),
  sets: many(routineSets),
}));

export const routineSetsRelations = relations(routineSets, ({ one }) => ({
  routineExercise: one(routineExercises, {
    fields: [routineSets.routineExerciseId],
    references: [routineExercises.id],
  }),
}));

export const workoutsRelations = relations(workouts, ({ one, many }) => ({
  routine: one(routines, {
    fields: [workouts.routineId],
    references: [routines.id],
  }),
  exercises: many(workoutExercises),
  personalRecords: many(personalRecords),
}));

export const workoutExercisesRelations = relations(workoutExercises, ({ one, many }) => ({
  workout: one(workouts, {
    fields: [workoutExercises.workoutId],
    references: [workouts.id],
  }),
  exercise: one(exercises, {
    fields: [workoutExercises.exerciseId],
    references: [exercises.id],
  }),
  sets: many(workoutSets),
}));

export const workoutSetsRelations = relations(workoutSets, ({ one }) => ({
  workoutExercise: one(workoutExercises, {
    fields: [workoutSets.workoutExerciseId],
    references: [workoutExercises.id],
  }),
}));

export const personalRecordsRelations = relations(personalRecords, ({ one }) => ({
  exercise: one(exercises, {
    fields: [personalRecords.exerciseId],
    references: [exercises.id],
  }),
  workout: one(workouts, {
    fields: [personalRecords.workoutId],
    references: [workouts.id],
  }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Exercise = typeof exercises.$inferSelect;
export type NewExercise = typeof exercises.$inferInsert;
export type RoutineFolder = typeof routineFolders.$inferSelect;
export type Routine = typeof routines.$inferSelect;
export type NewRoutine = typeof routines.$inferInsert;
export type RoutineExercise = typeof routineExercises.$inferSelect;
export type RoutineSet = typeof routineSets.$inferSelect;
export type Workout = typeof workouts.$inferSelect;
export type NewWorkout = typeof workouts.$inferInsert;
export type WorkoutExercise = typeof workoutExercises.$inferSelect;
export type WorkoutSet = typeof workoutSets.$inferSelect;
export type NewWorkoutSet = typeof workoutSets.$inferInsert;
export type PersonalRecord = typeof personalRecords.$inferSelect;
export type BodyMeasurement = typeof bodyMeasurements.$inferSelect;
export type SyncOplogEntry = typeof syncOplog.$inferSelect;

/** Every syncable table, keyed by its wire name. Used by the sync engine. */
export const SYNC_TABLE_MAP = {
  exercises,
  routine_folders: routineFolders,
  routines,
  routine_exercises: routineExercises,
  routine_sets: routineSets,
  workouts,
  workout_exercises: workoutExercises,
  workout_sets: workoutSets,
  personal_records: personalRecords,
  body_measurements: bodyMeasurements,
} as const;

export { sql };
