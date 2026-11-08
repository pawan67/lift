/**
 * The in-memory copy of the log, and the only thing screens read.
 *
 * Rows live in plain `Map`s that are mutated in place, and `version` is bumped
 * once per batch of changes. Screens subscribe to `version` and rebuild their
 * derived data with `useMemo`, so a pull of a thousand rows is one render, not
 * a thousand. (That per-row re-render is what made the Expo web build crawl.)
 */

import { SYNCABLE_TABLES, type SyncableTable } from "@lift/shared";
import { create } from "zustand";

import type { AnyRow, TableRows, Tables } from "./types";

export type DataStatus = "booting" | "ready" | "error";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface DataState {
  status: DataStatus;
  user: SessionUser | null;
  /** Bumped on every applied change. Derived data keys on this. */
  version: number;
  tables: Tables;
  syncing: boolean;
  lastSyncedAt: number | null;
  syncError: string | null;
  /** Local writes the server has not acknowledged yet. */
  pending: number;
  /** Writes the server refused, with the most recent reason. */
  rejected: { count: number; reason: string | null };
  bootError: string | null;
}

export function emptyTables(): Tables {
  return Object.fromEntries(SYNCABLE_TABLES.map((table) => [table, new Map()])) as unknown as Tables;
}

export const useData = create<DataState>(() => ({
  status: "booting",
  user: null,
  version: 0,
  tables: emptyTables(),
  syncing: false,
  lastSyncedAt: null,
  syncError: null,
  pending: 0,
  rejected: { count: 0, reason: null },
  bootError: null,
}));

/** Applies rows to memory and bumps the version once. */
export function applyRows(rows: readonly { table: SyncableTable; row: AnyRow }[]): void {
  if (rows.length === 0) return;
  const { tables } = useData.getState();
  for (const { table, row } of rows) {
    (tables[table] as Map<string, AnyRow>).set(row.id, row);
  }
  useData.setState((state) => ({ version: state.version + 1 }));
}

export function replaceTables(next: Tables): void {
  useData.setState((state) => ({ tables: next, version: state.version + 1 }));
}

/** Reads one live row, or undefined when missing or tombstoned. */
export function getRow<T extends SyncableTable>(table: T, id: string): TableRows[T] | undefined {
  const row = useData.getState().tables[table].get(id) as TableRows[T] | undefined;
  return row && row.deletedAt === null ? row : undefined;
}

/** Subscribes a component to data changes; returns the version for memo keys. */
export function useDataVersion(): number {
  return useData((state) => state.version);
}
