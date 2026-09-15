/**
 * Backup, export and import.
 *
 * The JSON format is a straight dump of every user-owned table. It is the
 * escape hatch: as long as this exists, nobody's training history is trapped in
 * the app.
 */

import { SYNCABLE_TABLES, type SyncableTable } from '@lift/shared';
import { eq, isNull } from 'drizzle-orm';
import { File, Paths } from 'expo-file-system';

import { db } from '@/db/client';
import { trackUpsert } from '@/db/mutations';
import {
  bodyMeasurements,
  coachMessages,
  coachThreads,
  exercises,
  personalRecords,
  routineExercises,
  routineFolders,
  routineSets,
  routines,
  SYNC_TABLE_MAP,
  workoutExercises,
  workoutSets,
  workouts,
} from '@/db/schema';
import { authClient } from '@/features/sync/auth-client';

/** Bumped whenever the shape changes incompatibly, so imports can refuse. */
export const BACKUP_FORMAT_VERSION = 1;

const BACKUP_FORMAT = 'lift-backup';

/**
 * Format tags an import will accept.
 *
 * `ironlog-backup` is what the app stamped before it was renamed. The file shape
 * never changed, so refusing those would strand real backups over a cosmetic
 * difference. They stay readable indefinitely.
 */
const ACCEPTED_FORMATS = [BACKUP_FORMAT, 'ironlog-backup'];

export interface BackupFile {
  format: (typeof ACCEPTED_FORMATS)[number];
  version: number;
  exportedAt: string;
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
}

/**
 * Serialises every user table.
 *
 * Built-in exercises are excluded: they ship with the app and re-seed on
 * launch, so including 230 static rows would bloat every backup for nothing.
 * Custom exercises are kept, since routines and history reference them.
 */
export async function buildBackup(): Promise<BackupFile> {
  const [
    customExercises,
    folders,
    routineRows,
    routineExerciseRows,
    routineSetRows,
    workoutRows,
    workoutExerciseRows,
    setRows,
    prRows,
    measurementRows,
    threadRows,
    threadMessageRows,
  ] = await Promise.all([
    db.select().from(exercises),
    db.select().from(routineFolders),
    db.select().from(routines),
    db.select().from(routineExercises),
    db.select().from(routineSets),
    db.select().from(workouts),
    db.select().from(workoutExercises),
    db.select().from(workoutSets),
    db.select().from(personalRecords),
    db.select().from(bodyMeasurements),
    db.select().from(coachThreads),
    db.select().from(coachMessages),
  ]);

  const data: Record<string, unknown[]> = {
    exercises: customExercises.filter((row) => row.isCustom),
    routine_folders: folders,
    routines: routineRows,
    routine_exercises: routineExerciseRows,
    routine_sets: routineSetRows,
    workouts: workoutRows,
    workout_exercises: workoutExerciseRows,
    workout_sets: setRows,
    personal_records: prRows,
    body_measurements: measurementRows,
    // Named here rather than reached through SYNCABLE_TABLES, because they are
    // deliberately not in it. A local-only table is still the user's, and this
    // file is the only way it can leave the device. Missing them here is a
    // silent hole in the escape hatch rather than a visible failure.
    coach_threads: threadRows,
    coach_messages: threadMessageRows,
  };

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])),
    data,
  };
}

/** Writes a backup to the cache directory and returns the file for sharing. */
export async function writeBackupFile(): Promise<File> {
  const backup = await buildBackup();

  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `lift-backup-${stamp}.json`);

  // Overwrite so exporting twice in one day doesn't fail.
  file.create({ overwrite: true });
  file.write(JSON.stringify(backup, null, 2));

  return file;
}

/**
 * Flattens completed workouts into a CSV, one row per set.
 *
 * Long format rather than wide: it's what spreadsheets and R/pandas expect, and
 * it doesn't break when someone logs 12 sets of an exercise.
 */
export async function writeCsvFile(): Promise<File> {
  const rows = await db
    .select({
      workoutName: workouts.name,
      startedAt: workouts.startedAt,
      exerciseName: exercises.name,
      setType: workoutSets.setType,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      durationSeconds: workoutSets.durationSeconds,
      distanceKm: workoutSets.distanceKm,
      rpe: workoutSets.rpe,
      position: workoutSets.position,
    })
    .from(workoutSets)
    .innerJoin(workoutExercises, eq(workoutSets.workoutExerciseId, workoutExercises.id))
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .innerJoin(exercises, eq(workoutExercises.exerciseId, exercises.id))
    .where(isNull(workoutSets.deletedAt))
    .orderBy(workouts.startedAt, workoutExercises.position, workoutSets.position);

  const header = [
    'Date',
    'Workout',
    'Exercise',
    'Set Type',
    'Weight (kg)',
    'Reps',
    'Duration (s)',
    'Distance (km)',
    'RPE',
  ];

  const lines = [header.join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.startedAt.toISOString(),
        csvEscape(row.workoutName),
        csvEscape(row.exerciseName),
        row.setType,
        row.weightKg ?? '',
        row.reps ?? '',
        row.durationSeconds ?? '',
        row.distanceKm ?? '',
        row.rpe ?? '',
      ].join(','),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `lift-sets-${stamp}.csv`);
  file.create({ overwrite: true });
  file.write(lines.join('\n'));

  return file;
}

