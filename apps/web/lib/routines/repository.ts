/**
 * Routine writes, ported from the phone's `features/routines/repository.ts` so
 * a routine edited here reads back on the phone exactly as if it had been
 * edited there.
 *
 * Every function builds one batch of ops and hands it to `write()`, which
 * applies it locally and queues it for sync in a single IndexedDB
 * transaction. Within a batch, parents always come before children: the
 * server applies a push in order and refuses a set whose exercise it has not
 * seen yet.
 *
 * Reads go straight to the store's tables rather than the derived model,
 * because a write must see the rows as they are now, not as of the last render.
 */

import {
  joinSuperset,
  leaveSuperset,
  nextPosition,
  normalizeSupersets,
  reorder,
  type PositionedRow,
  type SetType,
  type SupersetAssignment,
} from "@lift/shared";

import { remove, upsert, uuidv7, write, type WriteOp } from "@/lib/data/mutate";
import { useData } from "@/lib/data/store";
import type { RoutineExerciseRow, RoutineFolderRow, RoutineRow, RoutineSetRow } from "@/lib/data/types";

/** Sets a newly added exercise starts with. */
export const DEFAULT_SET_COUNT = 3;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function tables() {
  return useData.getState().tables;
}

function liveRoutines(): RoutineRow[] {
  return [...tables().routines.values()].filter((row) => row.deletedAt === null);
}

function liveFolders(): RoutineFolderRow[] {
  return [...tables().routine_folders.values()].filter((row) => row.deletedAt === null);
}

/** A routine's exercises, in order. */
export function routineBlocks(routineId: string): RoutineExerciseRow[] {
  return [...tables().routine_exercises.values()]
    .filter((row) => row.deletedAt === null && row.routineId === routineId)
    .sort((a, b) => a.position - b.position);
}

/** An exercise block's sets, in order. */
export function blockSets(routineExerciseId: string): RoutineSetRow[] {
  return [...tables().routine_sets.values()]
    .filter((row) => row.deletedAt === null && row.routineExerciseId === routineExerciseId)
    .sort((a, b) => a.position - b.position);
}

