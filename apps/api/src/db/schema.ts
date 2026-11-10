/**
 * Server-side Postgres schema.
 *
 * Mirrors the on-device SQLite schema, with two additions that only matter
 * server-side:
 *
 * 1. **`userId`** on every row. SQLite has one user per database, Postgres has
 *    all of them, and every query is scoped by it.
 *
 * 2. **`seq`**, drawn from a single global sequence. This is the pull cursor.
 *    Timestamps cannot do this job: two rows written in the same millisecond
 *    are indistinguishable, and a `WHERE updated_at > cursor` query would skip
 *    one of them forever. A sequence gives a strict total order over every
 *    write, across every table, so pagination can never lose a row.
 */

import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** The single source of ordering for all replicated writes. */
export const syncSeq = pgSequence('sync_seq');

const seqDefault = sql`nextval('sync_seq')`;

/** Columns every replicated table carries. */
const syncColumns = {
  userId: text('user_id').notNull(),
  /** Epoch ms, authored by the client. Used only for last-write-wins. */
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  /** Tombstone. Non-null means deleted. */
  deletedAt: bigint('deleted_at', { mode: 'number' }),
  /** Server-assigned ordering. Bumped on every write. */
  seq: bigint('seq', { mode: 'number' }).notNull().default(seqDefault),
};

// ---------------------------------------------------------------------------
// better-auth tables
// ---------------------------------------------------------------------------
// Shapes are dictated by better-auth's Drizzle adapter. Column names must
// match what it expects.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_user_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('account_user_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

// ---------------------------------------------------------------------------
// Replicated application tables
// ---------------------------------------------------------------------------

/**
 * Parent keys among these ten tables.
 *
 * The device declares eleven of them and runs with `PRAGMA foreign_keys = ON`,
 * so until now the client enforced an integrity rule this server did not: a
 * push carrying a set whose workout never arrived was accepted here and could
 * never be applied there. Eight of the eleven are declared below, so the
 * violation is caught on the way in and answered with `missing_parent`, which
 * the client already treats as retryable rather than fatal.
 *
 * The three deliberately absent ones are every reference to `exercises`:
 * `routine_exercises`, `workout_exercises` and `personal_records` each carry an
 * `exercise_id` that the device does constrain. The built-in catalog is ~6,800
 * rows seeded identically on every install and written straight to
 * `syncState: 'synced'`, and only `isCustom` exercises are ever tracked into
 * the oplog, so the catalog never crosses the wire. Declaring those three keys
 * here would reject essentially every logged set: the exercise it names is on
 * the phone, correctly, and has no reason to exist in Postgres. Making the
 * catalog server-side data first is a far larger change than this one.
 *
 * No `onDelete` action anywhere, on purpose. The client's `cascade` and
 * `set null` fire on hard deletes, which only the device performs. Every delete
 * that reaches this server is a tombstone, an UPDATE, and the single place rows
 * are really removed is the tombstone sweep. A cascade there would hard-delete
 * a live child that no tombstone was ever written for: the row would disappear
 * from Postgres while every device that already pulled it kept it forever, with
 * nothing to replicate the removal. The sweep instead walks children before
 * parents and skips any parent still referenced, which is the same protection
 * without the silent deletion.
 *
 * Each referencing column carries an index. Postgres does not create one for a
 * foreign key, and the sweep asks "is this tombstone still referenced?" once per
 * candidate row.
 */

export const exercises = pgTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    equipment: text('equipment').notNull(),
    primaryMuscle: text('primary_muscle').notNull(),
    secondaryMuscles: jsonb('secondary_muscles').notNull().default([]),
    trackingType: text('tracking_type').notNull(),
    isCustom: boolean('is_custom').notNull().default(true),
    notes: text('notes'),
    imageUrl: text('image_url'),
    isArchived: boolean('is_archived').notNull().default(false),
    defaultRestSeconds: integer('default_rest_seconds'),
    /**
     * Per-exercise display units, carried so a custom exercise arrives on the
     * user's other phone reading in the unit they set it in. Nullable, meaning
     * "follow whatever that device's app-wide setting says".
     *
     * The server stores them and never interprets them: nothing here converts a
     * weight, because nothing here displays one. Weights replicate in kilos
     * exactly as they are stored on device. `sanitize` drops any payload key
     * that is not a column, so without these two the client's choice would be
     * silently discarded on the way through rather than rejected.
     */
    weightUnit: text('weight_unit'),
    distanceUnit: text('distance_unit'),
    ...syncColumns,
  },
  (table) => [index('exercises_sync_idx').on(table.userId, table.seq)],
);

