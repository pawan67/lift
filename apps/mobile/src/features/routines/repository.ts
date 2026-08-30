/**
 * Routine (workout template) reads and writes.
 *
 * A routine stores *prescribed* work (exercises and target sets) which
 * `startWorkout` materialises into a live session. The two are deliberately
 * separate tables: editing a routine must never rewrite history.
 */

import {
  normalizeSupersets,
  uuidv7,
  type PositionedRow,
  type SetType,
  type SupersetAssignment,
} from '@lift/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { touch, trackDelete, trackUpsert, trackUpsertCoalesced } from '@/db/mutations';
import {
  exercises,
  routineExercises,
  routineFolders,
  routineSets,
  routines,
  type Exercise,
  type Routine,
  type RoutineExercise,
  type RoutineSet,
} from '@/db/schema';
import { getWorkoutDetail, type WorkoutDetail } from '@/features/workouts/repository';

export interface RoutineExerciseDetail {
  routineExercise: RoutineExercise;
  exercise: Exercise;
  sets: RoutineSet[];
}

export interface RoutineDetail {
  routine: Routine;
  exercises: RoutineExerciseDetail[];
}

export async function createRoutine(input: {
  name: string;
  folderId?: string | null;
  notes?: string | null;
}): Promise<Routine> {
  const now = Date.now();

  const existing = await db
    .select({ position: routines.position })
    .from(routines)
    .where(isNull(routines.deletedAt));

  const row = {
    id: uuidv7(),
    folderId: input.folderId ?? null,
    name: input.name.trim() || 'New Routine',
    notes: input.notes ?? null,
    position: existing.reduce((max, item) => Math.max(max, item.position), 0) + 1,
    lastPerformedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
    isNotesPinned: false,
  };

  await db.insert(routines).values(row);
  await trackUpsert('routines', { ...row, lastPerformedAt: null });

  return row;
}