function supersetOps(assignments: readonly SupersetAssignment[]): WriteOp[] {
  return assignments.map(({ id, supersetGroup }) => upsert("routine_exercises", { id, supersetGroup }));
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

export async function createRoutine(input: { name: string; folderId?: string | null; notes?: string | null }): Promise<string> {
  const id = uuidv7();
  await write([
    upsert("routines", {
      id,
      folderId: input.folderId ?? null,
      name: input.name.trim() || "New Routine",
      notes: input.notes?.trim() || null,
      position: nextPosition(liveRoutines()),
      lastPerformedAt: null,
    }),
  ]);
  return id;
}

export async function updateRoutine(
  id: string,
  patch: { name?: string; notes?: string | null; folderId?: string | null },
): Promise<void> {
  const clean: { id: string; name?: string; notes?: string | null; folderId?: string | null } = { id };
  if (patch.name !== undefined) clean.name = patch.name.trim() || "New Routine";
  if (patch.notes !== undefined) clean.notes = patch.notes?.trim() || null;
  if (patch.folderId !== undefined) clean.folderId = patch.folderId;
  await write([upsert("routines", clean)]);
}

/** Copies a routine and everything in it, every row under a new id. Lands right after the original. */
export async function duplicateRoutine(routineId: string): Promise<string | null> {
  const source = tables().routines.get(routineId);
  if (!source || source.deletedAt !== null) return null;

  const siblings = liveRoutines().sort((a, b) => a.position - b.position);
  const index = siblings.findIndex((row) => row.id === routineId);
  const after = siblings[index + 1]?.position ?? null;
  const position = after === null ? source.position + 1 : source.position + (after - source.position) / 2;

  const id = uuidv7();
  const ops: WriteOp[] = [
    upsert("routines", {
      id,
      folderId: source.folderId,
      name: `${source.name} (copy)`,
      notes: source.notes,
      position,
      lastPerformedAt: null,
    }),
  ];

  for (const block of routineBlocks(routineId)) {
    const blockId = uuidv7();
    ops.push(
      upsert("routine_exercises", {
        id: blockId,
        routineId: id,
        exerciseId: block.exerciseId,
        position: block.position,
        notes: block.notes,
        restSeconds: block.restSeconds,
        supersetGroup: block.supersetGroup,
      }),
    );
    for (const set of blockSets(block.id)) {
      ops.push(
        upsert("routine_sets", {
          id: uuidv7(),
          routineExerciseId: blockId,
          position: set.position,
          setType: set.setType,
          targetReps: set.targetReps,
          targetWeightKg: set.targetWeightKg,
          targetDurationSeconds: set.targetDurationSeconds,
          targetDistanceKm: set.targetDistanceKm,
          targetRpe: set.targetRpe,
        }),
      );
    }
  }

  await write(ops);
  return id;
}

/** Tombstones the routine and every exercise and set under it, children first. */
export async function deleteRoutine(routineId: string): Promise<void> {
  const ops: WriteOp[] = [];
  for (const block of routineBlocks(routineId)) {
    for (const set of blockSets(block.id)) ops.push(remove("routine_sets", set.id));
    ops.push(remove("routine_exercises", block.id));
  }
  ops.push(remove("routines", routineId));
  await write(ops);
}

/** Writes new positions from `reorder()` / `renumber()`. */
export async function applyRoutineOrder(updates: readonly PositionedRow[]): Promise<void> {
  await write(updates.map(({ id, position }) => upsert("routines", { id, position })));
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function createFolder(name: string): Promise<string> {
  const id = uuidv7();
  await write([upsert("routine_folders", { id, name: name.trim() || "New Folder", position: nextPosition(liveFolders()) })]);
  return id;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await write([upsert("routine_folders", { id, name: trimmed })]);
}

/** Deletes the folder and keeps its routines, which move to "no folder", as on the phone. */
export async function deleteFolder(id: string): Promise<void> {
  const ops: WriteOp[] = liveRoutines()
    .filter((row) => row.folderId === id)
    .map((row) => upsert("routines", { id: row.id, folderId: null }));
  ops.push(remove("routine_folders", id));
  await write(ops);
}

export async function applyFolderOrder(updates: readonly PositionedRow[]): Promise<void> {
  await write(updates.map(({ id, position }) => upsert("routine_folders", { id, position })));
}

export async function moveRoutineToFolder(routineId: string, folderId: string | null): Promise<void> {
  await write([upsert("routines", { id: routineId, folderId })]);
}

// ---------------------------------------------------------------------------
// Exercises in a routine
// ---------------------------------------------------------------------------

/** Appends exercises, each with `DEFAULT_SET_COUNT` empty normal sets. */
export async function addExercisesToRoutine(routineId: string, exerciseIds: readonly string[]): Promise<string[]> {
  let position = nextPosition(routineBlocks(routineId));
  const ops: WriteOp[] = [];
  const created: string[] = [];

  for (const exerciseId of exerciseIds) {
    const blockId = uuidv7();
    created.push(blockId);
    ops.push(
      upsert("routine_exercises", {
        id: blockId,
        routineId,
        exerciseId,
        position,
        notes: null,
        restSeconds: null,
        supersetGroup: null,
      }),
    );
    for (let index = 1; index <= DEFAULT_SET_COUNT; index += 1) {
      ops.push(upsert("routine_sets", { ...emptySet(blockId, index) }));
    }
    position += 1;
  }

  await write(ops);
  return created;
}

function emptySet(routineExerciseId: string, position: number): Omit<RoutineSetRow, "createdAt" | "updatedAt" | "deletedAt"> {
  return {
    id: uuidv7(),
    routineExerciseId,
    position,
    setType: "normal",
    targetReps: null,
    targetWeightKg: null,
    targetDurationSeconds: null,
    targetDistanceKm: null,
    targetRpe: null,
  };
}

export async function updateRoutineExercise(
  id: string,
  patch: { notes?: string | null; restSeconds?: number | null },
): Promise<void> {
  const clean: { id: string; notes?: string | null; restSeconds?: number | null } = { id };
  if (patch.notes !== undefined) clean.notes = patch.notes?.trim() || null;
  if (patch.restSeconds !== undefined) clean.restSeconds = patch.restSeconds;
  await write([upsert("routine_exercises", clean)]);
}

/**
 * Removes an exercise and its sets, then repairs supersets: a pair that loses
 * a member is no longer a superset, and two runs that become adjacent must not
 * merge under one group id.
 */
export async function removeExerciseFromRoutine(routineExerciseId: string): Promise<void> {
  const block = tables().routine_exercises.get(routineExerciseId);
  if (!block) return;

  const ops: WriteOp[] = blockSets(routineExerciseId).map((set) => remove("routine_sets", set.id));
  ops.push(remove("routine_exercises", routineExerciseId));

  const remaining = routineBlocks(block.routineId).filter((row) => row.id !== routineExerciseId);
  ops.push(...supersetOps(normalizeSupersets(remaining)));

  await write(ops);
}

/** Moves the exercise at `from` to `to`, then repairs supersets the move split or joined. */
export async function moveRoutineExercise(routineId: string, from: number, to: number): Promise<void> {
  const blocks = routineBlocks(routineId);
  const updates = reorder(blocks, from, to);
  if (updates.length === 0) return;

  const positions = new Map(updates.map((update) => [update.id, update.position]));
  const after = blocks
    .map((row) => ({ ...row, position: positions.get(row.id) ?? row.position }))
    .sort((a, b) => a.position - b.position);

  // A member moved away from its partners leaves single-member spans behind,
  // and normalising clears those, on both sides of the move.
  const assignments = new Map(normalizeSupersets(after).map((entry) => [entry.id, entry.supersetGroup]));

  const ops: WriteOp[] = after
    .filter((row) => positions.has(row.id) || assignments.has(row.id))
    .map((row) =>
      upsert("routine_exercises", {
        id: row.id,
        position: row.position,
        ...(assignments.has(row.id) ? { supersetGroup: assignments.get(row.id) ?? null } : {}),
      }),
    );

  await write(ops);
}

/** Links an exercise with the one below it into a superset (or extends an existing one). */
export async function linkWithNext(routineId: string, routineExerciseId: string): Promise<void> {
  await write(supersetOps(joinSuperset(routineBlocks(routineId), routineExerciseId, "down")));
}

export async function unlinkFromSuperset(routineId: string, routineExerciseId: string): Promise<void> {
  await write(supersetOps(leaveSuperset(routineBlocks(routineId), routineExerciseId)));
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

export type SetTargets = Pick<
  RoutineSetRow,
  "setType" | "targetReps" | "targetWeightKg" | "targetDurationSeconds" | "targetDistanceKm" | "targetRpe"
>;

/** Appends a set, copying the previous set's targets so a ladder of sets is one click each. */
export async function addRoutineSet(routineExerciseId: string): Promise<void> {
  const sets = blockSets(routineExerciseId);
  const previous = sets.at(-1);
  const row = emptySet(routineExerciseId, nextPosition(sets));
  if (previous) {
    row.setType = previous.setType === "warmup" ? "normal" : previous.setType;
    row.targetReps = previous.targetReps;
    row.targetWeightKg = previous.targetWeightKg;
    row.targetDurationSeconds = previous.targetDurationSeconds;
    row.targetDistanceKm = previous.targetDistanceKm;
    row.targetRpe = previous.targetRpe;
  }
  await write([upsert("routine_sets", row)]);
}

export async function updateRoutineSet(id: string, patch: Partial<SetTargets>): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await write([upsert("routine_sets", { id, ...patch })]);
}

export async function deleteRoutineSet(id: string): Promise<void> {
  await write([remove("routine_sets", id)]);
}

export const SET_TYPE_ORDER: readonly SetType[] = ["normal", "warmup", "drop", "failure"];