/** Quotes a CSV field when it contains a comma, quote or newline. */
function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export interface ImportResult {
  imported: Record<string, number>;
  skipped: number;
  /**
   * Restored rows the sync engine will push. Zero while signed out. The oplog
   * entries are still written, but there is no account to promise them to.
   */
  queued: number;
}

/**
 * Rows are inserted 50 at a time, matching the seeder's margin under SQLite's
 * cap on bound parameters per statement. A restore of a long training history
 * is tens of thousands of rows, and one statement each makes it a visible wait.
 */
const CHUNK_SIZE = 50;

/**
 * Restores a backup.
 *
 * Rows are inserted with `onConflictDoNothing`, making the import additive and
 * idempotent: re-importing the same file changes nothing, and importing onto a
 * device that already has data merges rather than destroys. Because IDs are
 * UUIDv7, collisions between genuinely different rows are not a concern.
 *
 * Every row that is genuinely written is logged to the sync oplog, exactly as
 * if it had been typed in. Skipping that step is what made restore a dead end:
 * a workout recovered from a backup lived on the device and never reached the
 * account, and nothing anywhere said so.
 */
/**
 * Reads and vets a backup without writing anything.
 *
 * Split out so the import screen can show what a file holds before the user
 * commits to it, and so the two paths can never disagree about whether a file
 * is acceptable. The confirmation and the restore run the same checks.
 */
export function inspectBackup(json: string): BackupFile {
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(json) as BackupFile;
  } catch {
    // The parser's own message is a character offset, which tells the user
    // nothing about the file they picked.
    throw new Error('That file is not readable. Nothing on this device changed.');
  }

  if (!parsed || typeof parsed !== 'object' || !ACCEPTED_FORMATS.includes(parsed.format)) {
    throw new Error('Not a Lift backup file.');
  }
  if (parsed.version > BACKUP_FORMAT_VERSION) {
    throw new Error(
      `This backup was made by a newer version of Lift (format ${parsed.version}). Update the app first.`,
    );
  }

  return parsed;
}

export async function restoreBackup(json: string): Promise<ImportResult> {
  const parsed = inspectBackup(json);

  // The same signal the sync client authenticates with, so "queued" means the
  // rows have somewhere to go rather than merely somewhere to sit.
  const signedIn = authClient.getCookie().length > 0;

  const imported: Record<string, number> = {};
  let skipped = 0;
  let queued = 0;

  // SYNCABLE_TABLES is ordered parents-before-children, so foreign keys always
  // resolve and an oplog entry never references a row the server hasn't seen.
  for (const name of SYNCABLE_TABLES) {
    const rows = parsed.data[name];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const table = SYNC_TABLE_MAP[name];
    let count = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk: RestoreRow[] = [];

      for (const row of rows.slice(i, i + CHUNK_SIZE)) {
        const restorable = toRestoreRow(row);
        if (restorable) chunk.push(restorable);
        else skipped += 1;
      }

      if (chunk.length === 0) continue;

      const { insertedIds, failed } = await insertRows(table, chunk);
      skipped += failed;
      count += insertedIds.length;

      const byId = new Map(chunk.map((row) => [row.id, row]));

      for (const id of insertedIds) {
        const row = byId.get(id);
        if (!row || !isSyncable(name, row)) continue;

        await trackUpsert(name, toWireRow(row));
        queued += 1;
      }
    }

    imported[name] = count;
  }

  skipped += await restoreCoachThreads(parsed, imported);

  return { imported, skipped, queued: signedIn ? queued : 0 };
}

/**
 * The local-only half of a restore.
 *
 * Separate from the loop above and not merely another entry in it, for three
 * reasons that are all the same reason: these tables do not replicate.
 * `SYNC_TABLE_MAP` does not contain them, `trackUpsert` will not accept them
 * (its parameter is a `SyncableTable`, so the compiler stops this before a test
 * would), and nothing here is queued, because there is no endpoint to queue it
 * for.
 *
 * Threads before messages: the foreign key is enforced (`PRAGMA foreign_keys =
 * ON` in db/client.ts), so a message whose thread is missing from the file is
 * rejected by SQLite and counted as skipped rather than quietly orphaning a
 * conversation.
 *
 * A file written before these tables existed simply has neither key, which is
 * why this reads them independently and returns early on each. That is also why
 * `BACKUP_FORMAT_VERSION` is not bumped for them: the change is additive, and an
 * older build refusing every new backup outright would be a worse outcome than
 * one dropping two tables it has nowhere to put.
 */
