/**
 * Logs one or more readings taken at the same moment.
 *
 * A tape session is a dozen numbers written down together, so this is one form
 * with a field per kind rather than one dialog per kind. Fields are entered in
 * display units and stored canonically; empty fields are skipped. Each field
 * shows the last reading as its placeholder, which is the number the person is
 * comparing against anyway.
 */

"use client";

import {
  MEASUREMENT_GROUPS,
  MEASUREMENT_GROUP_KINDS,
  MEASUREMENT_GROUP_LABELS,
  MEASUREMENT_KIND_LABELS,
  formatMeasurementValue,
  fromDisplayMeasurementValue,
  isPlausibleMeasurement,
  measurementRange,
  measurementUnitLabel,
  trimZeros,
  type MeasurementKind,
} from "@lift/shared";
import { useState } from "react";

import { Dialog, toast } from "@/components/ui/dialog";
import { Button, Field, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useModel } from "@/lib/data/model";
import { useFormat } from "@/lib/format";
import { useNow } from "@/lib/measurements/use-now";
import { fromLocalInput, parseDecimal, recordMeasurements, toLocalInput } from "@/lib/measurements/actions";

export function LogMeasurementsDialog({
  open,
  onClose,
  kinds,
  title,
}: {
  open: boolean;
  onClose: () => void;
  /** Restricts the form to these kinds, e.g. just bodyweight. Default: every kind, grouped. */
  kinds?: readonly MeasurementKind[];
  title?: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title ?? "Log measurements"} size={kinds && kinds.length <= 2 ? "sm" : "lg"}>
      {/* Remounted per open, so every opening starts from a clean form and "now". */}
      {open ? <LogForm kinds={kinds} onDone={onClose} /> : null}
    </Dialog>
  );
}

function LogForm({ kinds, onDone }: { kinds?: readonly MeasurementKind[]; onDone: () => void }) {
  const model = useModel();
  const format = useFormat();
  const prefs = format.measurementPrefs;

  const now = useNow(60_000);
  const [when, setWhen] = useState(() => toLocalInput(Date.now()));
  const [values, setValues] = useState<Partial<Record<MeasurementKind, string>>>({});
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const groups = MEASUREMENT_GROUPS.map((group) => ({
    group,
    kinds: MEASUREMENT_GROUP_KINDS[group].filter((kind) => !kinds || kinds.includes(kind)),
  })).filter((entry) => entry.kinds.length > 0);

  const single = kinds?.length === 1;

  function errorFor(kind: MeasurementKind): string | null {
    const text = values[kind] ?? "";
    if (!text.trim()) return null;
    const display = parseDecimal(text);
    if (display === null) return "Enter a number.";
    if (!isPlausibleMeasurement(kind, fromDisplayMeasurementValue(kind, display, prefs))) {
      const range = measurementRange(kind, prefs);
      return `Between ${trimZeros(range.min.toFixed(1))} and ${trimZeros(range.max.toFixed(1))} ${measurementUnitLabel(kind, prefs)}.`;
    }
    return null;
  }

  const filled = (Object.keys(values) as MeasurementKind[]).filter((kind) => (values[kind] ?? "").trim() !== "");
  const measuredAt = fromLocalInput(when);
  const invalid = filled.some((kind) => errorFor(kind) !== null);
  const future = measuredAt !== null && measuredAt > now + 5 * 60_000;

  async function save() {
    setSubmitted(true);
    if (filled.length === 0 || invalid || measuredAt === null || future) return;
    setSaving(true);
    try {
      await recordMeasurements(
        filled.map((kind) => ({
          kind,
          value: fromDisplayMeasurementValue(kind, parseDecimal(values[kind]!)!, prefs),
          measuredAt,
          notes,
        })),
      );
      toast(filled.length === 1 ? `${MEASUREMENT_KIND_LABELS[filled[0]!]} logged` : `${filled.length} measurements logged`);
      onDone();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex h-full flex-col"
    >
      <div className="space-y-6 px-5 py-5">
        <Field label="Taken" error={future ? "That is in the future." : measuredAt === null && submitted ? "Pick a date and time." : undefined}>
          <Input type="datetime-local" value={when} max={toLocalInput(now)} onChange={(e) => setWhen(e.target.value)} />
        </Field>

        {groups.map(({ group, kinds: groupKinds }) => (
          <section key={group}>
            {single ? null : (
              <h3 className="mb-3 font-mono text-[11px] tracking-wider text-fg-3 uppercase">{MEASUREMENT_GROUP_LABELS[group]}</h3>
            )}
            <div className={cn("grid gap-3", !single && "sm:grid-cols-2")}>
              {groupKinds.map((kind) => {
                const last = model.measurements.get(kind)?.at(-1);
                const error = errorFor(kind);
                return (
                  <Field key={kind} label={`${MEASUREMENT_KIND_LABELS[kind]} (${measurementUnitLabel(kind, prefs)})`} error={error}>
                    <Input
                      inputMode="decimal"
                      aria-label={MEASUREMENT_KIND_LABELS[kind]}
                      data-kind={kind}
                      data-autofocus={single || kind === groups[0]?.kinds[0] ? true : undefined}
                      placeholder={last ? `Last ${formatMeasurementValue(kind, last.value, prefs, { withUnit: false })}` : ""}
                      value={values[kind] ?? ""}
                      onChange={(e) => setValues((current) => ({ ...current, [kind]: e.target.value }))}
                      className={cn("tabular", error && "border-alarm focus:border-alarm")}
                    />
                  </Field>
                );
              })}
            </div>
          </section>
        ))}

        <Field label="Notes" hint="Optional. Saved with every reading in this entry.">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Morning, fasted" />
        </Field>

        {submitted && filled.length === 0 ? <p className="text-sm text-alarm">Fill in at least one measurement.</p> : null}
      </div>

      <div className="sticky bottom-0 mt-auto flex items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">
        <span className="mr-auto text-xs text-fg-3">
          {filled.length > 0 ? `${filled.length} reading${filled.length === 1 ? "" : "s"}` : null}
        </span>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
