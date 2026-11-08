/**
 * Every local write goes through here.
 *
 * A write lands in memory and IndexedDB at once (so the screen updates
 * immediately and survives a reload), is queued in the outbox, and a sync is
 * scheduled. Deletes are soft: a tombstone with `deletedAt`, never a removal,
 * because a removed row cannot replicate to the phone.
 *
 * Order matters within a batch: parents before children. The server applies a
 * push in `clientSeq` order and refuses a child whose parent it has not seen.
 */

import { uuidv7, type SyncableTable } from "@lift/shared";

import { putRowsWithOutbox, type OutboxEntry } from "./idb";
import { applyRows, useData } from "./store";
import { refreshOutboxCounts, scheduleSync } from "./sync";
import { announceChange } from "./tabs";
import type { AnyRow, TableRows } from "./types";

export { uuidv7 };

type Fields<T extends SyncableTable> = Omit<TableRows[T], "createdAt" | "updatedAt" | "deletedAt">;

export type WriteOp =
  | { kind: "upsert"; table: SyncableTable; row: Record<string, unknown> & { id: string } }
  | { kind: "delete"; table: SyncableTable; id: string };

/** Builds an upsert. Fields left out keep their current value. */
export function upsert<T extends SyncableTable>(
  table: T,
  row: Partial<Fields<T>> & { id: string },
): WriteOp {
  return { kind: "upsert", table, row: row as Record<string, unknown> & { id: string } };
}

export function remove(table: SyncableTable, id: string): WriteOp {
  return { kind: "delete", table, id };
}

/** Last stamp handed out, so two writes in one millisecond still order. */
let lastStamp = 0;
function stamp(): number {
  const now = Date.now();
  lastStamp = now > lastStamp ? now : lastStamp + 1;
  return lastStamp;
}

/**
 * Applies a batch of writes locally and queues them for the server.
 *
 * Upserts merge onto the existing row, so callers pass only what changed.
 * A brand-new row must carry every non-null column the server requires.
 */
export async function write(ops: readonly WriteOp[]): Promise<void> {
  if (ops.length === 0) return;

  const { tables } = useData.getState();
  const rows: { table: SyncableTable; row: AnyRow }[] = [];
  const entries: OutboxEntry[] = [];
  // Later ops in one batch see earlier ones.
  const staged = new Map<string, AnyRow>();

  for (const op of ops) {
    const updatedAt = stamp();
    const id = op.kind === "upsert" ? op.row.id : op.id;
    const key = `${op.table}/${id}`;
    const existing = staged.get(key) ?? ((tables[op.table] as Map<string, AnyRow>).get(id) as AnyRow | undefined);

    if (op.kind === "delete") {
      if (!existing || existing.deletedAt !== null) continue;
      const row = { ...existing, deletedAt: updatedAt, updatedAt } as AnyRow;
      staged.set(key, row);
      rows.push({ table: op.table, row });
      entries.push({ table: op.table, rowId: id, op: "delete", payload: null, updatedAt, attempts: 0, lastError: null });
      continue;
    }

    const row = {
      ...(existing ?? { createdAt: updatedAt, deletedAt: null }),
      ...op.row,
      updatedAt,
    } as AnyRow;
    staged.set(key, row);
    rows.push({ table: op.table, row });
    entries.push({
      table: op.table,
      rowId: id,
      op: "upsert",
      payload: row as unknown as Record<string, unknown>,
      updatedAt,
      attempts: 0,
      lastError: null,
    });
  }

  await putRowsWithOutbox(rows, entries);
  applyRows(rows);
  announceChange();
  void refreshOutboxCounts();
  scheduleSync();
}
