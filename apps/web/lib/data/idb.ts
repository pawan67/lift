/**
 * The browser's copy of the training log, in IndexedDB.
 *
 * One object store per synced table, keyed by row id, plus `meta` (cursor,
 * device id, owner) and `outbox` (local writes not yet acknowledged by the
 * server). The outbox key is auto-incremented, which makes it the `clientSeq`
 * the push protocol wants: unique per device and strictly increasing, and the
 * key generator never rewinds, even after entries are deleted.
 */

import { SYNCABLE_TABLES, type Mutation, type SyncableTable } from "@lift/shared";
import { openDB, type IDBPDatabase } from "idb";

import type { AnyRow } from "./types";

const DB_NAME = "lift-web";
const DB_VERSION = 1;

export interface OutboxEntry {
  clientSeq?: number;
  table: SyncableTable;
  rowId: string;
  op: Mutation["op"];
  payload: Record<string, unknown> | null;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function database(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      for (const table of SYNCABLE_TABLES) {
        if (!db.objectStoreNames.contains(table)) db.createObjectStore(table, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "clientSeq", autoIncrement: true });
      }
    },
    blocking() {
      // Another tab is upgrading the schema: let it, and reload into it.
      dbPromise = null;
    },
  });
  return dbPromise;
}

export async function readMeta<T = string>(key: string): Promise<T | undefined> {
  return (await database()).get("meta", key) as Promise<T | undefined>;
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  await (await database()).put("meta", value, key);
}

export async function loadAllTables(): Promise<Record<SyncableTable, AnyRow[]>> {
  const db = await database();
  const tx = db.transaction([...SYNCABLE_TABLES], "readonly");
  const entries = await Promise.all(
    SYNCABLE_TABLES.map(async (table) => [table, (await tx.objectStore(table).getAll()) as AnyRow[]] as const),
  );
  await tx.done;
  return Object.fromEntries(entries) as Record<SyncableTable, AnyRow[]>;
}

/** Writes rows to their stores in one transaction. */
export async function putRows(rows: readonly { table: SyncableTable; row: AnyRow }[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await database();
  const tables = [...new Set(rows.map((entry) => entry.table))];
  const tx = db.transaction(tables, "readwrite");
  for (const { table, row } of rows) void tx.objectStore(table).put(row);
  await tx.done;
}

/** Writes rows and their outbox entries atomically; returns the assigned clientSeqs. */
export async function putRowsWithOutbox(
  rows: readonly { table: SyncableTable; row: AnyRow }[],
  entries: readonly OutboxEntry[],
): Promise<void> {
  const db = await database();
  const tables = [...new Set(rows.map((entry) => entry.table))];
  const tx = db.transaction([...tables, "outbox"], "readwrite");
  for (const { table, row } of rows) void tx.objectStore(table).put(row);
  const outbox = tx.objectStore("outbox");
  for (const entry of entries) void outbox.add(entry);
  await tx.done;
}

export async function readOutbox(limit = 500): Promise<OutboxEntry[]> {
  const db = await database();
  return (await db.getAll("outbox", undefined, limit)) as OutboxEntry[];
}

export async function outboxCount(): Promise<number> {
  return (await database()).count("outbox");
}

export async function deleteOutbox(seqs: readonly number[]): Promise<void> {
  if (seqs.length === 0) return;
  const db = await database();
  const tx = db.transaction("outbox", "readwrite");
  for (const seq of seqs) void tx.store.delete(seq);
  await tx.done;
}

export async function updateOutbox(entries: readonly OutboxEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await database();
  const tx = db.transaction("outbox", "readwrite");
  for (const entry of entries) void tx.store.put(entry);
  await tx.done;
}

/** Empties the synced tables and the cursor, keeping the outbox and device id. */
export async function clearTables(): Promise<void> {
  const db = await database();
  const tx = db.transaction([...SYNCABLE_TABLES, "meta"], "readwrite");
  for (const table of SYNCABLE_TABLES) void tx.objectStore(table).clear();
  void tx.objectStore("meta").delete("cursor");
  await tx.done;
}

/** Forgets everything: used on sign-out and when a different account signs in. */
export async function wipeDatabase(): Promise<void> {
  const db = await database();
  const tx = db.transaction([...SYNCABLE_TABLES, "meta", "outbox"], "readwrite");
  for (const name of [...SYNCABLE_TABLES, "meta", "outbox"] as const) void tx.objectStore(name).clear();
  await tx.done;
}
