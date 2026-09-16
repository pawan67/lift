/**
 * Workout session lifecycle: start → log → finish.
 *
 * The in-progress session is an ordinary `workouts` row with `finishedAt` null
 * rather than in-memory state. A force-quit mid-set therefore loses nothing, and
 * "resume workout" needs no special persistence path.
 */

import {
  detectPrs,
  isWorkingSet,
  normalizeSupersets,
  summarizeSets,
  TRACKING_FIELDS,
  uuidv7,
  type AnalyticsContext,
  type ExerciseSession,
  type PositionedRow,
  type PrKind,
  type SupersetAssignment,
  type SetLike,
  type SetType,
  type TrackingType,
} from '@lift/shared';
import { and, desc, eq, inArray, isNull, isNotNull, lt, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { touch, trackDelete, trackUpsert, trackUpsertCoalesced } from '@/db/mutations';
import {
  exercises,
  personalRecords,
  routineExercises,
  routineSets,
  routines,
  workoutExercises,
  workoutSets,
  workouts,
  type Exercise,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '@/db/schema';
import type { RestKind } from '@/store/timer';

import { pairWithPrevious } from './previous';

// ---------------------------------------------------------------------------
// Composite read models
// ---------------------------------------------------------------------------

export interface WorkoutExerciseDetail {
  workoutExercise: WorkoutExercise;
  exercise: Exercise;
  sets: WorkoutSet[];
}

export interface WorkoutDetail {
  workout: Workout;
  exercises: WorkoutExerciseDetail[];
}

/**
 * How long to rest after this exercise.
 *
 * Three levels, most specific first: what this session says, then what the
 * exercise itself carries from the last time it was set, then the app default.
 * Every caller resolves through here so the timer, the chip that displays it
 * and the editor that changes it can never disagree.
 */
export function resolveRestSeconds(
  detail: WorkoutExerciseDetail,
  appDefaultSeconds: number,
): number {
  return (
    detail.workoutExercise.restSeconds ?? detail.exercise.defaultRestSeconds ?? appDefaultSeconds
  );
}

/** False when the rest above is only the app default, with nothing set for this exercise. */
export function hasRestOverride(detail: WorkoutExerciseDetail): boolean {
  return detail.workoutExercise.restSeconds !== null || detail.exercise.defaultRestSeconds !== null;
}

/**
 * A warm-up is rehearsal, not work. Two minutes between the empty bar and 60 kg
 * is the app padding out a session nobody asked it to pad.
 */
const WARMUP_REST_CAP_SECONDS = 45;

export interface RestPlan {
  /** Zero means "do not rest": see the caller note on `restAfterSet`. */
  seconds: number;
  kind: RestKind;
}

/**
 * How long to rest after *this particular set*, and what to call it.
 *
 * A deliberate sibling of `resolveRestSeconds` rather than an extra argument to
 * it. That function is the one place the timer, the header chip and the
 * duration editor agree on a number, and all three are asking about the
 * exercise, not about a set. Threading `setType` through it would make the
 * chip advertise a duration that only applies to whichever set came last.
 *
 * Two set classes override the exercise's own figure. A warm-up is capped, and
 * a drop set is by definition taken immediately, so the set *before* one gets
 * no rest at all.
 *
 * **Zero has to be handled by the caller as an explicit stop.** `startRest`
 * no-ops on `seconds <= 0` rather than clearing what is already running, so
 * passing this straight through would leave the previous set's countdown on
 * screen during the drop. Call `stopRest()` (and cancel the notification) when
 * `seconds` is zero.
 */
export function restAfterSet(
  detail: WorkoutExerciseDetail,
  set: WorkoutSet,
  appDefaultSeconds: number,
): RestPlan {
  const kind: RestKind = set.setType === 'warmup' ? 'warmup' : 'working';
  const full = resolveRestSeconds(detail, appDefaultSeconds);

  const index = detail.sets.findIndex((row) => row.id === set.id);
  const next = index === -1 ? undefined : detail.sets[index + 1];
  if (next?.setType === 'drop') return { seconds: 0, kind };

  if (kind === 'warmup') return { seconds: Math.min(full, WARMUP_REST_CAP_SECONDS), kind };

  return { seconds: full, kind };
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * The unfinished session, if one exists.
 *
 * Newest first and limited to one: `createSession` allows only a single open
 * session, but a row left behind by an older build has to resolve to the one
 * the user was actually in, not to whichever the query happened to return.
 */
export async function getActiveWorkout(): Promise<Workout | undefined> {
  const [row] = await db
    .select()
    .from(workouts)
    .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt)))
    .orderBy(desc(workouts.startedAt))
    .limit(1);

  return row;
}

/**
 * Thrown when something asks for a new session while one is still open.
 *
 * Carries the session that is in the way, because every caller needs to name it
 * ("Push Day is still open") or navigate to it, and re-reading it would race.
 *
 * A throw rather than a null or a `{ created: false }` flag: an ignorable
 * return value is exactly how the old get-or-create shipped for months, with
 * "Start Leg Day" quietly resuming Push Day. This forces each call site to
 * decide, and makes a call site that forgot to a compile error.
 */
export class ActiveWorkoutExistsError extends Error {
  constructor(readonly workout: Workout) {
    super(`A workout is already in progress: ${workout.name}`);
    this.name = 'ActiveWorkoutExistsError';
  }
}

/**
 * Inserts the session row itself, refusing when one is already open.
 *
 * Two concurrent sessions would make "the active workout" ambiguous everywhere
 * downstream, so this is the single gate: `startWorkout` and `repeatWorkout`
 * both pass through it and neither can accidentally skip the check.
 */
