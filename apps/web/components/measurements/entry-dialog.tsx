/** Edits or deletes one reading. */

"use client";

import {
  MEASUREMENT_KIND_LABELS,
  formatMeasurementValue,
  fromDisplayMeasurementValue,
  isPlausibleMeasurement,
  measurementRange,
  measurementUnitLabel,
  trimZeros,
} from "@lift/shared";
import { useState } from "react";

import { Dialog, confirm, toast } from "@/components/ui/dialog";
import { Button, Field, Input } from "@/components/ui/primitives";
import type { BodyMeasurementRow } from "@/lib/data/types";
import { useFormat } from "@/lib/format";
import { useNow } from "@/lib/measurements/use-now";
import { deleteMeasurement, fromLocalInput, parseDecimal, toLocalInput, updateMeasurement } from "@/lib/measurements/actions";

export function EditEntryDialog({ entry, onClose }: { entry: BodyMeasurementRow | null; onClose: () => void }) {
  return (
    <Dialog open={entry !== null} onClose={onClose} title={entry ? `Edit ${MEASUREMENT_KIND_LABELS[entry.kind].toLowerCase()}` : undefined} size="sm">
      {entry ? <EditForm key={entry.id} entry={entry} onDone={onClose} /> : null}
    </Dialog>
  );
}

function EditForm({ entry, onDone }: { entry: BodyMeasurementRow; onDone: () => void }) {
  const prefs = useFormat().measurementPrefs;
  const [value, setValue] = useState(() => formatMeasurementValue(entry.kind, entry.value, prefs, { withUnit: false }).replace(/,/g, ""));
  const [when, setWhen] = useState(() => toLocalInput(entry.measuredAt));
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [saving, setSaving] = useState(false);
  const now = useNow(60_000);

  const display = parseDecimal(value);
  const stored = display === null ? null : fromDisplayMeasurementValue(entry.kind, display, prefs);
  const range = measurementRange(entry.kind, prefs);
  const valueError =
    display === null
      ? "Enter a number."
      : !isPlausibleMeasurement(entry.kind, stored!)
        ? `Between ${trimZeros(range.min.toFixed(1))} and ${trimZeros(range.max.toFixed(1))} ${measurementUnitLabel(entry.kind, prefs)}.`
        : null;
  const measuredAt = fromLocalInput(when);
  const whenError = measuredAt === null ? "Pick a date and time." : measuredAt > now + 5 * 60_000 ? "That is in the future." : null;

  async function save() {
    if (valueError || whenError) return;
    setSaving(true);
    try {
      // Re-entering the same display value keeps the stored one: converting a
      // rounded pound figure back to kg would otherwise nudge it on every save.
      const unchanged = formatMeasurementValue(entry.kind, entry.value, prefs, { withUnit: false }).replace(/,/g, "") === value.trim();
      await updateMeasurement(entry.id, {
        value: unchanged ? entry.value : stored!,
        measuredAt: measuredAt!,
        notes: notes.trim() || null,
      });
      toast("Saved");
      onDone();
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    const ok = await confirm({
      title: "Delete this reading?",
      body: `${formatMeasurementValue(entry.kind, entry.value, prefs)} on ${new Date(entry.measuredAt).toLocaleDateString()}. It is removed from your phone as well.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await deleteMeasurement(entry.id);
    toast("Reading deleted");
    onDone();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="space-y-4 px-5 py-5">
        <Field label={`Value (${measurementUnitLabel(entry.kind, prefs)})`} error={valueError}>
          <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="tabular" data-autofocus />
        </Field>
        <Field label="Taken" error={whenError}>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <Button variant="danger" onClick={() => void onDelete()} className="mr-auto">
          Delete
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving || Boolean(valueError || whenError)}>
          Save
        </Button>
      </div>
    </form>
  );
}