export async function createRoutineFolder(name: string) {
  const now = Date.now();
  const existing = await db
    .select({ position: routineFolders.position })
    .from(routineFolders)
    .where(isNull(routineFolders.deletedAt));

  const row = {
    id: uuidv7(),
    name: name.trim() || 'New Folder',
    position: existing.reduce((max, item) => Math.max(max, item.position), 0) + 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(routineFolders).values(row);
  await trackUpsert('routine_folders', row);

  return row;
}

/**
 * Puts live routines into a folder. Already-filed ones move; nothing else
 * in the folder is touched. Empty `routineIds` is a no-op rather than a
 * clear: clearing is delete-folder's job.
 */
export async function assignRoutinesToFolder(folderId: string, routineIds: string[]): Promise<void> {
  const ids = [...new Set(routineIds)];
  if (ids.length === 0) return;

  const now = Date.now();
  await db
    .update(routines)
    .set({ folderId, updatedAt: now, syncState: 'pending' })
    .where(and(inArray(routines.id, ids), isNull(routines.deletedAt)));

  const rows = await db.select().from(routines).where(inArray(routines.id, ids));
  for (const row of rows) {
    await trackUpsertCoalesced('routines', {
      ...row,
      lastPerformedAt: row.lastPerformedAt?.getTime() ?? null,
    });
  }
}

export async function updateRoutine(
  routineId: string,
  patch: { name?: string; notes?: string | null; isNotesPinned?: boolean; folderId?: string | null },
): Promise<void> {
  if (Object.keys(patch).length === 0) return;

  await db
    .update(routines)
    .set({
      ...patch,
      ...touch(),
    })
    .where(eq(routines.id, routineId));

  const [updated] = await db.select().from(routines).where(eq(routines.id, routineId)).limit(1);
  if (updated) {
    await trackUpsertCoalesced('routines', {
      ...updated,
      lastPerformedAt: updated.lastPerformedAt?.getTime() ?? null,
    });
  }
}

export async function getRoutineDetail(routineId: string): Promise<RoutineDetail | undefined> {
  const [routine] = await db.select().from(routines).where(eq(routines.id, routineId)).limit(1);
  if (!routine) return undefined;

  const links = await db
    .select()
    .from(routineExercises)
    .where(and(eq(routineExercises.routineId, routineId), isNull(routineExercises.deletedAt)))
    .orderBy(asc(routineExercises.position));

  if (links.length === 0) return { routine, exercises: [] };

  const exerciseRows = await db
    .select()
    .from(exercises)
    .where(inArray(exercises.id, [...new Set(links.map((link) => link.exerciseId))]));

  const exerciseById = new Map(exerciseRows.map((row) => [row.id, row]));

  const setRows = await db
    .select()
    .from(routineSets)
    .where(
      and(
        inArray(routineSets.routineExerciseId, links.map((link) => link.id)),
        isNull(routineSets.deletedAt),
      ),
    )
    .orderBy(asc(routineSets.position));

  const setsByParent = new Map<string, RoutineSet[]>();
  for (const set of setRows) {
    const bucket = setsByParent.get(set.routineExerciseId);
    if (bucket) bucket.push(set);
    else setsByParent.set(set.routineExerciseId, [set]);
  }

  return {
    routine,
    exercises: links.flatMap((link) => {
      const exercise = exerciseById.get(link.exerciseId);
      if (!exercise) return [];
      return [{ routineExercise: link, exercise, sets: setsByParent.get(link.id) ?? [] }];
    }),
  };
}

/**
 * Applies the writes a routines-list reorder produced.
 *
 * Same contract as `applyRoutineExerciseOrder`: the caller has already run
 * `reorder()`, and this writes the rows it named. The Workout tab's list is
 * ordered by `routines.position`, including inside a folder, so this is what
 * a drag on that list has to land in storage.
 */
export async function applyRoutineOrder(updates: PositionedRow[]): Promise<void> {
  if (updates.length === 0) return;

  for (const { id, position } of updates) {
    await db
      .update(routines)
      .set({ position, ...touch() })
      .where(eq(routines.id, id));

    const [updated] = await db.select().from(routines).where(eq(routines.id, id)).limit(1);
    if (updated) {
      await trackUpsertCoalesced('routines', {
        ...updated,
        lastPerformedAt: updated.lastPerformedAt?.getTime() ?? null,
      });
    }
  }
}

/**
 * Same contract as `applyRoutineOrder`, for the folder list the Workout tab
 * draws above unfiled routines.
 */
export async function applyFolderOrder(updates: PositionedRow[]): Promise<void> {
  if (updates.length === 0) return;

  for (const { id, position } of updates) {
    await db
      .update(routineFolders)
      .set({ position, ...touch() })
      .where(eq(routineFolders.id, id));

    const [updated] = await db.select().from(routineFolders).where(eq(routineFolders.id, id)).limit(1);
    if (updated) await trackUpsertCoalesced('routine_folders', updated);
  }
}

/**
 * Applies the writes a reorder produced.
 *
 * Takes the rows rather than a from/to pair because the caller has already done
 * the arithmetic: `reorder()` in `@lift/shared` decides whether a move is one
 * midpoint or a full renumber, and this only has to write whatever it handed
 * back. Usually that is a single row.
 *
 * Sequential rather than batched: each write also emits an oplog entry, and the
 * sync layer's coalescing is per row. A renumber of ten exercises is ten
 * statements, which happens roughly never: see `MIN_GAP` in `ordering.ts`.
 */
export async function applyRoutineExerciseOrder(updates: PositionedRow[]): Promise<void> {
  if (updates.length === 0) return;

  for (const { id, position } of updates) {
    await db
      .update(routineExercises)
      .set({ position, ...touch() })
      .where(eq(routineExercises.id, id));

    const [updated] = await db
      .select()
      .from(routineExercises)
      .where(eq(routineExercises.id, id))
      .limit(1);

    if (updated) await trackUpsertCoalesced('routine_exercises', updated);
  }
}

/**
 * Applies the writes a superset edit produced.
 *
 * The sibling of `applyRoutineExerciseOrder`, and the same contract: the
 * arithmetic is `supersets.ts`' in `@lift/shared`, and this writes the rows it
 * named. Prescribing a superset in a routine is what makes the session start
 * with one, because `copyRoutineIntoWorkout` carries `supersetGroup` across
 * with the notes and the rest.
 *
 * **The editor calls this after a reorder as well.** A drag that lands an
 * exercise between two halves of a superset has dismantled it, and
 * `normalizeSupersets` is the only thing that notices.
 */
export async function applyRoutineSupersetGroups(updates: SupersetAssignment[]): Promise<void> {
  if (updates.length === 0) return;

  for (const { id, supersetGroup } of updates) {
    await db
      .update(routineExercises)
      .set({ supersetGroup, ...touch() })
      .where(eq(routineExercises.id, id));

    const [updated] = await db
      .select()
      .from(routineExercises)
      .where(eq(routineExercises.id, id))
      .limit(1);

    if (updated) await trackUpsertCoalesced('routine_exercises', updated);
  }
}

export async function addExerciseToRoutine(
  routineId: string,
  exerciseId: string,
): Promise<RoutineExercise> {
  const row = await insertRoutineExercise(routineId, exerciseId);

  // A routine exercise with no sets is meaningless, so seed one.
  await addRoutineSet(row.id);

  return row;
}

/**
 * The insert on its own, carrying whatever prescription came with the exercise.
 *
 * Split out because its two callers disagree about exactly one thing. Adding an
 * exercise by hand wants an empty set to type into; copying a finished session
 * into a routine already knows every set it is about to write, and would have to
 * delete the seeded one first. A `seedSet: false` option would have expressed
 * the same split while leaving both callers reading a name that promises a set
 * they may not get.
 */
async function insertRoutineExercise(
  routineId: string,
  exerciseId: string,
  options: {
    position?: number;
    notes?: string | null;
    restSeconds?: number | null;
    supersetGroup?: number | null;
  } = {},
): Promise<RoutineExercise> {
  const now = Date.now();

  const row = {
    id: uuidv7(),
    routineId,
    exerciseId,
    position: options.position ?? (await nextExercisePosition(routineId)),
    notes: options.notes ?? null,
    restSeconds: options.restSeconds ?? null,
    supersetGroup: options.supersetGroup ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
    isNotesPinned: false,
  };

  await db.insert(routineExercises).values(row);
  await trackUpsert('routine_exercises', row);

  return row;
}

export async function updateRoutineExercise(
  id: string,
  patch: { notes?: string | null; isNotesPinned?: boolean }
) {
  if (Object.keys(patch).length === 0) return;
  await db
    .update(routineExercises)
    .set({ ...patch, ...touch() })
    .where(eq(routineExercises.id, id));

  const [updated] = await db
    .select()
    .from(routineExercises)
    .where(eq(routineExercises.id, id))
    .limit(1);
    
  if (updated) {
    await trackUpsert('routine_exercises', updated);
  }
}

async function nextExercisePosition(routineId: string): Promise<number> {
  const siblings = await db
    .select({ position: routineExercises.position })
    .from(routineExercises)
    .where(and(eq(routineExercises.routineId, routineId), isNull(routineExercises.deletedAt)));

  return siblings.reduce((max, item) => Math.max(max, item.position), 0) + 1;
}

/**
 * Adds a prescribed set.
 *
 * Every target the table carries is writable here. Three of them used to be
 * hardcoded null, which made the columns decorative: `copyRoutineIntoWorkout`
 * has always seeded a session from all five, so a routine could store a target
 * time or distance in principle and had no way to be given one. That is what
 * made "Plank 3 x 60s" and "Row 2000 m" unwritable, and it started every
 * duration or distance exercise in a routine as a blank weight-and-reps row.
 *
 * `position` is optional for the same reason `addExerciseToWorkout`'s is: an
 * interactive add appends and wants the sibling query, while a copy already
 * knows the order it is writing and would otherwise pay for a select per set to
 * be told what it just decided.
 */
export async function addRoutineSet(
  routineExerciseId: string,
  input: {
    position?: number;
    setType?: SetType;
    targetReps?: number | null;
    targetWeightKg?: number | null;
    targetDurationSeconds?: number | null;
    targetDistanceKm?: number | null;
    targetRpe?: number | null;
  } = {},
): Promise<RoutineSet> {
  const now = Date.now();

  const row = {
    id: uuidv7(),
    routineExerciseId,
    position: input.position ?? (await nextSetPosition(routineExerciseId)),
    setType: input.setType ?? ('normal' as const),
    targetReps: input.targetReps ?? null,
    targetWeightKg: input.targetWeightKg ?? null,
    targetDurationSeconds: input.targetDurationSeconds ?? null,
    targetDistanceKm: input.targetDistanceKm ?? null,
    targetRpe: input.targetRpe ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncState: 'pending' as const,
  };

  await db.insert(routineSets).values(row);
  await trackUpsert('routine_sets', row);

  return row;
}

async function nextSetPosition(routineExerciseId: string): Promise<number> {
  const siblings = await db
    .select({ position: routineSets.position })
    .from(routineSets)
    .where(
      and(eq(routineSets.routineExerciseId, routineExerciseId), isNull(routineSets.deletedAt)),
    );

  return siblings.reduce((max, item) => Math.max(max, item.position), 0) + 1;
}

export async function updateRoutineSet(
  setId: string,
  patch: Partial<
    Pick<
      RoutineSet,
      | 'setType'
      | 'targetReps'
      | 'targetWeightKg'
      | 'targetDurationSeconds'
      | 'targetDistanceKm'
      | 'targetRpe'
    >
  >,
): Promise<void> {
  await db
    .update(routineSets)
    .set({ ...patch, ...touch() })
    .where(eq(routineSets.id, setId));

  const [updated] = await db.select().from(routineSets).where(eq(routineSets.id, setId)).limit(1);
  if (updated) await trackUpsertCoalesced('routine_sets', updated);
}

export async function deleteRoutineSet(setId: string): Promise<void> {
  const deletedAt = Date.now();
  await db
    .update(routineSets)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(routineSets.id, setId));

  await trackDelete('routine_sets', setId, deletedAt);
}

