/**
 * Writing body measurements, with the phone's semantics
 * (`apps/mobile/src/features/measurements/repository.ts`): values are stored
 * canonically (kg, %, cm), a new reading is a new row, an edit rewrites the
 * whole row, and a delete is a tombstone that syncs.
 */

import type { MeasurementKind } from "@lift/shared";

import { remove, upsert, uuidv7, write } from "@/lib/data/mutate";

export interface NewMeasurement {
  kind: MeasurementKind;
  /** Canonical units. */
  value: number;
  measuredAt: number;
  notes?: string | null;
}

/** Records several readings in one batch: one sync, one render. */
export async function recordMeasurements(entries: readonly NewMeasurement[]): Promise<void> {
  await write(
    entries.map((entry) =>
      upsert("body_measurements", {
        id: uuidv7(),
        kind: entry.kind,
        value: entry.value,
        measuredAt: entry.measuredAt,
        notes: entry.notes?.trim() || null,
      }),
    ),
  );
}

export async function updateMeasurement(
  id: string,
  patch: { value?: number; measuredAt?: number; notes?: string | null },
): Promise<void> {
  await write([upsert("body_measurements", { id, ...patch })]);
}

export async function deleteMeasurement(id: string): Promise<void> {
  await write([remove("body_measurements", id)]);
}

// ---------------------------------------------------------------------------
// <input type="datetime-local"> round trip, in the browser's own time zone
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Null for an empty or malformed value. */
export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Accepts "82,5" as well as "82.5": half the world types a decimal comma. */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