export const routineFolders = pgTable(
  'routine_folders',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    position: doublePrecision('position').notNull().default(0),
    ...syncColumns,
  },
  (table) => [index('routine_folders_sync_idx').on(table.userId, table.seq)],
);

export const routines = pgTable(
  'routines',
  {
    id: text('id').primaryKey(),
    folderId: text('folder_id').references(() => routineFolders.id),
    name: text('name').notNull(),
    notes: text('notes'),
    position: doublePrecision('position').notNull().default(0),
    lastPerformedAt: bigint('last_performed_at', { mode: 'number' }),
    ...syncColumns,
  },
  (table) => [
    index('routines_sync_idx').on(table.userId, table.seq),
    index('routines_folder_idx').on(table.folderId),
  ],
);

export const routineExercises = pgTable(
  'routine_exercises',
  {
    id: text('id').primaryKey(),
    routineId: text('routine_id')
      .notNull()
      .references(() => routines.id),
    exerciseId: text('exercise_id').notNull(),
    position: doublePrecision('position').notNull().default(0),
    notes: text('notes'),
    restSeconds: integer('rest_seconds'),
    supersetGroup: integer('superset_group'),
    ...syncColumns,
  },
  (table) => [
    index('routine_exercises_sync_idx').on(table.userId, table.seq),
    index('routine_exercises_routine_idx').on(table.routineId),
  ],
);

export const routineSets = pgTable(
  'routine_sets',
  {
    id: text('id').primaryKey(),
    routineExerciseId: text('routine_exercise_id')
      .notNull()
      .references(() => routineExercises.id),
    position: doublePrecision('position').notNull().default(0),
    setType: text('set_type').notNull().default('normal'),
    targetReps: integer('target_reps'),
    targetWeightKg: doublePrecision('target_weight_kg'),
    targetDurationSeconds: integer('target_duration_seconds'),
    targetDistanceKm: doublePrecision('target_distance_km'),
    targetRpe: doublePrecision('target_rpe'),
    ...syncColumns,
  },
  (table) => [
    index('routine_sets_sync_idx').on(table.userId, table.seq),
    index('routine_sets_parent_idx').on(table.routineExerciseId),
  ],
);

export const workouts = pgTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    routineId: text('routine_id').references(() => routines.id),
    name: text('name').notNull(),
    notes: text('notes'),
    startedAt: bigint('started_at', { mode: 'number' }).notNull(),
    finishedAt: bigint('finished_at', { mode: 'number' }),
    durationSeconds: integer('duration_seconds'),
    totalVolumeKg: doublePrecision('total_volume_kg').notNull().default(0),
    totalSets: integer('total_sets').notNull().default(0),
    totalReps: integer('total_reps').notNull().default(0),
    prCount: integer('pr_count').notNull().default(0),
    ...syncColumns,
  },
  (table) => [
    index('workouts_sync_idx').on(table.userId, table.seq),
    index('workouts_started_idx').on(table.userId, table.startedAt),
    index('workouts_routine_idx').on(table.routineId),
  ],
);

export const workoutExercises = pgTable(
  'workout_exercises',
  {
    id: text('id').primaryKey(),
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id),
    exerciseId: text('exercise_id').notNull(),
    position: doublePrecision('position').notNull().default(0),
    notes: text('notes'),
    restSeconds: integer('rest_seconds'),
    supersetGroup: integer('superset_group'),
    ...syncColumns,
  },
  (table) => [
    index('workout_exercises_sync_idx').on(table.userId, table.seq),
    index('workout_exercises_workout_idx').on(table.workoutId),
  ],
);

export const workoutSets = pgTable(
  'workout_sets',
  {
    id: text('id').primaryKey(),
    workoutExerciseId: text('workout_exercise_id')
      .notNull()
      .references(() => workoutExercises.id),
    position: doublePrecision('position').notNull().default(0),
    setType: text('set_type').notNull().default('normal'),
    weightKg: doublePrecision('weight_kg'),
    reps: integer('reps'),
    durationSeconds: integer('duration_seconds'),
    distanceKm: doublePrecision('distance_km'),
    rpe: doublePrecision('rpe'),
    isCompleted: boolean('is_completed').notNull().default(false),
    completedAt: bigint('completed_at', { mode: 'number' }),
    ...syncColumns,
  },
  (table) => [
    index('workout_sets_sync_idx').on(table.userId, table.seq),
    index('workout_sets_parent_idx').on(table.workoutExerciseId),
  ],
);