export async function removeExerciseFromRoutine(routineExerciseId: string): Promise<void> {
  const deletedAt = Date.now();

  // Read before the tombstone, so the superset sweep at the end knows which
  // routine to look at.
  const [link] = await db
    .select({ routineId: routineExercises.routineId })
    .from(routineExercises)
    .where(eq(routineExercises.id, routineExerciseId))
    .limit(1);

  await db
    .update(routineExercises)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(routineExercises.id, routineExerciseId));

  await trackDelete('routine_exercises', routineExerciseId, deletedAt);

  // Soft deletes don't cascade, so tombstone the child sets by hand.
  const children = await db
    .select({ id: routineSets.id })
    .from(routineSets)
    .where(
      and(eq(routineSets.routineExerciseId, routineExerciseId), isNull(routineSets.deletedAt)),
    );

  for (const child of children) {
    await db
      .update(routineSets)
      .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
      .where(eq(routineSets.id, child.id));
    await trackDelete('routine_sets', child.id, deletedAt);
  }

  /*
   * Taking one half of a pair out of the routine leaves the other half holding
   * a group id with nothing to be paired with, which is not a superset.
   *
   * This also runs once per exercise while `deleteRoutine` empties a routine it
   * is about to tombstone, which is a write or two the wire did not need. The
   * alternative is a second removal path that skips the sweep, and a path that
   * exists only to be faster in the one case where nothing is left to be
   * correct about is how the invariant gets lost.
   */
  if (link) {
    const links = await db
      .select({ id: routineExercises.id, supersetGroup: routineExercises.supersetGroup })
      .from(routineExercises)
      .where(and(eq(routineExercises.routineId, link.routineId), isNull(routineExercises.deletedAt)))
      .orderBy(asc(routineExercises.position));

    await applyRoutineSupersetGroups(normalizeSupersets(links));
  }
}

