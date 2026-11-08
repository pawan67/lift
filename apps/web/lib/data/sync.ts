/**
 * The sync engine: push the outbox, then pull everything since the cursor.
 *
 * Same protocol and the same rules as the phone (`apps/mobile/src/features/sync/engine.ts`):
 * last-write-wins per row, a `stale` conflict means the server's row replaces
 * ours, a `missing_parent` is retried on a later run, and anything the server
 * refuses outright is dropped rather than retried forever.
 *
 * Requests go to this app's own `/api/sync/*`, which forwards them to the Lift
 * API with the session token from the httpOnly cookie.
 */

import { SYNCABLE_TABLES, type SyncConflict, type SyncPushResponse, type SyncableTable } from "@lift/shared";

import {
  clearTables,
  deleteOutbox,
  loadAllTables,
  outboxCount,
  putRows,
  readMeta,
  readOutbox,
  updateOutbox,
  writeMeta,
  type OutboxEntry,
} from "./idb";
import { applyRows, emptyTables, replaceTables, useData } from "./store";
import { announceChange } from "./tabs";
import type { AnyRow, Tables } from "./types";

const PUSH_BATCH = 500;
const PULL_LIMIT = 5000;
const MAX_ATTEMPTS = 5;

export class UnauthorizedError extends Error {
  constructor() {
    super("Your session has expired. Sign in again.");
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Sync failed (${response.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return (await response.json()) as T;
}

/** Server rows carry `userId` and `seq`; neither belongs in the local copy. */
function toLocal(row: Record<string, unknown>): AnyRow {
  const rest = { ...row };
  delete rest.userId;
  delete rest.seq;
  return rest as unknown as AnyRow;
}

/**
 * A full page load rather than a client-side navigation: it is the cheapest way
 * to drop every in-memory row of the account that was just signed out.
 */
export function hardNavigate(path: string): void {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full load, see above
  window.location.assign(`${window.location.origin}${path}`);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/** Loads the IndexedDB copy into memory. Fast: no network. */
export async function hydrateFromDisk(): Promise<void> {
  const stored = await loadAllTables();
  const tables = emptyTables();
  for (const table of SYNCABLE_TABLES) {
    const map = tables[table] as Map<string, AnyRow>;
    for (const row of stored[table]) map.set(row.id, row);
  }
  replaceTables(tables as Tables);
  await refreshOutboxCounts();
}

export async function refreshOutboxCounts(): Promise<void> {
  const entries = await readOutbox(100_000);
  const rejected = entries.filter((entry) => entry.attempts >= MAX_ATTEMPTS);
  useData.setState({
    pending: entries.length - rejected.length,
    rejected: {
      count: rejected.length,
      reason: rejected.at(-1)?.lastError ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

async function getDeviceId(): Promise<string> {
  const existing = await readMeta<string>("deviceId");
  if (existing) return existing;
  const created = crypto.randomUUID();
  await writeMeta("deviceId", created);
  return created;
}

async function pushOutbox(): Promise<void> {
  const deviceId = await getDeviceId();

  for (;;) {
    const entries = (await readOutbox(100_000)).filter((entry) => entry.attempts < MAX_ATTEMPTS).slice(0, PUSH_BATCH);
    if (entries.length === 0) return;

    const response = await post<SyncPushResponse>("/api/sync/push", {
      deviceId,
      mutations: entries.map((entry) => ({
        clientSeq: entry.clientSeq!,
        table: entry.table,
        rowId: entry.rowId,
        op: entry.op,
        payload: entry.payload,
        updatedAt: entry.updatedAt,
      })),
    });

    const done = new Set<number>(response.applied);
    const serverRows: { table: SyncableTable; row: AnyRow }[] = [];
    const retry: OutboxEntry[] = [];
    const bySeq = new Map(entries.map((entry) => [entry.clientSeq!, entry]));

    for (const conflict of response.conflicts as SyncConflict[]) {
      const entry = bySeq.get(conflict.clientSeq);
      if (!entry) continue;

      if (conflict.reason === "stale") {
        if (conflict.serverRow) serverRows.push({ table: conflict.table, row: toLocal(conflict.serverRow) });
        done.add(conflict.clientSeq);
      } else if (conflict.reason === "missing_parent") {
        retry.push({
          ...entry,
          attempts: entry.attempts + 1,
          lastError: "The server has not seen the row this one belongs to yet.",
        });
      } else {
        retry.push({
          ...entry,
          attempts: MAX_ATTEMPTS,
          lastError: conflict.reason === "forbidden" ? "The server refused this change." : "The server could not read this change.",
        });
      }
    }

    if (serverRows.length > 0) {
      await putRows(serverRows);
      applyRows(serverRows);
      announceChange();
    }
    await deleteOutbox([...done]);
    await updateOutbox(retry);

    // Nothing moved: stop rather than spin on the same batch.
    if (done.size === 0) return;
  }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

interface PullResponse {
  changes: Partial<Record<SyncableTable, Record<string, unknown>[]>>;
  cursor: string;
  hasMore: boolean;
  resyncRequired?: boolean;
}

async function pullChanges(): Promise<void> {
  let cursor = (await readMeta<string>("cursor")) ?? null;

  for (;;) {
    const response = await post<PullResponse>("/api/sync/pull", { cursor, limit: PULL_LIMIT });

    if (response.resyncRequired) {
      // Tombstones we never saw have been swept: start again from nothing.
      await clearTables();
      replaceTables(emptyTables());
      cursor = null;
      continue;
    }

    const rows: { table: SyncableTable; row: AnyRow }[] = [];
    for (const table of SYNCABLE_TABLES) {
      for (const row of response.changes[table] ?? []) rows.push({ table, row: toLocal(row) });
    }

    // Local writes still waiting in the outbox win over an older server copy.
    const pendingIds = new Set((await readOutbox(100_000)).map((entry) => `${entry.table}/${entry.rowId}`));
    const { tables } = useData.getState();
    const accepted = rows.filter(({ table, row }) => {
      if (!pendingIds.has(`${table}/${row.id}`)) return true;
      const local = (tables[table] as Map<string, AnyRow>).get(row.id);
      return !local || row.updatedAt > local.updatedAt;
    });

    await putRows(accepted);
    applyRows(accepted);
    if (accepted.length > 0) announceChange();

    cursor = response.cursor;
    await writeMeta("cursor", cursor);
    if (!response.hasMore) return;
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

let inFlight: Promise<void> | null = null;
let again = false;

/** Pushes then pulls. Concurrent calls coalesce into at most one follow-up run. */
export function syncNow(): Promise<void> {
  if (inFlight) {
    again = true;
    return inFlight;
  }

  inFlight = (async () => {
    useData.setState({ syncing: true });
    try {
      do {
        again = false;
        await pushOutbox();
        await pullChanges();
      } while (again);
      useData.setState({ lastSyncedAt: Date.now(), syncError: null });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        hardNavigate("/sign-in?expired=1");
        return;
      }
      useData.setState({ syncError: error instanceof Error ? error.message : String(error) });
    } finally {
      await refreshOutboxCounts().catch(() => undefined);
      useData.setState({ syncing: false });
      inFlight = null;
    }
  })();

  return inFlight;
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

/** Called after local writes: syncs shortly after, batching bursts of edits. */
export function scheduleSync(delayMs = 800): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncNow();
  }, delayMs);
}

/** Re-queues writes the server refused, for after the cause is fixed. */
export async function retryRejected(): Promise<void> {
  const entries = (await readOutbox(100_000)).filter((entry) => entry.attempts >= MAX_ATTEMPTS);
  await updateOutbox(entries.map((entry) => ({ ...entry, attempts: 0, lastError: null })));
  await refreshOutboxCounts();
  void syncNow();
}

/** Throws the local copy away and downloads the whole log again. */
export async function fullResync(): Promise<void> {
  await clearTables();
  replaceTables(emptyTables());
  await syncNow();
}

export { outboxCount };
