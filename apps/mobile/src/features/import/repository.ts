/**
 * Writing another app's training history into this one.
 *
 * Three things make this different from logging a workout, and each of them is
 * a decision the code has to make rather than inherit:
 *
 * - **It is additive and re-runnable.** Someone will import the same file
 *   twice, or import last month and then import everything. A session already
 *   in the log is left exactly as it is, so the second run reports "nothing
 *   new" rather than doubling three years of volume.
 * - **It happens in the past.** Records are awarded oldest-first against the
 *   bests as they stood *at that point*, and dated to the day the lift actually
 *   happened. Awarding them in file order, or stamping them today, produces a
 *   records screen that says the user hit a lifetime best this afternoon.
 * - **It cannot be one transaction.** This driver commits before the first
 *   `await` inside a callback resolves, so a 20,000-row import has no rollback.
 *   Each session is therefore written on its own and tombstoned again if it
 *   fails partway, leaving complete workouts behind it and untouched ones in
 *   front, which the summary reports rather than hides.
 *
 * One consequence worth knowing about: records are compared against the bests
 * already on the device, so importing history *older* than what is here awards
 * few records, because today's ceiling is higher than the day's was. That is the
 * conservative direction. The alternative: recomputing every record from
 * scratch. Would rewrite records the user earned in this app, dated to
 * sessions they imported from another one.
 */

import {
  detectPrs,
  summarizeSets,
  uuidv7,
  type AnalyticsContext,
  type PreviousBests,
  type PrKind,
  type SetLike,
  type TrackingType,
} from '@lift/shared';
import { type ImportedWorkout } from '@lift/shared/import';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { touch, trackDelete, trackUpsertMany } from '@/db/mutations';
import {
  exercises,
  personalRecords,
  routineExercises,
  workoutExercises,
  workoutSets,
  workouts,
} from '@/db/schema';
import { deleteExercise } from '@/features/exercises/repository';
import { authClient } from '@/features/sync/auth-client';
import { defaultWorkoutName } from '@/features/workouts/repository';
import { useSettings } from '@/store/settings';

import { commitExercises, planExercises } from './exercise-resolver';

export interface ImportSummary {
  workouts: number;
  sets: number;
  /** Names that had no library entry and now exist as custom exercises. */
  exercisesCreated: string[];
  /** Sessions already in the log at that time, left untouched. */
  duplicates: number;
  personalRecords: number;
  /**
   * Rows queued for the account. Zero while signed out. The oplog entries are
   * written either way, but there is nothing to promise them to.
   */
  queued: number;
  /** Sessions that failed to write. Everything before them still landed. */
  failed: number;
}

export interface ImportProgress {
  done: number;
  total: number;
}

/**
 * Two sessions cannot start within a minute of each other, so anything that
 * close is the same session arriving twice.
 *
 * A minute rather than an exact match because the same training day can reach
 * this function from two files at different precisions: Hevy exports
 * minute-resolution wall clock, an API sync carries seconds, and re-importing
 * should recognise them as one workout.
 */
const DUPLICATE_WINDOW_MS = 60_000;

/** SQLite's bound-parameter ceiling, with the margin the seeder uses. */
const CHUNK_SIZE = 50;

/**
 * Imports the sessions handed to it, and only those.
 *
 * The exercise plan is built here from the same list rather than taken from the
 * caller, so that narrowing the date range narrows the library too: a plan made
 * over the whole file would add custom exercises for three years of training
 * when the user asked to import last week.
 */
