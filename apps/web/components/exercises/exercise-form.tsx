/**
 * Create or edit a custom exercise.
 *
 * Mirrors the phone's form (`apps/mobile/src/features/exercises/exercise-form.tsx`):
 * names are unique case-insensitively, and the tracking type is locked once the
 * exercise has logged sets, because changing it would reinterpret every set
 * already recorded (a weight column read as assistance, say).
 */

"use client";

import {
  EQUIPMENT,
  EQUIPMENT_LABELS,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  TRACKING_TYPES,
  type Equipment,
  type MuscleGroup,
  type TrackingType,
} from "@lift/shared";
import { Lock } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ChoiceCards } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useModel, type ExerciseInfo } from "@/lib/data/model";
import { TRACKING_HINTS, TRACKING_LABELS } from "@/lib/exercises/labels";
import {
  createCustomExercise,
  hasHistory,
  nameConflict,
  updateCustomExercise,
  type CustomExerciseInput,
} from "@/lib/exercises/mutations";

const REST_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "App default" },
  ...[30, 45, 60, 90, 120, 150, 180, 240, 300].map((seconds) => ({
    value: String(seconds),
    label: seconds < 60 ? `${seconds} s` : seconds % 60 === 0 ? `${seconds / 60} min` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`,
  })),
];

export function ExerciseForm({
  exercise,
  initialName = "",
  onSaved,
  onCancel,
  submitLabel,
  compact = false,
}: {
  /** The custom exercise being edited; omitted to create one. */
  exercise?: ExerciseInfo;
  initialName?: string;
  onSaved: (id: string) => void;
  onCancel?: () => void;
  submitLabel?: string;
  /** Inside the selector: one column, no notes. */
  compact?: boolean;
}) {
  const model = useModel();
  const editing = exercise !== undefined;

  const [name, setName] = useState(exercise?.name ?? initialName);
  const [equipment, setEquipment] = useState<Equipment>(exercise?.equipment ?? "barbell");
  const [primaryMuscle, setPrimaryMuscle] = useState<MuscleGroup>(exercise?.primaryMuscle ?? "chest");
  const [secondaryMuscles, setSecondaryMuscles] = useState<MuscleGroup[]>(exercise?.secondaryMuscles ?? []);
  const [trackingType, setTrackingType] = useState<TrackingType>(exercise?.trackingType ?? "weight_reps");
  const [notes, setNotes] = useState(exercise?.notes ?? "");
  const [rest, setRest] = useState(exercise?.row?.defaultRestSeconds ? String(exercise.row.defaultRestSeconds) : "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trackingLocked = useMemo(() => (exercise ? hasHistory(model, exercise.id) : false), [model, exercise]);

  const restOptions = useMemo(
    () => (rest && !REST_OPTIONS.some((option) => option.value === rest) ? [...REST_OPTIONS, { value: rest, label: `${rest} s` }] : REST_OPTIONS),
    [rest],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const reason = nameConflict(model, name, exercise?.id);
    if (reason) {
      setNameError(reason);
      return;
    }

    const input: CustomExerciseInput = {
      name,
      equipment,
      primaryMuscle,
      secondaryMuscles,
      trackingType,
      notes: notes || null,
      defaultRestSeconds: rest ? Number(rest) : null,
    };

    setSaving(true);
    try {
      if (exercise) {
        await updateCustomExercise(exercise, input);
        toast("Exercise saved");
        onSaved(exercise.id);
      } else {
        const id = await createCustomExercise(input);
        toast(`${input.name.trim()} created`);
        onSaved(id);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save the exercise.", "error");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Name" error={nameError}>
        <Input
          value={name}
          data-autofocus=""
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(null);
          }}
          onBlur={() => {
            if (name.trim()) setNameError(nameConflict(model, name, exercise?.id));
          }}
          placeholder="e.g. Landmine Press"
          maxLength={120}
        />
      </Field>

      <div className={cn("grid gap-4", !compact && "sm:grid-cols-2")}>
        <Field label="Equipment">
          <Select<Equipment>
            value={equipment}
            onValueChange={setEquipment}
            aria-label="Equipment"
            options={EQUIPMENT.map((item) => ({ value: item, label: EQUIPMENT_LABELS[item] }))}
          />
        </Field>
        <Field label="Primary muscle">
          <Select<MuscleGroup>
            value={primaryMuscle}
            onValueChange={(next) => {
              setPrimaryMuscle(next);
              setSecondaryMuscles((current) => current.filter((muscle) => muscle !== next));
            }}
            aria-label="Primary muscle"
            options={MUSCLE_GROUPS.map((muscle) => ({ value: muscle, label: MUSCLE_GROUP_LABELS[muscle] }))}
          />
        </Field>
      </div>

      <div>
        <span className="mb-1.5 flex items-baseline gap-2 text-[13px] font-medium text-fg-2">
          Secondary muscles
          {secondaryMuscles.length > 0 ? <span className="tabular text-xs font-normal text-fg-3">{secondaryMuscles.length} picked</span> : null}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {MUSCLE_GROUPS.filter((muscle) => muscle !== primaryMuscle).map((muscle) => (
            <Chip
              key={muscle}
              selected={secondaryMuscles.includes(muscle)}
              onClick={() =>
                setSecondaryMuscles((current) =>
                  current.includes(muscle) ? current.filter((entry) => entry !== muscle) : [...current, muscle],
                )
              }
            >
              {MUSCLE_GROUP_LABELS[muscle]}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-fg-2">
          Tracking
          {trackingLocked ? (
            <span className="inline-flex items-center gap-1 font-normal text-fg-3">
              <Lock size={11} /> Locked: this exercise has logged sets
            </span>
          ) : null}
        </span>
        <ChoiceCards
          aria-label="Tracking"
          value={trackingType}
          onChange={setTrackingType}
          className={compact ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"}
          options={TRACKING_TYPES.map((type) => ({
            value: type,
            label: TRACKING_LABELS[type],
            description: TRACKING_HINTS[type],
            disabled: trackingLocked && trackingType !== type,
          }))}
        />
      </div>

      {compact ? null : (
        <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
          <Field label="Notes" hint="Setup cues, seat height, grip.">
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} />
          </Field>
          <Field label="Default rest">
            <Select value={rest} onValueChange={setRest} aria-label="Default rest" options={restOptions} />
          </Field>
        </div>
      )}

      <div className={cn("flex items-center justify-end gap-2", compact ? "pt-1" : "border-t border-line pt-5")}>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : (submitLabel ?? (editing ? "Save changes" : "Create exercise"))}
        </Button>
      </div>
    </form>
  );
}