export const personalRecords = pgTable(
  'personal_records',
  {
    id: text('id').primaryKey(),
    exerciseId: text('exercise_id').notNull(),
    kind: text('kind').notNull(),
    value: doublePrecision('value').notNull(),
    reps: integer('reps'),
    setId: text('set_id').references(() => workoutSets.id),
    workoutId: text('workout_id').references(() => workouts.id),
    achievedAt: bigint('achieved_at', { mode: 'number' }).notNull(),
    ...syncColumns,
  },
  (table) => [
    index('personal_records_sync_idx').on(table.userId, table.seq),
    index('personal_records_set_idx').on(table.setId),
    index('personal_records_workout_idx').on(table.workoutId),
  ],
);

export const bodyMeasurements = pgTable(
  'body_measurements',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    value: doublePrecision('value').notNull(),
    measuredAt: bigint('measured_at', { mode: 'number' }).notNull(),
    notes: text('notes'),
    ...syncColumns,
  },
  (table) => [index('body_measurements_sync_idx').on(table.userId, table.seq)],
);

/**
 * Idempotency ledger for pushes.
 *
 * A client that pushes, loses its connection before reading the response, and
 * retries would otherwise re-apply the same mutations. Recording
 * (device, clientSeq) lets the retry be acknowledged without redoing the work.
 */
export const syncReceipts = pgTable(
  'sync_receipts',
  {
    userId: text('user_id').notNull(),
    deviceId: text('device_id').notNull(),
    clientSeq: bigint('client_seq', { mode: 'number' }).notNull(),
    appliedAt: timestamp('applied_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sync_receipts_pk').on(table.userId, table.deviceId, table.clientSeq),
  ],
);

/**
 * How far the tombstone sweep has purged, per user.
 *
 * Per user, even though `seq` is a single global sequence. A global watermark
 * would sit above the cursor of every user whose data was never touched, and
 * the answer to a cursor below the watermark is "throw your database away and
 * start again": one busy account's sweep would order a full resync on all of
 * them.
 *
 * A date horizon cannot stand in for this. The sweep chooses rows by
 * `deletedAt`, which is a client-authored wall clock, while a cursor is a `seq`
 * from this server's sequence. There is no function from one to the other, so
 * the only thing a cursor can be compared against is the highest `seq` actually
 * removed. That is what this records.
 */