export async function deleteRoutine(routineId: string): Promise<void> {
  const detail = await getRoutineDetail(routineId);
  if (!detail) return;

  for (const entry of detail.exercises) {
    await removeExerciseFromRoutine(entry.routineExercise.id);
  }

  const deletedAt = Date.now();
  await db
    .update(routines)
    .set({ deletedAt, updatedAt: deletedAt, syncState: 'pending' })
    .where(eq(routines.id, routineId));

  await trackDelete('routines', routineId, deletedAt);
}

// ---------------------------------------------------------------------------
// Sessions and routines
// ---------------------------------------------------------------------------

/** One exercise of a session, restated as the prescription it would make. */
interface PrescribedExercise {
  exerciseId: string;
  position: number;
  notes: string | null;
  restSeconds: number | null;
  supersetGroup: number | null;
  sets: {
    setType: SetType;
    targetReps: number | null;
    targetWeightKg: number | null;
    targetDurationSeconds: number | null;
    targetDistanceKm: number | null;
    targetRpe: number | null;
  }[];
}

/**
 * What a session prescribes, read the way `finishWorkout` reads it.
 *
 * Completed sets only, and an exercise with nothing completed dropped entirely:
 * the same two rules the finish applies when it closes a session out. Both
 * writers below are reached from the save screen, which sits *in front of* that
 * cleanup, so a third rule here would make "save as routine" and "save, then
 * save as routine" produce two different routines from one session.
 */