async function createSession(options: {
  routineId?: string | null;
  name?: string | null;
}): Promise<Workout> {
  const existing = await getActiveWorkout();
  if (existing) throw new ActiveWorkoutExistsError(existing);

  const now = Date.now();

  const workout = {
    id: uuidv7(),
    routineId: options.routineId ?? null,
    name: options.name ?? defaultWorkoutName(new Date(now)),
    notes: null,
    startedAt: new Date(now),
    finishedAt: null,
    durationSeconds: null,
    totalVolumeKg: 0,
    totalSets: 0,
    totalReps: 0,
    prCount: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(workouts).values(workout);
  await trackUpsert('workouts', serializeWorkout(workout));

  return workout;
}

/**
 * Begins a session, optionally pre-filled from a routine.
 *
 * Throws `ActiveWorkoutExistsError` when one is already running; it never
 * returns the open session. Resuming is a different intent from starting and
 * the two look identical from the button, so the decision belongs to the screen
 * that knows which routine the user actually tapped.
 */
export async function startWorkout(options: {
  routineId?: string;
  name?: string;
} = {}): Promise<Workout> {
  const routine = options.routineId ? await getRoutine(options.routineId) : undefined;

  const workout = await createSession({
    routineId: options.routineId,
    name: options.name ?? routine?.name,
  });

  if (options.routineId) await copyRoutineIntoWorkout(options.routineId, workout.id);

  return workout;
}

/**
 * Starts a session shaped like one already in the log.
 *
 * Copies the structure, which exercises, in what order, their notes, rest and
 * superset grouping, and one row per set with its position and set type, but
 * deliberately **not** the weights and reps. `finishWorkout` discards unchecked
 * sets, so the source is a record of what was performed rather than planned,
 * and pre-filling it would turn every repeat into a page of numbers the user
 * has to audit before trusting. Last session's figures are already one column
 * away in Previous, and already sitting in each field as a placeholder.
 *
 * Throws `ActiveWorkoutExistsError` for the same reason `startWorkout` does.
 */
export async function repeatWorkout(sourceWorkoutId: string): Promise<Workout> {
  const source = await getWorkoutDetail(sourceWorkoutId);
  if (!source) throw new Error(`Workout ${sourceWorkoutId} not found`);

  // The routine link travels with the copy: repeating a session that came from
  // a routine is still performing that routine, and `finishWorkout` reads the
  // link to stamp `lastPerformedAt`.
  const workout = await createSession({
    routineId: source.workout.routineId,
    name: source.workout.name,
  });

  for (const entry of source.exercises) {
    const created = await addExerciseToWorkout(workout.id, entry.exercise.id, {
      position: entry.workoutExercise.position,
      notes: entry.workoutExercise.notes,
      restSeconds: entry.workoutExercise.restSeconds,
      supersetGroup: entry.workoutExercise.supersetGroup,
    });

    for (const set of entry.sets) {
      await addSet(created.id, { position: set.position, setType: set.setType });
    }
  }

  return workout;
}

/**
 * The time of day, so an unnamed session still reads as something in the log.
 *
 * Sentence case like every other string the app authors: these are rendered as
 * screen titles, and Title Case there would sit oddly beside the workout names
 * the user types themselves.
 *
 * Exported for the importer, which meets the same problem from the other end:
 * plenty of exports carry no workout title at all, and those sessions should
 * land in the log named the way the app names its own.
 */
export function defaultWorkoutName(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Morning workout';
  if (hour < 17) return 'Afternoon workout';
  if (hour < 21) return 'Evening workout';
  return 'Night workout';
}

async function getRoutine(routineId: string) {
  const [row] = await db.select().from(routines).where(eq(routines.id, routineId)).limit(1);
  return row;
}

/**
 * Materialises a routine's prescribed exercises and target sets into a session.
 *
 * ## What lands in the fields
 *
 * Last session's numbers, and the routine's targets only where there are none.
 *
 * The rows used to be seeded from the targets alone, which meant a routine
 * written once, months ago, as "3 × 10" put a 10 in front of somebody who has
 * been doing twelves since February, every session, for them to clear and
 * retype. A target is what the routine asked for when it was written; what the
 * user lifted last time is what they are about to do again. When the two
 * disagree, the second one is the better guess, and it is the one the Previous
 * column beside it is already showing.
 *
 * The targets are not dead weight: they fill every slot history cannot. A first
 * time through an exercise, a fourth set on a routine that has only ever been
 * taken to three, a warm-up ramp that was skipped last week. `pairWithPrevious`
 * pairs by ordinal *within set class*, the same walk the logging screen draws
 * the Previous column with, so a routine's warm-ups line up against last
 * session's warm-ups rather than against its first working set.
 *
 * Per-field rather than per-row: an exercise logged last time with reps but no
 * weight keeps the routine's target weight beside its performed reps, instead
 * of a history row's null blanking a prescription that was there.
 *
 * RPE is the exception and always comes from the target. It is a prescription
 * about how hard to go, not a measurement to repeat, and most rows carry none
 * at all.
 */
async function copyRoutineIntoWorkout(routineId: string, workoutId: string): Promise<void> {
  const planned = await db
    .select()
    .from(routineExercises)
    .where(and(eq(routineExercises.routineId, routineId), isNull(routineExercises.deletedAt)))
    .orderBy(routineExercises.position);

  for (const plannedExercise of planned) {
    const created = await addExerciseToWorkout(workoutId, plannedExercise.exerciseId, {
      position: plannedExercise.position,
      notes: plannedExercise.notes,
      restSeconds: plannedExercise.restSeconds,
      supersetGroup: plannedExercise.supersetGroup,
    });

    const targets = await db
      .select()
      .from(routineSets)
      .where(
        and(eq(routineSets.routineExerciseId, plannedExercise.id), isNull(routineSets.deletedAt)),
      )
      .orderBy(routineSets.position);

    // What was actually lifted the last time this exercise came up. Excluding
    // the session being built is belt and braces: it has no `finishedAt` yet,
    // so it cannot be a candidate, but the intent should not depend on that.
    const { sets: performed } = await getPreviousPerformance(plannedExercise.exerciseId, {
      excludeWorkoutId: workoutId,
    });

    for (const { set: target, previous } of pairWithPrevious(targets, performed)) {
      await addSet(created.id, {
        position: target.position,
        setType: target.setType,
        // Seeded but unchecked, either way. The user still logs what they
        // actually did; this only decides which numbers they are correcting
        // rather than typing.
        weightKg: previous?.weightKg ?? target.targetWeightKg,
        reps: previous?.reps ?? target.targetReps,
        durationSeconds: previous?.durationSeconds ?? target.targetDurationSeconds,
        distanceKm: previous?.distanceKm ?? target.targetDistanceKm,
        rpe: target.targetRpe,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Exercises within a session
// ---------------------------------------------------------------------------

export async function addExerciseToWorkout(
  workoutId: string,
  exerciseId: string,
  options: {
    position?: number;
    notes?: string | null;
    restSeconds?: number | null;
    supersetGroup?: number | null;
  } = {},
): Promise<WorkoutExercise> {
  const now = Date.now();
  const position = options.position ?? (await nextPosition(workoutId));

  const row = {
    id: uuidv7(),
    workoutId,
    exerciseId,
    position,
    notes: options.notes ?? null,
    restSeconds: options.restSeconds ?? null,
    supersetGroup: options.supersetGroup ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(workoutExercises).values(row);
  await trackUpsert('workout_exercises', row);

  return row;
}

async function nextPosition(workoutId: string): Promise<number> {
  const rows = await db
    .select({ position: workoutExercises.position })
    .from(workoutExercises)
    .where(and(eq(workoutExercises.workoutId, workoutId), isNull(workoutExercises.deletedAt)));

  return rows.reduce((max, row) => Math.max(max, row.position), 0) + 1;
}

export async function removeExerciseFromWorkout(workoutExerciseId: string): Promise<void> {
  const deletedAt = Date.now();

  // Read before the tombstone, so the superset sweep at the end knows which
  // session to look at.
  const [link] = await db
    .select({ workoutId: workoutExercises.workoutId })
    .from(workoutExercises)
    .where(eq(workoutExercises.id, workoutExerciseId))
    .limit(1);

  await db
    .update(workoutExercises)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(workoutExercises.id, workoutExerciseId));

  await trackDelete('workout_exercises', workoutExerciseId, deletedAt);

  // Tombstone the children explicitly. SQLite's ON DELETE CASCADE only fires on
  // a real DELETE, and a soft delete of the parent would otherwise leave the
  // sets alive on other devices.
  const children = await db
    .select({ id: workoutSets.id })
    .from(workoutSets)
    .where(and(eq(workoutSets.workoutExerciseId, workoutExerciseId), isNull(workoutSets.deletedAt)));

  for (const child of children) {
    await db
      .update(workoutSets)
      .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
      .where(eq(workoutSets.id, child.id));
    await trackDelete('workout_sets', child.id, deletedAt);
  }

  // Taking one half of a pair out of the session leaves the other half holding
  // a group id with nothing to be paired with, which is not a superset. The
  // screen's own copy is already stale by this point, so the sweep reads the
  // rows back rather than being handed them.
  if (link) await sweepSupersets(link.workoutId);
}

/**
 * Clears any superset a structural edit has just invalidated.
 *
 * Removing an exercise and substituting one below another are both list edits
 * that nothing in the superset code asked for and neither can see coming: one
 * leaves a member alone, the other puts a lift between two that were performed
 * back to back. `normalizeSupersets` decides what no longer holds; this is only
 * the read that feeds it.
 *
 * A reorder is the third such edit, and it is handled at the screens instead:
 * they already hold the reordered list, so re-reading the session to find out
 * what they just wrote would be a round trip to learn something they know.
 */
async function sweepSupersets(workoutId: string): Promise<void> {
  const links = await db
    .select({ id: workoutExercises.id, supersetGroup: workoutExercises.supersetGroup })
    .from(workoutExercises)
    .where(and(eq(workoutExercises.workoutId, workoutId), isNull(workoutExercises.deletedAt)))
    .orderBy(workoutExercises.position);

  await applySupersetGroups(normalizeSupersets(links));
}

/** The measurement columns a tracking type switches on and off. */
type TrackedSetColumn = 'weightKg' | 'reps' | 'durationSeconds' | 'distanceKm';

export interface SubstitutionResult {
  /** The row now carrying the new exercise. The original one when it was reused. */
  workoutExercise: WorkoutExercise;
  /** False when completed sets forced the replacement to be inserted below instead. */
  replacedInPlace: boolean;
}

/**
 * Swaps the exercise in a slot, mid-session.
 *
 * The bench is taken, the cable stack is missing a pin, the leg press has a
 * queue. This is the most common thing that happens in a gym that the log
 * previously could not express, leaving "delete and re-add" as the only route
 * and taking the block's rest and notes with it.
 *
 * Nothing already logged is ever rewritten. If a set in the block is checked
 * off, those reps were performed on the old machine and the slot is left alone;
 * the replacement is inserted immediately below at `position + 0.5`, which is
 * why `position` is REAL. Only an untouched block is reused in place, keeping
 * its position, notes and superset grouping.
 *
 * Rest is cleared on a reuse even though notes are kept. Five minutes was a
 * decision about squats, not about the third slot of the session, and the new
 * exercise carries its own default. The load is cleared for the same reason,
 * and set columns the new tracking type has no field for are nulled at the same
 * time, so a planned 80 kg does not survive into a plank as invisible volume.
 */
export async function substituteExercise(
  workoutExerciseId: string,
  newExerciseId: string,
): Promise<SubstitutionResult> {
  const [link] = await db
    .select()
    .from(workoutExercises)
    .where(eq(workoutExercises.id, workoutExerciseId))
    .limit(1);
  if (!link) throw new Error(`Workout exercise ${workoutExerciseId} not found`);

  const [replacement] = await db
    .select()
    .from(exercises)
    .where(eq(exercises.id, newExerciseId))
    .limit(1);
  if (!replacement) throw new Error(`Exercise ${newExerciseId} not found`);

  const sets = await db
    .select()
    .from(workoutSets)
    .where(and(eq(workoutSets.workoutExerciseId, workoutExerciseId), isNull(workoutSets.deletedAt)))
    .orderBy(workoutSets.position);

  if (sets.some((set) => set.isCompleted)) {
    const created = await addExerciseToWorkout(link.workoutId, newExerciseId, {
      position: link.position + 0.5,
    });
    // One empty set, matching what adding an exercise by hand produces: a
    // block with no rows reads as an error rather than an invitation.
    await addSet(created.id);

    // The replacement went *between* the original and whatever followed it. If
    // those two were a superset, an unrelated lift is now standing in the
    // middle of it and it is not one any more.
    await sweepSupersets(link.workoutId);

    return { workoutExercise: created, replacedInPlace: false };
  }

  await db
    .update(workoutExercises)
    .set({ exerciseId: newExerciseId, restSeconds: null, ...touch() })
    .where(eq(workoutExercises.id, workoutExerciseId));

  const [updated] = await db
    .select()
    .from(workoutExercises)
    .where(eq(workoutExercises.id, workoutExerciseId))
    .limit(1);
  if (!updated) throw new Error(`Workout exercise ${workoutExerciseId} vanished mid-substitution`);

  await trackUpsertCoalesced('workout_exercises', updated);

  const fields = TRACKING_FIELDS[replacement.trackingType];
  const clear: SetInput = {};
  const cleared: TrackedSetColumn[] = [];

  // The load belonged to the exercise that just left the slot, so it never
  // carries. Even when the replacement still has a weight field the number
  // means something else: `weighted_bodyweight` adds it to bodyweight,
  // `assisted_bodyweight` subtracts it, and 80 kg of barbell bench is not 80 kg
  // of dumbbell bench. Reps, time and distance are plan targets and do carry.
  clear.weightKg = null;
  cleared.push('weightKg');

  if (!fields.reps) {
    clear.reps = null;
    cleared.push('reps');
  }
  if (!fields.duration) {
    clear.durationSeconds = null;
    cleared.push('durationSeconds');
  }
  if (!fields.distance) {
    clear.distanceKm = null;
    cleared.push('distanceKm');
  }

  for (const set of sets) {
    // Only the rows that actually carry a stale number, so substituting into a
    // fresh block of five empty sets doesn't emit five writes and five oplog
    // entries that change nothing.
    if (cleared.some((column) => set[column] !== null)) await updateSet(set.id, clear);
  }

  return { workoutExercise: updated, replacedInPlace: true };
}

/** Reorders exercises by rewriting only the moved row's fractional position. */
export async function reorderExercise(
  workoutExerciseId: string,
  newPosition: number,
): Promise<void> {
  await applyExerciseOrder([{ id: workoutExerciseId, position: newPosition }]);
}

/**
 * Applies the writes a reorder produced.
 *
 * Takes the rows rather than a from/to pair because the caller has already done
 * the arithmetic: `reorder()` in `@lift/shared` decides whether a move is one
 * midpoint or a full renumber, and this only has to write whatever it handed
 * back. Usually that is a single row, which is the entire point of `position`
 * being a REAL.
 *
 * Sequential rather than batched: each write also emits an oplog entry, and the
 * sync layer's coalescing is per row. A renumber of ten exercises is ten
 * statements, which happens roughly never: see `MIN_GAP` in `ordering.ts`.
 */
export async function applyExerciseOrder(updates: PositionedRow[]): Promise<void> {
  if (updates.length === 0) return;

  for (const { id, position } of updates) {
    await db
      .update(workoutExercises)
      .set({ position, ...touch() })
      .where(eq(workoutExercises.id, id));

    const [updated] = await db
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.id, id))
      .limit(1);

    if (updated) await trackUpsertCoalesced('workout_exercises', updated);
  }
}

/**
 * Applies the writes a superset edit produced.
 *
 * The sibling of `applyExerciseOrder`, down to the shape: `@lift/shared`'s
 * `supersets.ts` decides which rows change and this writes exactly those. A
 * pair being formed is two rows; a lift joining a pair that already exists is
 * one.
 *
 * **Every reorder ends here too.** Dropping an exercise between two halves of a
 * superset dismantles it, and the drag handle has no idea it did that, so the
 * screens run `normalizeSupersets` over the reordered list and pass whatever it
 * asks for. Usually that is nothing, and this returns without a statement.
 */
export async function applySupersetGroups(updates: SupersetAssignment[]): Promise<void> {
  if (updates.length === 0) return;

  for (const { id, supersetGroup } of updates) {
    await db
      .update(workoutExercises)
      .set({ supersetGroup, ...touch() })
      .where(eq(workoutExercises.id, id));

    const [updated] = await db
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.id, id))
      .limit(1);

    if (updated) await trackUpsertCoalesced('workout_exercises', updated);
  }
}

/**
 * Sets how long to rest after this exercise, now and in future sessions.
 *
 * Two writes on purpose. The session row is what the running workout reads, and
 * the exercise row is the fallback every *later* workout resolves against.
 * Deciding that heavy squats need five minutes is a fact about squats, not
 * about today, and having to re-enter it every session is the whole reason
 * per-exercise rest is worth having.
 *
 * `null` clears both and falls back to the app-wide default.
 */
export async function setExerciseRest(
  workoutExerciseId: string,
  exerciseId: string,
  restSeconds: number | null,
): Promise<void> {
  const stamp = touch();

  await db
    .update(workoutExercises)
    .set({ restSeconds, ...stamp })
    .where(eq(workoutExercises.id, workoutExerciseId));

  const [link] = await db
    .select()
    .from(workoutExercises)
    .where(eq(workoutExercises.id, workoutExerciseId))
    .limit(1);

  // Coalesced: nudging the duration a few times before settling should leave
  // one row to push, not one per tap.
  if (link) await trackUpsertCoalesced('workout_exercises', link);

  await db
    .update(exercises)
    .set({ defaultRestSeconds: restSeconds, ...stamp })
    .where(eq(exercises.id, exerciseId));

  const [exercise] = await db
    .select()
    .from(exercises)
    .where(eq(exercises.id, exerciseId))
    .limit(1);

  // Built-ins exist identically on every device and never cross the wire, so
  // only a user-created exercise is worth replicating. The local write still
  // happened either way, which is what the next workout reads.
  if (exercise?.isCustom) await trackUpsertCoalesced('exercises', exercise);
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

export interface SetInput {
  position?: number;
  setType?: SetType;
  weightKg?: number | null;
  reps?: number | null;
  durationSeconds?: number | null;
  distanceKm?: number | null;
  rpe?: number | null;
  isCompleted?: boolean;
}

/**
 * Whether checking this set off would record anything.
 *
 * Lives here because two files ask the question and they must not answer it
 * differently: the active screen decides whether to accept the tap, and the row
 * decides whether to run the optimistic tint before the write echoes back. When
 * they disagreed, the screen accepted the set while the row believed it was
 * refused, and the plate stayed grey until SQLite and the live query came back:
 * exactly the latency the optimistic path exists to hide.
 *
 * `previous` counts because an empty field means "same as last time" on the
 * most common gesture in the app: the numbers are already on screen as
 * placeholders, and the screen folds them into the write. Weight is excluded on
 * rep-tracked work on purpose. There the reps are the measure and an empty
 * weight is a fact ("no belt today"), so it cannot stand in for them. On
 * `weight_distance` there is no rep count at all, which makes the carried load
 * a measurement in its own right and it counts.
 */
export function canLogSet(
  fields: (typeof TRACKING_FIELDS)[TrackingType],
  set: Pick<WorkoutSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceKm'>,
  previous?: Pick<WorkoutSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceKm'>,
): boolean {
  const has = (key: 'weightKg' | 'reps' | 'durationSeconds' | 'distanceKm') =>
    set[key] != null || previous?.[key] != null;

  if (fields.reps) return has('reps');

  // Everything else is measured by time, distance, or a carried load, and any
  // one of them alone is a record: a run logged as 5 km with no clock, a
  // farmer's walk logged as 40 kg with no course. Only a row holding none of
  // its own measurements is refused.
  if (fields.duration || fields.distance) {
    return (
      (fields.duration && has('durationSeconds')) ||
      (fields.distance && has('distanceKm')) ||
      (fields.distance && fields.weight && has('weightKg'))
    );
  }

  return true;
}

export async function addSet(
  workoutExerciseId: string,
  input: SetInput = {},
): Promise<WorkoutSet> {
  const now = Date.now();

  const position = input.position ?? (await nextSetPosition(workoutExerciseId));

  const row = {
    id: uuidv7(),
    workoutExerciseId,
    position,
    setType: input.setType ?? 'normal',
    weightKg: input.weightKg ?? null,
    reps: input.reps ?? null,
    durationSeconds: input.durationSeconds ?? null,
    distanceKm: input.distanceKm ?? null,
    rpe: input.rpe ?? null,
    isCompleted: input.isCompleted ?? false,
    completedAt: input.isCompleted ? new Date(now) : null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(workoutSets).values(row);
  await trackUpsert('workout_sets', serializeSet(row));

  return row;
}

async function nextSetPosition(workoutExerciseId: string): Promise<number> {
  const rows = await db
    .select({ position: workoutSets.position })
    .from(workoutSets)
    .where(and(eq(workoutSets.workoutExerciseId, workoutExerciseId), isNull(workoutSets.deletedAt)));

  return rows.reduce((max, row) => Math.max(max, row.position), 0) + 1;
}

/**
 * Updates a set. `patch` overwrites; `fill` only lands where the column is
 * still null.
 *
 * Uses the coalescing oplog write because editing a weight field emits a
 * mutation per keystroke; only the final value needs to reach the server.
 *
 * `fill` exists because the caller cannot see current storage. The active
 * screen decides what to copy forward from last session using the set it
 * rendered, which lags the database by one live-query round trip, so typing
 * "102.5" and tapping the check inside that window would queue last week's 100
 * *after* the keystroke's write and silently replace the typed figure. Written
 * as `coalesce(column, value)`, the decision is made by SQLite against the row
 * as it stands when the statement runs, so render timing cannot matter. A
 * re-read before the write would not close it: the gap would just move into JS.
 */
export async function updateSet(
  setId: string,
  patch: SetInput,
  fill: SetInput = {},
): Promise<void> {
  const changes: Record<string, unknown> = { ...patch, ...touch() };

  for (const [column, value] of Object.entries(fill)) {
    if (value == null) continue;
    const target = workoutSets[column as keyof typeof workoutSets];
    changes[column] = sql`coalesce(${target}, ${value})`;
  }

  // Completion time is derived, never passed in by callers.
  if (patch.isCompleted !== undefined) {
    changes.completedAt = patch.isCompleted ? new Date() : null;
  }

  await db.update(workoutSets).set(changes).where(eq(workoutSets.id, setId));

  const [updated] = await db.select().from(workoutSets).where(eq(workoutSets.id, setId)).limit(1);
  if (updated) await trackUpsertCoalesced('workout_sets', serializeSet(updated));
}

export async function deleteSet(setId: string): Promise<void> {
  const deletedAt = Date.now();

  await db
    .update(workoutSets)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(workoutSets.id, setId));

  await trackDelete('workout_sets', setId, deletedAt);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getWorkoutDetail(workoutId: string): Promise<WorkoutDetail | undefined> {
  const [workout] = await db.select().from(workouts).where(eq(workouts.id, workoutId)).limit(1);
  if (!workout) return undefined;

  const links = await db
    .select()
    .from(workoutExercises)
    .where(and(eq(workoutExercises.workoutId, workoutId), isNull(workoutExercises.deletedAt)))
    .orderBy(workoutExercises.position);

  if (links.length === 0) return { workout, exercises: [] };

  const exerciseRows = await db
    .select()
    .from(exercises)
    .where(inArray(exercises.id, [...new Set(links.map((link) => link.exerciseId))]));

  const exerciseById = new Map(exerciseRows.map((row) => [row.id, row]));

  const setRows = await db
    .select()
    .from(workoutSets)
    .where(
      and(
        inArray(workoutSets.workoutExerciseId, links.map((link) => link.id)),
        isNull(workoutSets.deletedAt),
      ),
    )
    .orderBy(workoutSets.position);

  const setsByParent = new Map<string, WorkoutSet[]>();
  for (const set of setRows) {
    const bucket = setsByParent.get(set.workoutExerciseId);
    if (bucket) bucket.push(set);
    else setsByParent.set(set.workoutExerciseId, [set]);
  }

  const details: WorkoutExerciseDetail[] = [];
  for (const link of links) {
    const exercise = exerciseById.get(link.exerciseId);
    // An exercise deleted out from under a historical workout shouldn't crash
    // the screen; skip the orphan rather than rendering a broken row.
    if (!exercise) continue;

    details.push({
      workoutExercise: link,
      exercise,
      sets: setsByParent.get(link.id) ?? [],
    });
  }

  return { workout, exercises: details };
}

export async function listCompletedWorkouts(limit = 50, offset = 0): Promise<Workout[]> {
  return db
    .select()
    .from(workouts)
    .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt)))
    .orderBy(desc(workouts.startedAt))
    .limit(limit)
    .offset(offset);
}

export interface PreviousPerformanceOptions {
  /** A session to leave out. Normally the one being logged or edited. */
  excludeWorkoutId?: string;
  /**
   * Only consider sessions that started before this instant.
   *
   * Unbounded, "previous" means "most recent", which is the right answer while
   * lifting and the wrong one when editing a session from March: the newest
   * other session is then a *later* one, and the column headed Previous would
   * be offering numbers from the future of the workout on screen.
   */
  before?: number;
}

export interface PreviousPerformance {
  /** Completed sets from the most recent session that trained this exercise. */
  sets: WorkoutSet[];
  /**
   * The most recent note written against this exercise, from any of the last
   * few sessions rather than only the one the sets came from.
   *
   * Cues are sticky. "Pin 4, not 5" or "left knee. Go slow out of the hole" is
   * true until it isn't, and the session it was typed in may be three back. The
   * app already knew this and threw it away every time the screen loaded.
   */
  note: string | null;
  /**
   * The same window of sessions the note is drawn from, newest first, each
   * holding the completed **working** sets it logged. What `suggestProgression`
   * reads.
   *
   * `sets` above is one session and every class of set in it, because it feeds
   * the Previous column, which pairs warm-ups against warm-ups. This is that
   * window widened and narrowed at once: several sessions, working sets only.
   * A stall is a run of sessions that failed to beat the one before, and nothing
   * can see one from a single session, which is all the app was reading here,
   * having already paid for the query that found the others.
   *
   * Sessions that completed no working set are left out rather than carried as
   * empties: an exercise opened and abandoned is not evidence either way, and
   * an empty session in the middle of the run would read as a failed one.
   */
  sessions: ExerciseSession[];
}

/**
 * What happened last time: the sets to fill the "previous" column, the note to
 * put back in front of the user, and the run of sessions behind both.
 */
export async function getPreviousPerformance(
  exerciseId: string,
  options: PreviousPerformanceOptions = {},
): Promise<PreviousPerformance> {
  const { excludeWorkoutId, before } = options;

  const links = await db
    .select({
      id: workoutExercises.id,
      notes: workoutExercises.notes,
      startedAt: workouts.startedAt,
      workoutId: workouts.id,
    })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(
      and(
        eq(workoutExercises.exerciseId, exerciseId),
        isNotNull(workouts.finishedAt),
        isNull(workouts.deletedAt),
        isNull(workoutExercises.deletedAt),
        ...(before === undefined ? [] : [lt(workouts.startedAt, new Date(before))]),
      ),
    )
    .orderBy(desc(workouts.startedAt))
    .limit(5);

  const earlier = links.filter((link) => link.workoutId !== excludeWorkoutId);
  const candidate = earlier[0];
  // The newest session that has a note, not the newest session. The two are
  // usually different, and the older one is still the standing instruction.
  const note = earlier.find((link) => link.notes)?.notes ?? null;

  if (!candidate) return { sets: [], note, sessions: [] };

  // One statement for the whole window rather than one per session. This runs
  // for every exercise in the session the moment the logging screen opens, so
  // a query per link is five round trips per block before anything is painted,
  // and the widest case, five sessions, is exactly the one where the engine has
  // something to say.
  const setRows = await db
    .select()
    .from(workoutSets)
    .where(
      and(
        inArray(workoutSets.workoutExerciseId, earlier.map((link) => link.id)),
        eq(workoutSets.isCompleted, true),
        isNull(workoutSets.deletedAt),
      ),
    )
    .orderBy(workoutSets.position);

  const byLink = new Map<string, WorkoutSet[]>();
  for (const set of setRows) {
    const bucket = byLink.get(set.workoutExerciseId);
    if (bucket) bucket.push(set);
    else byLink.set(set.workoutExerciseId, [set]);
  }

  const sessions: ExerciseSession[] = [];
  for (const link of earlier) {
    const working = (byLink.get(link.id) ?? []).filter((set) => isWorkingSet(set.setType));
    if (working.length > 0) sessions.push({ startedAt: link.startedAt.getTime(), sets: working });
  }

  // Unchanged, and deliberately so: the newest earlier session, every class of
  // set it completed, in position order. The Previous column and the numbers a
  // bare check-off commits are both built from this.
  const sets = byLink.get(candidate.id) ?? [];

  return { sets, note, sessions };
}

// ---------------------------------------------------------------------------
// Finishing
// ---------------------------------------------------------------------------

export interface FinishResult {
  workout: Workout;
  prCount: number;
}

/**
 * Closes out a session: recomputes totals, awards PRs, then drops unchecked sets.
 *
 * Unlogged sets are discarded rather than saved as zeros. A planned fourth set
 * the user never did should not drag their averages down or count toward volume.
 *
 * That deletion happens *last*, and the order is the whole safety story. There
 * is no transaction to fall back on (an async callback commits before its first
 * `await` resolves on this driver), so the sequence is: read everything, derive
 * the totals in memory, write the finished session, and only then remove rows.
 * A failure anywhere leaves either an untouched session or a correctly finished
 * one carrying a few unchecked rows, which every query already ignores. The
 * previous order deleted first, so the same failure lost the sets *and*
 * reported nothing.
 *
 * The durable point is the oplog write that follows the session update, and
 * only failures above it reject. The cleanup below swallows its own, because a
 * rejection there would have the caller announce that the session stayed open
 * when it is finished, closed, and already gone from the active-session query:
 * leaving the user told to retry something they can no longer reach.
 *
 * `summarizeSets` and `detectPrs` both skip incomplete sets themselves, so
 * working from the pre-deletion snapshot changes no number.
 *
 * `name` and `notes` arrive from the save screen that sits in front of this
 * call, and they are folded into the *same* statement as the totals rather than
 * written by one of their own. Two statements can half-land: a session finished
 * under yesterday's name, or renamed and left open, and they would also publish
 * as two versions of the row, so a device receiving the sync would see a rename
 * and a finish rather than one saved workout.
 *
 * A blank name is ignored rather than stored. Every screen titles the session by
 * it and `defaultWorkoutName` guarantees there is one, so an emptied field means
 * the user cleared the box, not that this workout is to be called nothing. An
 * emptied *note* is stored as null, because "I have nothing to say about this
 * session" is a thing someone can mean: matching what the per-exercise note
 * editor writes for the same gesture.
 */
export async function finishWorkout(
  workoutId: string,
  options: {
    bodyweightKg?: number;
    formula?: AnalyticsContext['formula'];
    /** Renames the session. Blank or whitespace-only keeps the existing name. */
    name?: string;
    /** Replaces the session's note. `null` or blank clears it; omitted leaves it. */
    notes?: string | null;
  } = {},
): Promise<FinishResult> {
  const detail = await getWorkoutDetail(workoutId);
  if (!detail) throw new Error(`Workout ${workoutId} not found`);

  const finishedAt = Date.now();

  let totalVolume = 0;
  let totalSets = 0;
  let totalReps = 0;
  let prCount = 0;

  const abandonedExerciseIds: string[] = [];
  const uncheckedSetIds: string[] = [];

  for (const entry of detail.exercises) {
    // An exercise with nothing checked off was never performed. Tombstoning the
    // link takes its sets with it, so they stay out of `uncheckedSetIds`.
    if (!entry.sets.some((set) => set.isCompleted)) {
      abandonedExerciseIds.push(entry.workoutExercise.id);
      continue;
    }

    for (const set of entry.sets) {
      if (!set.isCompleted) uncheckedSetIds.push(set.id);
    }

    const ctx: AnalyticsContext = {
      trackingType: entry.exercise.trackingType,
      bodyweightKg: options.bodyweightKg,
      formula: options.formula,
    };

    const summary = summarizeSets(entry.sets as SetLike[], ctx);
    totalVolume += summary.volumeKg;
    totalSets += summary.workingSets;
    totalReps += summary.totalReps;

    const previous = await getPreviousBests(entry.exercise.id);
    const prs = detectPrs(entry.sets as SetLike[], ctx, previous);

    for (const pr of prs) {
      const setId = pr.setIndex === null ? null : (entry.sets[pr.setIndex]?.id ?? null);
      await recordPr({
        exerciseId: entry.exercise.id,
        kind: pr.kind,
        value: pr.value,
        reps: pr.setIndex === null ? null : (entry.sets[pr.setIndex]?.reps ?? null),
        setId,
        workoutId,
        achievedAt: finishedAt,
      });
      prCount += 1;
    }
  }

  const durationSeconds = Math.max(
    0,
    Math.round((finishedAt - detail.workout.startedAt.getTime()) / 1000),
  );

  // Spread rather than assigned, so a caller that said nothing about the name or
  // the note leaves those columns untouched instead of writing an undefined
  // Drizzle would have to decide what to do with.
  const name = options.name?.trim();
  const notes = options.notes === undefined ? undefined : options.notes?.trim() || null;

  const updates = {
    ...(name ? { name } : {}),
    ...(notes === undefined ? {} : { notes }),
    finishedAt: new Date(finishedAt),
    durationSeconds,
    totalVolumeKg: totalVolume,
    totalSets,
    totalReps,
    prCount,
    updatedAt: finishedAt,
    syncState: 'pending' as const,
  };

  await db.update(workouts).set(updates).where(eq(workouts.id, workoutId));

  if (detail.workout.routineId) {
    await db
      .update(routines)
      .set({ lastPerformedAt: new Date(finishedAt), updatedAt: finishedAt, syncState: 'pending' })
      .where(eq(routines.id, detail.workout.routineId));
  }

  const [saved] = await db.select().from(workouts).where(eq(workouts.id, workoutId)).limit(1);
  // Reading back nothing means the row went away underneath the finish. Saying
  // so beats returning a session the caller would then render.
  if (!saved) throw new Error(`Workout ${workoutId} vanished mid-finish`);

  await trackUpsertCoalesced('workouts', serializeWorkout(saved));

  // The session is durable from here, and every total above came from the
  // pre-deletion snapshot, so this cleanup is cosmetic: leftover unchecked rows
  // are ignored by every isCompleted-filtered query and are tombstoned by a
  // later finish or by `deleteWorkout`. It therefore must not reject. A throw
  // here would tell the caller the finish failed and have it say the session
  // stayed open, when the session is closed and the screen's live query has
  // already dropped it. There would be nothing left to retry.
  try {
    for (const setId of uncheckedSetIds) await deleteSet(setId);
    for (const exerciseId of abandonedExerciseIds) await removeExerciseFromWorkout(exerciseId);
  } catch {
    // Deliberately swallowed; see above.
  }

  return { workout: saved, prCount };
}

// ---------------------------------------------------------------------------
// Editing a finished session
// ---------------------------------------------------------------------------

/**
 * Overwrites the parts of a stored session that are the user's to state.
 *
 * All three are things the app only ever guessed at. The name defaults to the
 * time of day, the note is written from memory afterwards, and the duration is
 * wall-clock between two timestamps, which is exactly right until the session
 * is left open on a phone in a locker and comes back as four hours. A logged
 * duration nobody can correct drags every average and every weekly total with
 * it, for as long as the log exists.
 *
 * A blank name is ignored rather than stored, matching `finishWorkout`: every
 * screen titles the session by it, so an emptied box means the user cleared the
 * field, not that this workout is to be called nothing. A blank *note* is
 * stored as null, because having nothing to say is something someone can mean.
 */
export async function updateWorkoutFields(
  workoutId: string,
  fields: { name?: string; notes?: string | null; durationSeconds?: number },
): Promise<void> {
  const updates: Record<string, unknown> = {};

  const name = fields.name?.trim();
  if (name) updates.name = name;
  if (fields.notes !== undefined) updates.notes = fields.notes?.trim() || null;
  if (fields.durationSeconds !== undefined) {
    updates.durationSeconds = Math.max(0, Math.round(fields.durationSeconds));
  }

  if (Object.keys(updates).length === 0) return;

  await db
    .update(workouts)
    .set({ ...updates, ...touch() })
    .where(eq(workouts.id, workoutId));

  const [updated] = await db.select().from(workouts).where(eq(workouts.id, workoutId)).limit(1);
  // Coalesced: a name nudged twice in the rename box should leave one row to
  // push, not one per attempt.
  if (updated) await trackUpsertCoalesced('workouts', serializeWorkout(updated));
}

/** One record a recalculation decided the session is owed. */
interface AwardedPr {
  exerciseId: string;
  kind: PrKind;
  value: number;
  reps: number | null;
  setId: string | null;
}

export interface RecalculateResult {
  workout: Workout;
  prCount: number;
  /** Unchecked sets removed on the way out, the way `finishWorkout` removes them. */
  droppedSets: number;
}

/**
 * Re-derives everything a finished session stores about itself.
 *
 * `finishWorkout` computes the totals and the records once, at the moment the
 * session closes, and every screen afterwards reads the stored figures rather
 * than the sets. That is the right shape. The history list would otherwise
 * aggregate thousands of rows to draw a card, but it means a set corrected
 * three days later changes nothing anybody can see. This is the other half of
 * that bargain: the editor writes sets, and this puts the derived figures back
 * in agreement with them.
 *
 * The structure is deliberately `finishWorkout`'s, down to the order of the
 * writes: read everything, derive in memory, write the session row, and only
 * then delete. There is no usable transaction here (see `finishWorkout`), so
 * the order is the failure plan. Interrupted, the session is either untouched
 * or correctly recomputed with a few unchecked rows still attached, which every
 * query already ignores.
 *
 * Records are re-derived against the bests that were standing *before this
 * session started*, not against the bests standing now. A session's badge is a
 * statement about the day it happened; measuring it against records set since
 * would strip the trophy off every workout that has been beaten, which is most
 * of them. And they are only rewritten when the derived set actually differs
 * from the stored one, so opening the editor and nudging a note does not churn
 * six tombstones and six inserts through the sync log.
 *
 * `finishedAt` is not touched. It records when Save was pressed, which is a
 * fact about the app rather than about the training, and the duration is stored
 * separately for exactly that reason: see the column note in the schema.
 */
export async function recalculateWorkout(
  workoutId: string,
  options: {
    bodyweightKg?: number;
    formula?: AnalyticsContext['formula'];
    /** Replaces the stored duration. Omitted leaves whatever is there. */
    durationSeconds?: number;
  } = {},
): Promise<RecalculateResult> {
  const detail = await getWorkoutDetail(workoutId);
  if (!detail) throw new Error(`Workout ${workoutId} not found`);

  // An open session has no derived figures yet. `finishWorkout` is what
  // produces them, and running this against one would stamp totals on a workout
  // the logging screen is still writing to.
  const finishedAt = detail.workout.finishedAt;
  if (!finishedAt) throw new Error(`Workout ${workoutId} is still in progress`);

  const startedAt = detail.workout.startedAt.getTime();

  let totalVolume = 0;
  let totalSets = 0;
  let totalReps = 0;

  const abandonedExerciseIds: string[] = [];
  const uncheckedSetIds: string[] = [];
  const awarded: AwardedPr[] = [];

  for (const entry of detail.exercises) {
    // Same rule as finishing: an exercise with nothing checked off was never
    // performed. Tombstoning the link takes its sets with it, so they stay out
    // of `uncheckedSetIds`.
    if (!entry.sets.some((set) => set.isCompleted)) {
      abandonedExerciseIds.push(entry.workoutExercise.id);
      continue;
    }

    for (const set of entry.sets) {
      if (!set.isCompleted) uncheckedSetIds.push(set.id);
    }

    const ctx: AnalyticsContext = {
      trackingType: entry.exercise.trackingType,
      bodyweightKg: options.bodyweightKg,
      formula: options.formula,
    };

    const summary = summarizeSets(entry.sets as SetLike[], ctx);
    totalVolume += summary.volumeKg;
    totalSets += summary.workingSets;
    totalReps += summary.totalReps;

    const previous = await getPreviousBests(entry.exercise.id, startedAt);

    for (const pr of detectPrs(entry.sets as SetLike[], ctx, previous)) {
      const set = pr.setIndex === null ? null : (entry.sets[pr.setIndex] ?? null);
      awarded.push({
        exerciseId: entry.exercise.id,
        kind: pr.kind,
        value: pr.value,
        reps: set?.reps ?? null,
        setId: set?.id ?? null,
      });
    }
  }

  const stored = await db
    .select()
    .from(personalRecords)
    .where(and(eq(personalRecords.workoutId, workoutId), isNull(personalRecords.deletedAt)));

  if (!sameRecords(stored, awarded)) {
    const deletedAt = Date.now();

    // Tombstoned rather than edited in place. A record is identified by the set
    // it came from as much as by its value, and an edit that moved the heaviest
    // set to a different row would leave the old row pointing at a set that no
    // longer holds the number it claims.
    for (const record of stored) {
      await db
        .update(personalRecords)
        .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
        .where(eq(personalRecords.id, record.id));
      await trackDelete('personal_records', record.id, deletedAt);
    }

    for (const pr of awarded) {
      await recordPr({ ...pr, workoutId, achievedAt: finishedAt.getTime() });
    }
  }

  const updates = {
    ...(options.durationSeconds === undefined
      ? {}
      : { durationSeconds: Math.max(0, Math.round(options.durationSeconds)) }),
    totalVolumeKg: totalVolume,
    totalSets,
    totalReps,
    prCount: awarded.length,
    ...touch(),
  };

  await db.update(workouts).set(updates).where(eq(workouts.id, workoutId));

  const [saved] = await db.select().from(workouts).where(eq(workouts.id, workoutId)).limit(1);
  if (!saved) throw new Error(`Workout ${workoutId} vanished mid-recalculation`);

  await trackUpsertCoalesced('workouts', serializeWorkout(saved));

  // Cosmetic, and must not reject: every total above came from the
  // pre-deletion snapshot, and `summarizeSets` and `detectPrs` skip incomplete
  // sets themselves. See the same paragraph in `finishWorkout`.
  try {
    for (const setId of uncheckedSetIds) await deleteSet(setId);
    for (const exerciseId of abandonedExerciseIds) await removeExerciseFromWorkout(exerciseId);
  } catch {
    // Deliberately swallowed; see above.
  }

  return { workout: saved, prCount: awarded.length, droppedSets: uncheckedSetIds.length };
}

/**
 * Whether a recalculation reached the same records the session already holds.
 *
 * Compared as sorted keys rather than pairwise: `detectPrs` emits in a fixed
 * order but the stored rows come back in whatever order SQLite hands them over,
 * and a spurious mismatch costs a round of tombstones and inserts on the wire.
 */
function sameRecords(
  stored: readonly Pick<AwardedPr, 'exerciseId' | 'kind' | 'value' | 'setId'>[],
  awarded: readonly Pick<AwardedPr, 'exerciseId' | 'kind' | 'value' | 'setId'>[],
): boolean {
  if (stored.length !== awarded.length) return false;

  const key = (row: Pick<AwardedPr, 'exerciseId' | 'kind' | 'value' | 'setId'>) =>
    `${row.exerciseId}|${row.kind}|${row.value}|${row.setId ?? ''}`;

  const before = stored.map(key).sort();
  const after = awarded.map(key).sort();

  return before.every((entry, index) => entry === after[index]);
}

/**
 * Removes a workout and everything it produced: records, then sets, then the
 * session row.
 *
 * Records go first because they are the only child that outlives its parent in
 * practice. A personal record is a *ceiling*: `getPreviousBests` compares
 * every future attempt against it, so a mistyped 500 kg bench used to survive
 * the deletion of the session that created it and silently gate every real
 * bench PR from then on, with no screen anywhere that could reach it.
 *
 * The order is also the failure plan, since there is no usable transaction here
 * (see `finishWorkout`). Interrupted partway, the workout is still listed and
 * deleting it again picks up where this left off. The other order removes the
 * only row that can reach the records first, stranding them permanently.
 *
 * The children are read from `workoutExercises` directly rather than through
 * `getWorkoutDetail`, which skips links whose exercise row has gone. Those are
 * exactly the rows that must not be left behind.
 */
export async function deleteWorkout(workoutId: string): Promise<void> {
  const deletedAt = Date.now();

  const records = await db
    .select({ id: personalRecords.id })
    .from(personalRecords)
    .where(and(eq(personalRecords.workoutId, workoutId), isNull(personalRecords.deletedAt)));

  for (const record of records) {
    await db
      .update(personalRecords)
      .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
      .where(eq(personalRecords.id, record.id));
    await trackDelete('personal_records', record.id, deletedAt);
  }

  const links = await db
    .select({ id: workoutExercises.id })
    .from(workoutExercises)
    .where(and(eq(workoutExercises.workoutId, workoutId), isNull(workoutExercises.deletedAt)));

  for (const link of links) {
    await removeExerciseFromWorkout(link.id);
  }

  await db
    .update(workouts)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(workouts.id, workoutId));

  await trackDelete('workouts', workoutId, deletedAt);
}