export async function importWorkouts(
  imported: readonly ImportedWorkout[],
  options: {
    onProgress?: (progress: ImportProgress) => void;
    picks?: ReadonlyMap<string, string>;
  } = {},
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    workouts: 0,
    sets: 0,
    exercisesCreated: [],
    duplicates: 0,
    personalRecords: 0,
    queued: 0,
    failed: 0,
  };

  if (imported.length === 0) return summary;

  // Oldest first. Records are a running comparison against everything before
  // them, so the order rows are written in *is* the order they are earned in.
  const ordered = [...imported].sort((a, b) => a.startedAt - b.startedAt);

  const plan = await planExercises(ordered, { picks: options.picks });
  await commitExercises(plan);
  summary.exercisesCreated = plan.created;

  const existingStarts = await loadExistingStarts();
  const bests = await loadPersonalBests();

  const { bodyweightKg, oneRepMaxFormula } = useSettings.getState();
  const signedIn = authClient.getCookie().length > 0;

  // Exercises created above are already in the oplog and count toward what the
  // sync engine has to push.
  let queued = plan.created.length;

  for (const [index, workout] of ordered.entries()) {
    options.onProgress?.({ done: index, total: ordered.length });

    if (hasNearby(existingStarts, workout.startedAt)) {
      summary.duplicates += 1;
      continue;
    }

    const staged = stageWorkout(workout, {
      trackingTypeById: plan.trackingTypeById,
      idByName: plan.idByName,
      bodyweightKg: bodyweightKg ?? undefined,
      formula: oneRepMaxFormula,
      bests,
    });

    // Nothing resolved: every exercise in the session was dropped. Recording
    // the workout would put an empty session in the history.
    if (staged.sets.length === 0) continue;

    try {
      await writeWorkout(staged);
    } catch {
      // Sessions already written are untouched, and the ones after this still
      // get their turn. Aborting an import that is nine-tenths done helps
      // nobody. This one is rolled back and counted, so a second run of the
      // same file picks it up as missing rather than as a duplicate.
      await discardPartial(staged.workout.id);
      summary.failed += 1;
      continue;
    }

    // Only applied once the write succeeded, so a failed session does not
    // poison the record ceiling for the ones after it.
    for (const pr of staged.records) applyBest(bests, pr.exerciseId, pr.kind, pr.value);

    insertSorted(existingStarts, workout.startedAt);

    summary.workouts += 1;
    summary.sets += staged.sets.length;
    summary.personalRecords += staged.records.length;
    queued += 1 + staged.links.length + staged.sets.length + staged.records.length;
  }

  options.onProgress?.({ done: ordered.length, total: ordered.length });

  summary.queued = signedIn ? queued : 0;
  return summary;
}

/**
 * Moves this import's history from custom exercises onto catalog rows the
 * user picked afterwards.
 *
 * The log is written before the routine picker, so a rematch otherwise splits:
 * sessions stay on the custom, routines take the catalog. Only workouts whose
 * start sits in this file are rewritten. Sessions the user logged themselves
 * keep their exercise ids. Customs that nothing else references are removed.
 */
export async function relinkImportedHistory(
  imported: readonly ImportedWorkout[],
  picks: ReadonlyMap<string, string>,
): Promise<void> {
  if (imported.length === 0 || picks.size === 0) return;

  const sessions = await db
    .select({ id: workouts.id, startedAt: workouts.startedAt })
    .from(workouts)
    .where(isNull(workouts.deletedAt));

  const importedStarts = imported.map((workout) => workout.startedAt).sort((a, b) => a - b);
  const workoutIds = sessions
    .filter((session) => hasNearby(importedStarts, session.startedAt.getTime()))
    .map((session) => session.id);

  if (workoutIds.length === 0) return;

  const customs = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    .where(and(eq(exercises.isCustom, true), isNull(exercises.deletedAt)));

  const customByName = new Map(
    customs.map((row) => [row.name.trim().toLowerCase(), row.id] as const),
  );

  for (const [name, catalogId] of picks) {
    const customId = customByName.get(name);
    if (!customId || customId === catalogId) continue;

    await reassignExercise(workoutIds, customId, catalogId);

    const stillUsed = await exerciseStillUsed(customId);
    if (!stillUsed) await deleteExercise(customId);
  }
}

async function reassignExercise(
  workoutIds: readonly string[],
  fromId: string,
  toId: string,
): Promise<void> {
  const stamp = touch();

  const links = await db
    .select()
    .from(workoutExercises)
    .where(
      and(
        inArray(workoutExercises.workoutId, [...workoutIds]),
        eq(workoutExercises.exerciseId, fromId),
        isNull(workoutExercises.deletedAt),
      ),
    );

  if (links.length > 0) {
    const next = links.map((row) => ({ ...row, exerciseId: toId, ...stamp }));
    for (const row of next) {
      await db
        .update(workoutExercises)
        .set({ exerciseId: toId, ...stamp })
        .where(eq(workoutExercises.id, row.id));
    }
    await trackUpsertMany('workout_exercises', next);
  }

  const records = await db
    .select()
    .from(personalRecords)
    .where(
      and(
        inArray(personalRecords.workoutId, [...workoutIds]),
        eq(personalRecords.exerciseId, fromId),
        isNull(personalRecords.deletedAt),
      ),
    );

  if (records.length > 0) {
    const next = records.map((row) => ({ ...row, exerciseId: toId, ...stamp }));
    for (const row of next) {
      await db
        .update(personalRecords)
        .set({ exerciseId: toId, ...stamp })
        .where(eq(personalRecords.id, row.id));
    }
    await trackUpsertMany(
      'personal_records',
      next.map((row) => ({ ...row, achievedAt: row.achievedAt.getTime() })),
    );
  }
}