function prescriptionFromSession(detail: WorkoutDetail): PrescribedExercise[] {
  return detail.exercises.flatMap((entry) => {
    const performed = entry.sets.filter((set) => set.isCompleted);
    if (performed.length === 0) return [];

    return [
      {
        exerciseId: entry.exercise.id,
        position: entry.workoutExercise.position,
        notes: entry.workoutExercise.notes,
        restSeconds: entry.workoutExercise.restSeconds,
        supersetGroup: entry.workoutExercise.supersetGroup,
        sets: performed.map((set) => ({
          setType: set.setType,
          targetReps: set.reps,
          targetWeightKg: set.weightKg,
          targetDurationSeconds: set.durationSeconds,
          targetDistanceKm: set.distanceKm,
          targetRpe: set.rpe,
        })),
      },
    ];
  });
}

/** Writes a prescription into a routine that currently holds no exercises. */
async function fillRoutine(routineId: string, prescription: PrescribedExercise[]): Promise<void> {
  const written: SupersetAssignment[] = [];

  for (const planned of prescription) {
    const link = await insertRoutineExercise(routineId, planned.exerciseId, {
      position: planned.position,
      notes: planned.notes,
      restSeconds: planned.restSeconds,
      supersetGroup: planned.supersetGroup,
    });

    written.push({ id: link.id, supersetGroup: link.supersetGroup });

    // Positions are handed down rather than queried per set: the order is the
    // order they were performed in, which this loop already holds.
    let position = 1;
    for (const set of planned.sets) {
      await addRoutineSet(link.id, { position, ...set });
      position += 1;
    }
  }

  /*
   * Grouping survives the round trip, but only where it is still a group.
   *
   * A superset abandoned halfway through (the first exercise performed, the
   * second never started) arrives here as one exercise still carrying its group
   * id, which is a superset of one. `normalizeSupersets` is the same sweep the
   * editor runs after a drag, and it is the only thing that notices. Usually it
   * returns nothing and this writes no rows.
   */
  await applyRoutineSupersetGroups(normalizeSupersets(written));
}

/**
 * Turns a session into a new routine.
 *
 * The half of the Hevy loop that runs forwards: a workout built by hand in the
 * gym becomes the thing you start from next week. It writes a *new* routine and
 * never touches an existing one, so it is safe to offer from the save screen
 * beside the session that is still open.
 */
export async function saveSessionAsRoutine(workoutId: string, name: string): Promise<Routine> {
  const detail = await getWorkoutDetail(workoutId);
  if (!detail) throw new Error(`Workout ${workoutId} not found`);

  const prescription = prescriptionFromSession(detail);
  if (prescription.length === 0) throw new Error('This session has no completed sets');

  // The session's own name is the fallback, rather than `createRoutine`'s "New
  // Routine": someone who cleared the field meant "call it what the session is
  // called", and a routine list of identical "New Routine" rows is what the
  // generic default produces here.
  const routine = await createRoutine({ name: name.trim() || detail.workout.name });
  await fillRoutine(routine.id, prescription);

  return routine;
}