export const syncPurgeWatermarks = pgTable('sync_purge_watermarks', {
  userId: text('user_id').primaryKey(),
  /** Highest `seq` a sweep has removed. A cursor at or above it has missed nothing. */
  purgedThroughSeq: bigint('purged_through_seq', { mode: 'number' }).notNull().default(0),
  sweptAt: timestamp('swept_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

/**
 * One row per user who has asked for the Telegram bot.
 *
 * Written when the app asks to connect, with a one-time `linkCode`; completed
 * when that code comes back through the bot's `/start`, which is the moment
 * `chatId` is known. Not a synced table: nothing here is training data, and it
 * belongs to the server's half of the feature.
 *
 * The bot runs on the server's clock, which is UTC, so the user's zone travels
 * with their settings and every "today" and "Monday" is worked out in it.
 * `lastDailyOn` and `lastWeeklyOn` are local dates, and are what stop a
 * restart, or a minute that is checked twice, from sending anything twice.
 */
export const telegramLinks = pgTable(
  'telegram_links',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Telegram chat ids exceed 32 bits, and are only ever compared. */
    chatId: text('chat_id'),
    username: text('username'),
    linkCode: text('link_code'),
    linkCodeExpiresAt: timestamp('link_code_expires_at'),
    timeZone: text('time_zone').notNull().default('UTC'),
    unit: text('unit').notNull().default('kg'),
    /** "HH:MM", local. The daily line goes out at this time; on Mondays, the report too. */
    dailyTime: text('daily_time').notNull().default('07:30'),
    dailyEnabled: boolean('daily_enabled').notNull().default(true),
    weeklyEnabled: boolean('weekly_enabled').notNull().default(true),
    lastDailyOn: text('last_daily_on'),
    lastWeeklyOn: text('last_weekly_on'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('telegram_links_chat_idx').on(table.chatId),
    uniqueIndex('telegram_links_code_idx').on(table.linkCode),
  ],
);

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------
//
// Server-only, like Telegram: the food tracker talks to these through
// `/api/nutrition/*` rather than through sync, so none of them carries
// `syncColumns`, and deletes are real deletes. Nutrient figures are a jsonb map
// keyed by nutrient (`@lift/shared` `NutrientValues`), which is what lets a
// user's custom nutrients ride along without a column each. Times are epoch ms,
// as everywhere else in this schema.

/** A user's saved foods: their own, and ones imported from OpenFoodFacts or USDA. */
export const foods = pgTable(
  'foods',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    brand: text('brand'),
    barcode: text('barcode'),
    source: text('source').notNull(),
    sourceId: text('source_id'),
    /** `Serving[]`, each with its own figures. The first is the default. */
    servings: jsonb('servings').notNull(),
    isFavorite: boolean('is_favorite').notNull().default(false),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('foods_user_idx').on(table.userId, table.updatedAt),
    // Importing the same product twice returns the saved row. Custom foods
    // have no source id, and Postgres treats NULLs as distinct, so they never
    // collide.
    uniqueIndex('foods_source_idx').on(table.userId, table.source, table.sourceId),
    index('foods_barcode_idx').on(table.userId, table.barcode),
  ],
);

/**
 * One line of the diary. Carries its own copy of the food's name and figures,
 * so editing or deleting the food never rewrites what was eaten.
 */
export const foodEntries = pgTable(
  'food_entries',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Local calendar date, `YYYY-MM-DD`, in the zone the user logged it in. */
    date: text('date').notNull(),
    meal: text('meal').notNull(),
    /** When it was eaten, `HH:mm` local time. Null when not given. */
    time: text('time'),
    position: integer('position').notNull().default(0),
    quantity: doublePrecision('quantity').notNull(),
    foodId: text('food_id').references(() => foods.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    brand: text('brand'),
    servingLabel: text('serving_label').notNull(),
    servingGrams: doublePrecision('serving_grams'),
    /** Per one serving. The logged amount is these times `quantity`. */
    nutrients: jsonb('nutrients').notNull(),
    source: text('source').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('food_entries_day_idx').on(table.userId, table.date),
    index('food_entries_recent_idx').on(table.userId, table.createdAt),
    index('food_entries_food_idx').on(table.foodId),
  ],
);

/** A named group of foods logged together in one tap: "My usual breakfast". */
export const mealTemplates = pgTable(
  'meal_templates',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    meal: text('meal'),
    /** `EntryItem[]`, snapshots like an entry's. */
    items: jsonb('items').notNull(),
    useCount: integer('use_count').notNull().default(0),
    lastUsedAt: bigint('last_used_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('meal_templates_user_idx').on(table.userId)],
);

/** Daily targets. One row per user, absent until they set any. */
export const nutritionGoals = pgTable('nutrition_goals', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  targets: jsonb('targets').notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/** Nutrients the user tracks beyond the built-in list. Values are keyed by `id`. */
export const customNutrients = pgTable(
  'custom_nutrients',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('custom_nutrients_user_idx').on(table.userId)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

/** Wire-name → table, in parent-before-child order for safe application. */
export const SYNC_TABLES = {
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

export type SyncTableName = keyof typeof SYNC_TABLES;

interface ParentRef {
  /** The referencing column on the child table. */
  readonly column: AnyPgColumn;
  /** Wire name of the table it points at. */
  readonly parent: SyncTableName;
}

/**
 * The foreign keys declared above, as data.
 *
 * The sweep needs to walk this graph in both directions: children before
 * parents when deleting, and parent to children when asking whether a tombstone
 * is still referenced. Reading it back off the Drizzle table objects at runtime
 * is possible but obscure, and a hand-written list that drifts from the columns
 * would fail loudly the first time a delete hit a constraint this map did not
 * know about. Keeping it next to the declarations is what stops it drifting.
 *
 * `exercise_id` is absent for the reason given at the top of the replicated
 * tables: the built-in catalog is not server-side data.
 */
export const SYNC_PARENT_REFS: Partial<Record<SyncTableName, readonly ParentRef[]>> = {
  routines: [{ column: routines.folderId, parent: 'routine_folders' }],
  routine_exercises: [{ column: routineExercises.routineId, parent: 'routines' }],
  routine_sets: [{ column: routineSets.routineExerciseId, parent: 'routine_exercises' }],
  workouts: [{ column: workouts.routineId, parent: 'routines' }],
  workout_exercises: [{ column: workoutExercises.workoutId, parent: 'workouts' }],
  workout_sets: [{ column: workoutSets.workoutExerciseId, parent: 'workout_exercises' }],
  personal_records: [
    { column: personalRecords.setId, parent: 'workout_sets' },
    { column: personalRecords.workoutId, parent: 'workouts' },
  ],
};

export { seqDefault };