async function exerciseStillUsed(exerciseId: string): Promise<boolean> {
  const [link] = await db
    .select({ id: workoutExercises.id })
    .from(workoutExercises)
    .where(and(eq(workoutExercises.exerciseId, exerciseId), isNull(workoutExercises.deletedAt)))
    .limit(1);
  if (link) return true;

  const [routine] = await db
    .select({ id: routineExercises.id })
    .from(routineExercises)
    .where(and(eq(routineExercises.exerciseId, exerciseId), isNull(routineExercises.deletedAt)))
    .limit(1);

  return routine !== undefined;
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

type WorkoutRow = typeof workouts.$inferInsert & { id: string; updatedAt: number };
type LinkRow = typeof workoutExercises.$inferInsert & { id: string; updatedAt: number };
type SetRow = typeof workoutSets.$inferInsert & { id: string; updatedAt: number };
type RecordRow = typeof personalRecords.$inferInsert & {
  id: string;
  updatedAt: number;
  exerciseId: string;
  kind: PrKind;
  value: number;
};

interface StagedWorkout {
  workout: WorkoutRow;
  links: LinkRow[];
  sets: SetRow[];
  records: RecordRow[];
}

interface StageContext {
  idByName: Map<string, string>;
  trackingTypeById: Map<string, TrackingType>;
  bodyweightKg: number | undefined;
  formula: AnalyticsContext['formula'];
  bests: Map<string, PreviousBests>;
}

/**
 * Builds every row a session needs, in memory, before anything is written.
 *
 * Totals and records are derived here rather than by re-reading what was just
 * inserted, which is what lets the workout row be written once with its
 * finished figures already on it. `finishWorkout` cannot do that. It is
 * closing a session whose rows already exist, but an import owns the ids it is
 * about to use, so there is nothing to read back.
 */
function stageWorkout(imported: ImportedWorkout, context: StageContext): StagedWorkout {
  const now = Date.now();
  // Seeded from the session's own date so these ids sort alongside the history
  // they belong to rather than all landing at the moment of the import.
  const workoutId = uuidv7(imported.startedAt);

  const links: LinkRow[] = [];
  const sets: SetRow[] = [];
  const records: RecordRow[] = [];

  let totalVolumeKg = 0;
  let totalSets = 0;
  let totalReps = 0;

  let position = 1;

  for (const exercise of imported.exercises) {
    const exerciseId = context.idByName.get(exercise.name.toLowerCase());
    if (!exerciseId || exercise.sets.length === 0) continue;

    const linkId = uuidv7(imported.startedAt);

    links.push({
      id: linkId,
      workoutId,
      exerciseId,
      position,
      notes: exercise.notes,
      restSeconds: null,
      supersetGroup: exercise.supersetGroup,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncState: 'pending',
    });
    position += 1;

    const exerciseSets: SetRow[] = exercise.sets.map((set, setIndex) => ({
      id: uuidv7(imported.startedAt),
      workoutExerciseId: linkId,
      position: setIndex + 1,
      setType: set.setType,
      weightKg: set.weightKg,
      reps: set.reps,
      durationSeconds: set.durationSeconds,
      distanceKm: set.distanceKm,
      rpe: set.rpe,
      // Everything in an export was performed; the parser has already dropped
      // rows that recorded nothing. `completedAt` is the session's end because
      // that is the closest instant the file actually knows.
      isCompleted: true,
      completedAt: new Date(imported.finishedAt),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncState: 'pending',
    }));

    sets.push(...exerciseSets);

    const analytics: AnalyticsContext = {
      trackingType: context.trackingTypeById.get(exerciseId) ?? 'weight_reps',
      bodyweightKg: context.bodyweightKg,
      formula: context.formula,
    };

    const summary = summarizeSets(exerciseSets as SetLike[], analytics);
    totalVolumeKg += summary.volumeKg;
    totalSets += summary.workingSets;
    totalReps += summary.totalReps;

    const previous = context.bests.get(exerciseId) ?? {};
    for (const pr of detectPrs(exerciseSets as SetLike[], analytics, previous)) {
      const source = pr.setIndex === null ? null : exerciseSets[pr.setIndex];

      records.push({
        id: uuidv7(imported.startedAt),
        exerciseId,
        kind: pr.kind,
        value: pr.value,
        reps: source?.reps ?? null,
        setId: source?.id ?? null,
        workoutId,
        // Dated to the session, not to the import. A record earned in 2024
        // belongs on the 2024 row of the progress chart.
        achievedAt: new Date(imported.startedAt),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncState: 'pending',
      });
    }
  }

  return {
    workout: {
      id: workoutId,
      routineId: null,
      name: imported.name.trim() || defaultWorkoutName(new Date(imported.startedAt)),
      notes: imported.notes,
      startedAt: new Date(imported.startedAt),
      finishedAt: new Date(imported.finishedAt),
      durationSeconds: imported.durationSeconds,
      totalVolumeKg,
      totalSets,
      totalReps,
      prCount: records.length,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncState: 'pending',
    },
    links,
    sets,
    records,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * One session, parents before children.
 *
 * The order is the failure plan as much as a foreign-key requirement: stopped
 * anywhere in the middle, what exists is a workout with some of its exercises,
 * which every screen renders without complaint. The reverse order would strand
 * sets pointing at a session that does not exist.
 */
async function writeWorkout(staged: StagedWorkout): Promise<void> {
  await db.insert(workouts).values(staged.workout);
  await trackUpsertMany('workouts', [serializeWorkout(staged.workout)]);

  await insertChunked(workoutExercises, staged.links);
  await trackUpsertMany('workout_exercises', staged.links);

  await insertChunked(workoutSets, staged.sets);
  await trackUpsertMany('workout_sets', staged.sets.map(serializeSet));

  if (staged.records.length > 0) {
    await insertChunked(personalRecords, staged.records);
    await trackUpsertMany('personal_records', staged.records.map(serializeRecord));
  }
}

/**
 * Undoes a session that failed partway through being written.
 *
 * Foreign keys are on, so the parent has to exist before its children and
 * there is no ordering that makes the last write the commit point. What is left
 * behind is a workout carrying finished totals it does not have the sets to
 * back. A session that reads as a full training day and renders as an empty
 * one. Tombstoning it takes it out of every query (they all filter `deletedAt`)
 * and out of the duplicate check, so importing the file again gets it right.
 *
 * Best-effort by design. The likeliest reason the write failed is a full disk,
 * which is also the likeliest reason this fails, and a throw here would replace
 * a reported failure with an aborted import.
 */
async function discardPartial(workoutId: string): Promise<void> {
  try {
    const deletedAt = Date.now();
    await db
      .update(workouts)
      .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
      .where(eq(workouts.id, workoutId));
    await trackDelete('workouts', workoutId, deletedAt);
  } catch {
    // Deliberately swallowed; see above.
  }
}

async function insertChunked<T extends { id: string }>(
  table: typeof workoutExercises | typeof workoutSets | typeof personalRecords,
  rows: T[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await db.insert(table).values(rows.slice(i, i + CHUNK_SIZE) as never);
  }
}

// Drizzle hands back `Date` for timestamp_ms columns; the sync wire contract
// carries epoch-ms integers. Same conversion the workout repository makes.

function serializeWorkout(row: WorkoutRow) {
  return {
    ...row,
    startedAt: row.startedAt.getTime(),
    finishedAt: row.finishedAt?.getTime() ?? null,
  };
}

function serializeSet(row: SetRow) {
  return { ...row, completedAt: row.completedAt?.getTime() ?? null };
}

function serializeRecord(row: RecordRow) {
  return { ...row, achievedAt: row.achievedAt.getTime() };
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

async function loadExistingStarts(): Promise<number[]> {
  const rows = await db
    .select({ startedAt: workouts.startedAt })
    .from(workouts)
    .where(isNull(workouts.deletedAt));

  return rows.map((row) => row.startedAt.getTime()).sort((a, b) => a - b);
}

/**
 * Whether a session already sits within a minute of this one.
 *
 * Binary search over a sorted array rather than a `SELECT` per workout: a
 * three-year import is a thousand sessions, and a query each would be a
 * thousand round trips to answer a question one read already covers. Newly
 * written sessions are inserted back into the array, so a file containing the
 * same workout twice is caught the same way an already-imported one is.
 */
function hasNearby(sorted: number[], value: number): boolean {
  const at = lowerBound(sorted, value - DUPLICATE_WINDOW_MS);
  return at < sorted.length && sorted[at]! <= value + DUPLICATE_WINDOW_MS;
}

function insertSorted(sorted: number[], value: number): void {
  sorted.splice(lowerBound(sorted, value), 0, value);
}

/** Index of the first element not less than `value`. */
function lowerBound(sorted: number[], value: number): number {
  let low = 0;
  let high = sorted.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid]! < value) low = mid + 1;
    else high = mid;
  }

  return low;
}

// ---------------------------------------------------------------------------
// Record ceilings
// ---------------------------------------------------------------------------

const BEST_KEYS: Record<PrKind, keyof PreviousBests> = {
  heaviest_weight: 'heaviestKg',
  best_1rm: 'bestOneRepMaxKg',
  best_set_volume: 'bestSetVolumeKg',
  best_session_volume: 'bestSessionVolumeKg',
  most_reps: 'mostReps',
  best_duration: 'bestDurationSeconds',
  best_distance: 'bestDistanceKm',
};

/**
 * Every all-time best on the device, read once and then kept current in memory.
 *
 * The alternative is `getPreviousBests` per exercise per session, which is a
 * query for every one of the ~6,000 (workout, exercise) pairs in a long import.
 * Holding the ceiling in a map instead is both faster and the only way the
 * chronological pass stays correct within a single run: session two has to see
 * the record session one just set, and that record has not been re-read from
 * anywhere.
 */
async function loadPersonalBests(): Promise<Map<string, PreviousBests>> {
  const rows = await db
    .select({
      exerciseId: personalRecords.exerciseId,
      kind: personalRecords.kind,
      value: personalRecords.value,
    })
    .from(personalRecords)
    .where(isNull(personalRecords.deletedAt));

  const bests = new Map<string, PreviousBests>();
  for (const row of rows) applyBest(bests, row.exerciseId, row.kind, row.value);

  return bests;
}

function applyBest(
  bests: Map<string, PreviousBests>,
  exerciseId: string,
  kind: PrKind,
  value: number,
): void {
  const current = bests.get(exerciseId) ?? {};
  const key = BEST_KEYS[kind];
  if (value <= (current[key] ?? 0)) return;

  const next: PreviousBests = { ...current };
  next[key] = value;
  bests.set(exerciseId, next);
}

// ---------------------------------------------------------------------------
// Reads for the confirmation screen
// ---------------------------------------------------------------------------

/**
 * How many of these sessions the log already holds.
 *
 * Runs before anything is written so the screen can say "40 of these 63 are
 * already here" rather than reporting it afterwards, when the user has already
 * committed to a number they now know was wrong.
 */
export async function countAlreadyPresent(
  imported: readonly ImportedWorkout[],
): Promise<number> {
  if (imported.length === 0) return 0;

  const existing = await loadExistingStarts();
  let present = 0;

  // Counted against a growing copy for the same reason the import inserts into
  // one: two sessions in the file a minute apart are one workout, and the
  // second is a duplicate of the first whether or not the log has it yet.
  for (const workout of [...imported].sort((a, b) => a.startedAt - b.startedAt)) {
    if (hasNearby(existing, workout.startedAt)) present += 1;
    else insertSorted(existing, workout.startedAt);
  }

  return present;
}

/** The most recent session in the log, for "your log already runs to …". */
export async function latestWorkoutDate(): Promise<Date | null> {
  const starts = await loadExistingStarts();
  const last = starts[starts.length - 1];
  return last === undefined ? null : new Date(last);
}