/**
 * Builds a routine from a prescription resolved elsewhere.
 *
 * The other half of `saveSessionAsRoutine`, for a prescription that did not
 * come from a session on this device. `features/share` uses it to land a
 * routine a friend sent, having already turned that file's exercise *names*
 * into library ids.
 *
 * Exported rather than inlined there because `fillRoutine` is where the two
 * things easy to get wrong live: sets are positioned from the order they were
 * written in rather than queried per row, and a superset group left with one
 * member is swept away afterwards. A second writer would have both bugs.
 */
export async function createRoutineFromPrescription(input: {
  name: string;
  notes: string | null;
  exercises: PrescribedExercise[];
}): Promise<Routine> {
  const routine = await createRoutine({ name: input.name, notes: input.notes });
  await fillRoutine(routine.id, input.exercises);

  return routine;
}

export type { PrescribedExercise };

/** A sentence about one difference between a session and its routine. */
export interface RoutineChange {
  /** The exercise it is about, or null when it is about the routine as a whole. */
  exerciseName: string | null;
  /** Written out ready to render: "Bench Press gained a set." */
  summary: string;
}

export interface RoutineDiff {
  routineId: string;
  routineName: string;
  /** Never empty: `diffSessionAgainstRoutine` returns null instead. */
  changes: RoutineChange[];
}

/** An exercise slot on one side of the comparison. */
interface DiffSlot {
  key: string;
  name: string;
  setCount: number;
}

/*
 * Why the key carries an occurrence number.
 *
 * Both the routine editor and the logging screen allow the same lift twice, and
 * a leg day that squats at the start and again at the end is a real programme
 * rather than a mistake. Keyed on the exercise id alone, the second occurrence
 * reads as removed and the first as having gained every set of both, so the card
 * would announce two changes to a session that matched its routine exactly.
 */
function slotsOf(rows: { exerciseId: string; name: string; setCount: number }[]): DiffSlot[] {
  const seen = new Map<string, number>();

  return rows.map((row) => {
    const occurrence = (seen.get(row.exerciseId) ?? 0) + 1;
    seen.set(row.exerciseId, occurrence);
    return { key: `${row.exerciseId}#${occurrence}`, name: row.name, setCount: row.setCount };
  });
}

/**
 * How a session differs from the routine it was started from, or null.
 *
 * Null covers every case with nothing to ask about: a session that came from no
 * routine, one whose routine has since been deleted, and one that matched its
 * routine. A caller can therefore render the answer without restating any of
 * those tests.
 *
 * **Structure, not numbers.** The tempting version compares every target as
 * well, and it would fire on every session anybody has ever had, because nobody
 * hits a prescription exactly. A card that appears every single time is a card
 * dismissed unread, which costs the one session where it had something to say.
 * So the question asked here is whether this was a different *shape* of workout,
 * and only which exercises were performed, how many sets of each, and in what
 * order count as an answer.
 *
 * `applySessionToRoutine` still carries the numbers across once the user says
 * yes. "Update the routine" means "make it what I just did", and a routine left
 * prescribing last month's weights under a set count it had just accepted would
 * be the worse half of both answers.
 */