/**
 * Abandons a session in progress.
 *
 * Identical work to `deleteWorkout` under a name the active screen can say out
 * loud. An unfinished session has no records yet, but routing through one
 * implementation means it cannot drift into leaving them behind if that ever
 * stops being true.
 */
export async function discardWorkout(workoutId: string): Promise<void> {
  await deleteWorkout(workoutId);
}

// ---------------------------------------------------------------------------
// Personal records
// ---------------------------------------------------------------------------

/**
 * The all-time ceilings a session is measured against.
 *
 * `before` bounds them to records already standing at a moment in the past,
 * which is what re-deriving an old session's records needs: unbounded, a squat
 * PR set last week would gate a PR the user actually set in March, and editing
 * a typo in the March session would silently strip the badge it has worn since.
 * `finishWorkout` leaves it out because for a session being closed *now* there
 * is no such thing as a later record.
 */
export async function getPreviousBests(exerciseId: string, before?: number) {
  const rows = await db
    .select()
    .from(personalRecords)
    .where(
      and(
        eq(personalRecords.exerciseId, exerciseId),
        isNull(personalRecords.deletedAt),
        ...(before === undefined ? [] : [lt(personalRecords.achievedAt, new Date(before))]),
      ),
    );

  const best = (kind: PrKind) =>
    rows.filter((row) => row.kind === kind).reduce((max, row) => Math.max(max, row.value), 0) ||
    undefined;

  return {
    heaviestKg: best('heaviest_weight'),
    bestOneRepMaxKg: best('best_1rm'),
    bestSetVolumeKg: best('best_set_volume'),
    bestSessionVolumeKg: best('best_session_volume'),
    mostReps: best('most_reps'),
    bestDurationSeconds: best('best_duration'),
    bestDistanceKm: best('best_distance'),
  };
}

async function recordPr(input: {
  exerciseId: string;
  kind: PrKind;
  value: number;
  reps: number | null;
  setId: string | null;
  workoutId: string;
  achievedAt: number;
}): Promise<void> {
  const now = Date.now();
  const row = {
    id: uuidv7(),
    exerciseId: input.exerciseId,
    kind: input.kind,
    value: input.value,
    reps: input.reps,
    setId: input.setId,
    workoutId: input.workoutId,
    achievedAt: new Date(input.achievedAt),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(personalRecords).values(row);
  await trackUpsert('personal_records', {
    ...row,
    achievedAt: input.achievedAt,
  });
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

// Drizzle hands back `Date` for timestamp_ms columns, but the sync payload must
// be JSON-safe and comparable as a number on the server.

function serializeWorkout<
  T extends { id: string; updatedAt: number; startedAt: Date; finishedAt: Date | null },
>(row: T) {
  return {
    ...row,
    startedAt: row.startedAt.getTime(),
    finishedAt: row.finishedAt?.getTime() ?? null,
  };
}

function serializeSet<T extends { id: string; updatedAt: number; completedAt: Date | null }>(
  row: T,
) {
  return {
    ...row,
    completedAt: row.completedAt?.getTime() ?? null,
  };
}