async function restoreCoachThreads(
  parsed: BackupFile,
  imported: Record<string, number>,
): Promise<number> {
  const tables = [
    { name: 'coach_threads', table: coachThreads },
    { name: 'coach_messages', table: coachMessages },
  ] as const;

  let skipped = 0;

  for (const { name, table } of tables) {
    const rows = parsed.data[name];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    let count = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk: { id: string; [column: string]: unknown }[] = [];

      for (const row of rows.slice(i, i + CHUNK_SIZE)) {
        // `toRestoreRow` cannot be reused: it requires `updatedAt`, and
        // `coach_messages` has only a `createdAt`. An id is the whole
        // requirement here, since nothing downstream resolves a conflict.
        if (typeof row === 'object' && row !== null && typeof (row as { id?: unknown }).id === 'string') {
          chunk.push(row as { id: string });
        } else {
          skipped += 1;
        }
      }

      if (chunk.length === 0) continue;

      const result = await insertCoachRows(table, chunk);
      skipped += result.failed;
      count += result.inserted;
    }

    imported[name] = count;
  }

  return skipped;
}

/**
 * The same chunk-then-retry shape `insertRows` uses, without the oplog half.
 *
 * One malformed row, or one message pointing at a thread the file did not
 * carry, costs itself rather than the forty-nine beside it.
 */
async function insertCoachRows(
  table: typeof coachThreads | typeof coachMessages,
  rows: { id: string }[],
): Promise<{ inserted: number; failed: number }> {
  try {
    const returned = await db
      .insert(table)
      .values(rows as never)
      .onConflictDoNothing()
      .returning({ id: table.id });

    return { inserted: returned.length, failed: 0 };
  } catch {
    if (rows.length === 1) return { inserted: 0, failed: 1 };

    let inserted = 0;
    let failed = 0;

    for (const row of rows) {
      const result = await insertCoachRows(table, [row]);
      inserted += result.inserted;
      failed += result.failed;
    }

    return { inserted, failed };
  }
}

type RestoreTable = (typeof SYNC_TABLE_MAP)[SyncableTable];

interface RestoreRow {
  id: string;
  updatedAt: number;
  [column: string]: unknown;
}

/**
 * Narrows a value from the file to something both insertable and trackable.
 *
 * `id` and `updatedAt` are the two columns the oplog cannot work without: the
 * server addresses the row by one and resolves conflicts on the other. A row
 * missing either is not repairable by guessing, so it counts as skipped.
 */
function toRestoreRow(value: unknown): RestoreRow | null {
  if (typeof value !== 'object' || value === null) return null;

  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id.length === 0) return null;
  if (typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)) return null;

  return { ...row, id: row.id, updatedAt: row.updatedAt };
}

/**
 * Inserts a chunk and reports which rows were genuinely written.
 *
 * `.returning` is the point of the exercise: with `onConflictDoNothing` a row
 * the device already has produces no id, so it is neither counted as an import
 * nor logged for sync. Counting it would have claimed an import that didn't
 * happen and queued a mutation for a row this device never wrote.
 *
 * A chunk that throws is retried row by row, so one malformed row costs itself
 * rather than the forty-nine beside it.
 */
async function insertRows(
  table: RestoreTable,
  rows: RestoreRow[],
): Promise<{ insertedIds: string[]; failed: number }> {
  try {
    const returned = await db
      .insert(table)
      .values(rows.map(toLocalRow) as never)
      .onConflictDoNothing()
      .returning({ id: table.id });

    return { insertedIds: returned.map((row) => row.id), failed: 0 };
  } catch {
    if (rows.length === 1) return { insertedIds: [], failed: 1 };

    const insertedIds: string[] = [];
    let failed = 0;

    for (const row of rows) {
      const result = await insertRows(table, [row]);
      insertedIds.push(...result.insertedIds);
      failed += result.failed;
    }

    return { insertedIds, failed };
  }
}

/**
 * Built-in exercises are identical on every device and are excluded from
 * backups, so a built-in row here came from a hand-edited file. Inserting it is
 * harmless; pushing 6,800 of them to the server is not.
 */
function isSyncable(name: SyncableTable, row: RestoreRow): boolean {
  return name !== 'exercises' || row.isCustom === true;
}

/**
 * JSON has no Date type, so timestamp columns come back as ISO strings. The two
 * consumers want them differently: Drizzle's `timestamp_ms` mode expects real
 * Date objects on insert, while the sync wire contract carries epoch-ms
 * integers (`packages/shared/src/sync.ts`). Sending a Date there would arrive
 * as a string and fail the server's schema.
 */
const DATE_COLUMNS = new Set([
  'startedAt',
  'finishedAt',
  'completedAt',
  'achievedAt',
  'measuredAt',
  'lastPerformedAt',
]);

function toLocalRow(row: RestoreRow): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row };

  for (const key of DATE_COLUMNS) {
    const value = result[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      result[key] = Number.isNaN(date.getTime()) ? null : date;
    }
  }

  return result;
}

function toWireRow(row: RestoreRow): RestoreRow {
  const result: RestoreRow = { ...row };

  for (const key of DATE_COLUMNS) {
    const value = result[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const ms = new Date(value).getTime();
      result[key] = Number.isNaN(ms) ? null : ms;
    }
  }

  return result;
}