export async function diffSessionAgainstRoutine(workoutId: string): Promise<RoutineDiff | null> {
  const detail = await getWorkoutDetail(workoutId);
  if (!detail?.workout.routineId) return null;

  const source = await getRoutineDetail(detail.workout.routineId);
  if (!source || source.routine.deletedAt !== null) return null;

  const before = slotsOf(
    source.exercises.map((entry) => ({
      exerciseId: entry.exercise.id,
      name: entry.exercise.name,
      setCount: entry.sets.length,
    })),
  );

  const after = slotsOf(
    prescriptionFromSession(detail).map((planned) => ({
      exerciseId: planned.exerciseId,
      // `prescriptionFromSession` deals in ids, and the name is only ever needed
      // for a sentence, so it is looked up here rather than carried through a
      // structure the writers have no use for it in.
      name:
        detail.exercises.find((entry) => entry.exercise.id === planned.exerciseId)?.exercise.name ??
        'This exercise',
      setCount: planned.sets.length,
    })),
  );

  const beforeByKey = new Map(before.map((slot) => [slot.key, slot]));
  const afterKeys = new Set(after.map((slot) => slot.key));

  const changes: RoutineChange[] = [];

  for (const slot of after) {
    const was = beforeByKey.get(slot.key);

    if (!was) {
      changes.push({ exerciseName: slot.name, summary: `Added ${slot.name}.` });
      continue;
    }

    const delta = slot.setCount - was.setCount;
    if (delta === 0) continue;

    const magnitude = Math.abs(delta) === 1 ? 'a set' : `${Math.abs(delta)} sets`;
    changes.push({
      exerciseName: slot.name,
      summary: `${slot.name} ${delta > 0 ? 'gained' : 'lost'} ${magnitude}.`,
    });
  }

  for (const slot of before) {
    if (!afterKeys.has(slot.key)) {
      changes.push({ exerciseName: slot.name, summary: `Dropped ${slot.name}.` });
    }
  }

  /*
   * Order is only worth mentioning on its own.
   *
   * Adding or dropping an exercise moves everything after it, so reported
   * alongside those it is noise about a change the user already made on purpose.
   * With the membership identical it is the only thing that happened, and it is
   * the difference between a routine you can follow top to bottom and one you
   * cannot.
   */
  if (changes.length === 0 && before.some((slot, index) => slot.key !== after[index]?.key)) {
    changes.push({
      exerciseName: null,
      summary: 'The exercises are in a different order.',
    });
  }

  if (changes.length === 0) return null;

  return { routineId: source.routine.id, routineName: source.routine.name, changes };
}

/**
 * Rewrites a routine to match the session that came from it.
 *
 * Replaced rather than merged, and the routine's own row is what survives: its
 * id, its name, its folder and its notes are untouched, so every workout that
 * ever pointed at it still does and the home widget keeps its entry. Everything
 * below that is the session's.
 *
 * A merge was the alternative and it has no defensible rule. Faced with a
 * routine prescribing four sets and a session holding three, "keep the larger"
 * ignores a deliberate cut and "keep the session" is what a replace already
 * does, and the two disagree per exercise on the same screen. Replacing states
 * one thing the user can predict: the routine now says what you just did.
 *
 * Does nothing, rather than throwing, when the session came from no routine or
 * from one since deleted. This is called from a card the user tapped some
 * seconds ago, and either condition means the question it asked has stopped
 * being a question.
 */
export async function applySessionToRoutine(workoutId: string): Promise<void> {
  const detail = await getWorkoutDetail(workoutId);
  const routineId = detail?.workout.routineId;
  if (!detail || !routineId) return;

  const source = await getRoutineDetail(routineId);
  if (!source || source.routine.deletedAt !== null) return;

  const prescription = prescriptionFromSession(detail);
  // An empty session would otherwise empty the routine, which is a deletion
  // wearing the label of an update.
  if (prescription.length === 0) return;

  for (const entry of source.exercises) {
    await removeExerciseFromRoutine(entry.routineExercise.id);
  }

  await fillRoutine(routineId, prescription);
}

export async function updateRoutineFolder(id: string, name: string) {
  const now = Date.now();
  await db
    .update(routineFolders)
    .set({ name: name.trim(), updatedAt: now, syncState: 'pending' })
    .where(eq(routineFolders.id, id));

  const [row] = await db.select().from(routineFolders).where(eq(routineFolders.id, id));
  if (row) await trackUpsert('routine_folders', row);
}

export async function deleteRoutineFolder(id: string) {
  const now = Date.now();
  
  // Find routines in this folder
  const routinesInFolder = await db
    .select({ id: routines.id })
    .from(routines)
    .where(eq(routines.folderId, id));
    
  // Soft delete the folder
  await db
    .update(routineFolders)
    .set({ deletedAt: now, updatedAt: now, syncState: 'pending' })
    .where(eq(routineFolders.id, id));
    
  // Unassign all routines from this folder
  await db
    .update(routines)
    .set({ folderId: null, updatedAt: now, syncState: 'pending' })
    .where(eq(routines.folderId, id));

  await trackDelete('routine_folders', id, now);
  
  // Track upsert for modified routines
  for (const r of routinesInFolder) {
    const [row] = await db.select().from(routines).where(eq(routines.id, r.id));
    if (row) await trackUpsert('routines', row);
  }
}
