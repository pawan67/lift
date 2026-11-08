/**
 * One exercise in the routine editor: header, rest and notes, and the table of
 * target sets. Which target columns appear depends on the exercise's tracking
 * type, the same way the phone decides which fields a set row has.
 */

"use client";

import {
  formatDuration,
  fromDisplayDistance,
  fromDisplayWeight,
  MUSCLE_GROUP_LABELS,
  EQUIPMENT_LABELS,
  parseDuration,
  SET_TYPE_BADGE,
  SET_TYPE_LABELS,
  toDisplayDistance,
  toDisplayWeight,
  TRACKING_FIELDS,
  trimZeros,
  type SetType,
  type SupersetPlacement,
  type TrackingType,
} from "@lift/shared";
import { ArrowDown, ArrowUp, GripVertical, Link2, Plus, Trash2, Unlink, X } from "lucide-react";
import Link from "next/link";
import type { DragEvent } from "react";

import { ExerciseThumb } from "@/components/exercises/exercise-thumb";
import { Card, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { RoutineExerciseView } from "@/lib/data/model";
import type { RoutineSetRow } from "@/lib/data/types";
import { formatDateShort, useFormat } from "@/lib/format";
import {
  addRoutineSet,
  deleteRoutineSet,
  linkWithNext,
  removeExerciseFromRoutine,
  SET_TYPE_ORDER,
  unlinkFromSuperset,
  updateRoutineExercise,
  updateRoutineSet,
} from "@/lib/routines/repository";
import type { LastPerformance } from "@/lib/routines/summary";

import { DraftInput, NumberCell } from "./fields";
import { ActionMenu, type MenuItem } from "./menu";

const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

function restLabel(seconds: number): string {
  if (seconds === 0) return "No rest";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** Header for the load column, which means different things per tracking type. */
function weightHeading(tracking: TrackingType, unit: string): string {
  if (tracking === "weighted_bodyweight") return `+${unit}`;
  if (tracking === "assisted_bodyweight") return `Assist ${unit}`;
  return unit;
}

/** Numbers typed into a cell: non-negative, finite; undefined when unreadable. */
function parseNumber(text: string, { integer = false, max = 100_000 } = {}): number | undefined {
  const value = Number(text.replace(",", "."));
  if (!Number.isFinite(value) || value < 0 || value > max) return undefined;
  return integer ? Math.round(value) : value;
}

export interface DragHandlers {
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onArm: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onDragEnd: () => void;
  draggable: boolean;
}

export function ExerciseBlock({
  routineId,
  block,
  index,
  count,
  placement,
  linkedToNext,
  last,
  onMove,
  drag,
}: {
  routineId: string;
  block: RoutineExerciseView;
  index: number;
  count: number;
  placement: SupersetPlacement | undefined;
  /** True when this block and the next are in the same superset. */
  linkedToNext: boolean;
  last: LastPerformance | null;
  onMove: (from: number, to: number) => void;
  drag: DragHandlers;
}) {
  const f = useFormat();
  const exercise = block.exercise;
  const tracking: TrackingType = exercise?.trackingType ?? "weight_reps";
  const fields = TRACKING_FIELDS[tracking];
  const name = exercise?.name ?? "Unknown exercise";

  const lastSummary = last
    ? last.sets
        .slice(0, 6)
        .map((set) => describeSet(set, tracking, f))
        .filter(Boolean)
        .join(", ")
    : null;

  return (
    <div
      className={cn("relative", drag.dragging && "opacity-40")}
      draggable={drag.draggable}
      onDragStart={drag.onDragStart}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      onDragEnd={drag.onDragEnd}
    >
      {drag.dropBefore ? <div className="absolute -top-2 right-0 left-0 h-0.5 rounded-full bg-volt" /> : null}
      {drag.dropAfter ? <div className="absolute right-0 -bottom-2 left-0 h-0.5 rounded-full bg-volt" /> : null}

      <Card className={cn("overflow-visible", placement && "border-l-2 border-l-volt")}>
        {/* Header */}
        <div className="flex items-start gap-3 px-4 pt-4 sm:px-5">
          <button
            type="button"
            aria-label={`Drag to reorder ${name}`}
            onPointerDown={drag.onArm}
            className="-ml-1.5 hidden cursor-grab self-center rounded p-1 text-fg-3 hover:text-fg active:cursor-grabbing sm:block"
          >
            <GripVertical size={16} />
          </button>
          {exercise ? <ExerciseThumb exercise={exercise} size={44} /> : <ExerciseThumb exercise={{ name, thumbnailUrl: null }} size={44} />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {exercise ? (
                <Link href={`/exercises/${exercise.id}`} className="line-clamp-2 text-[15px] leading-snug font-semibold text-fg hover:text-volt">
                  {name}
                </Link>
              ) : (
                <span className="truncate text-[15px] font-semibold text-fg-3">{name}</span>
              )}
              {placement ? (
                <span className="rounded-md bg-volt-tint px-1.5 py-0.5 font-mono text-[11px] font-medium text-volt">
                  Superset {placement.label}
                  {placement.index}
                </span>
              ) : null}
            </div>
            {exercise ? (
              <p className="mt-0.5 truncate text-xs text-fg-3">
                {MUSCLE_GROUP_LABELS[exercise.primaryMuscle]} · {EQUIPMENT_LABELS[exercise.equipment]}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => onMove(index, index - 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-30"
            >
              <ArrowUp size={16} />
            </button>
            <button
              type="button"
              aria-label="Move down"
              disabled={index === count - 1}
              onClick={() => onMove(index, index + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-30"
            >
              <ArrowDown size={16} />
            </button>
            <ActionMenu
              label={`Actions for ${name}`}
              items={blockMenu({ routineId, blockId: block.row.id, linkedToNext, inSuperset: placement !== undefined, isLast: index === count - 1 })}
            />
          </div>
        </div>

        {/* Rest and notes */}
        <div className="mt-3 flex flex-col gap-2 px-4 sm:flex-row sm:px-5">
          <Select
            aria-label="Rest between sets"
            className="h-9 text-xs sm:w-40"
            value={block.row.restSeconds === null ? "" : String(block.row.restSeconds)}
            onChange={(event) =>
              void updateRoutineExercise(block.row.id, { restSeconds: event.target.value === "" ? null : Number(event.target.value) })
            }
          >
            <option value="">Rest: app default</option>
            {REST_OPTIONS.map((seconds) => (
              <option key={seconds} value={seconds}>
                Rest: {restLabel(seconds)}
              </option>
            ))}
          </Select>
          <DraftInput
            aria-label="Exercise notes"
            className="h-9 text-xs"
            value={block.row.notes ?? ""}
            placeholder="Add a note, e.g. seat height 4, pause at the bottom"
            maxLength={500}
            onCommit={(notes) => void updateRoutineExercise(block.row.id, { notes })}
          />
        </div>

        {lastSummary ? (
          <p className="mt-2.5 truncate px-4 text-xs text-fg-3 sm:px-5" title={lastSummary}>
            Last time, {formatDateShort(last!.at)}: <span className="tabular text-fg-2">{lastSummary}</span>
          </p>
        ) : null}

        {/* Sets */}
        <SetTable block={block} tracking={tracking} fields={fields} last={last} />
      </Card>

      {linkedToNext ? (
        <div className="flex h-3 justify-start pl-10" aria-hidden>
          <div className="w-0.5 bg-volt" />
        </div>
      ) : null}
    </div>
  );
}

function blockMenu({
  routineId,
  blockId,
  linkedToNext,
  inSuperset,
  isLast,
}: {
  routineId: string;
  blockId: string;
  linkedToNext: boolean;
  inSuperset: boolean;
  isLast: boolean;
}): (MenuItem | null)[] {
  const items: (MenuItem | null)[] = [];
  if (!linkedToNext && !isLast) {
    items.push({ label: "Superset with next", icon: <Link2 size={15} />, onSelect: () => void linkWithNext(routineId, blockId) });
  }
  if (inSuperset) {
    items.push({ label: "Remove from superset", icon: <Unlink size={15} />, onSelect: () => void unlinkFromSuperset(routineId, blockId) });
  }
  if (items.length > 0) items.push(null);
  items.push({ label: "Remove exercise", icon: <Trash2 size={15} />, destructive: true, onSelect: () => void removeExerciseFromRoutine(blockId) });
  return items;
}

function describeSet(
  set: { weightKg: number | null; reps: number | null; durationSeconds: number | null; distanceKm: number | null },
  tracking: TrackingType,
  f: ReturnType<typeof useFormat>,
): string {
  const fields = TRACKING_FIELDS[tracking];
  const parts: string[] = [];
  if (fields.weight && set.weightKg !== null) parts.push(f.weight(set.weightKg));
  if (fields.reps && set.reps !== null) parts.push(parts.length ? `× ${set.reps}` : `${set.reps} reps`);
  if (fields.distance && set.distanceKm !== null) parts.push(f.distance(set.distanceKm));
  if (fields.duration && set.durationSeconds !== null) parts.push(formatDuration(set.durationSeconds));
  return parts.join(" ");
}

function SetTable({
  block,
  tracking,
  fields,
  last,
}: {
  block: RoutineExerciseView;
  tracking: TrackingType;
  fields: (typeof TRACKING_FIELDS)[TrackingType];
  last: LastPerformance | null;
}) {
  const f = useFormat();

  const columns: { key: string; heading: string }[] = [{ key: "set", heading: "Set" }];
  if (fields.weight) columns.push({ key: "weight", heading: weightHeading(tracking, f.weightUnit) });
  if (fields.reps) columns.push({ key: "reps", heading: "Reps" });
  if (fields.distance) columns.push({ key: "distance", heading: f.distanceUnit });
  if (fields.duration) columns.push({ key: "duration", heading: "Time" });
  columns.push({ key: "rpe", heading: "RPE" });
  columns.push({ key: "remove", heading: "" });

  const template = columns
    .map((column) => (column.key === "set" ? "2.75rem" : column.key === "remove" ? "2rem" : column.key === "rpe" ? "minmax(0,0.7fr)" : "minmax(0,1fr)"))
    .join(" ");

  // Working sets are numbered 1, 2, 3; warm-ups wear a W and do not count.
  const ordinals = block.sets.reduce<number[]>((list, set) => {
    list.push((list.at(-1) ?? 0) + (set.setType === "warmup" ? 0 : 1));
    return list;
  }, []);

  return (
    <div className="px-4 pt-3 pb-4 sm:px-5">
      <div className="grid gap-2 pb-1.5 font-mono text-[10px] tracking-wider text-fg-3 uppercase" style={{ gridTemplateColumns: template }}>
        {columns.map((column) => (
          <div key={column.key} className={cn(column.key !== "set" && "text-center")}>
            {column.heading}
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        {block.sets.map((set, index) => {
          const ordinal = ordinals[index]!;
          const hint = set.setType === "warmup" ? undefined : last?.sets[ordinal - 1];
          return (
            <SetRow
              key={set.id}
              set={set}
              ordinal={ordinal}
              fields={fields}
              template={template}
              hint={hint}
              canRemove={block.sets.length > 1}
            />
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => void addRoutineSet(block.row.id)}
        className="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-xs font-medium text-fg-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-fg"
      >
        <Plus size={14} /> Add set
      </button>
    </div>
  );
}

function SetRow({
  set,
  ordinal,
  fields,
  template,
  hint,
  canRemove,
}: {
  set: RoutineSetRow;
  ordinal: number;
  fields: (typeof TRACKING_FIELDS)[TrackingType];
  template: string;
  hint: { weightKg: number | null; reps: number | null; durationSeconds: number | null; distanceKm: number | null } | undefined;
  canRemove: boolean;
}) {
  const f = useFormat();
  const weightText = (kg: number) => trimZeros(toDisplayWeight(kg, f.weightUnit).toFixed(2));
  const distanceText = (km: number) => trimZeros(toDisplayDistance(km, f.distanceUnit).toFixed(2));

  return (
    <div className="grid items-center gap-2" style={{ gridTemplateColumns: template }}>
      <SetTypePicker setType={set.setType} ordinal={ordinal} onPick={(setType) => void updateRoutineSet(set.id, { setType })} />

      {fields.weight ? (
        <NumberCell
          label="Target weight"
          value={set.targetWeightKg}
          placeholder={hint?.weightKg != null ? weightText(hint.weightKg) : "–"}
          toText={weightText}
          fromText={(text) => {
            const value = parseNumber(text, { max: 2000 });
            return value === undefined ? undefined : fromDisplayWeight(value, f.weightUnit);
          }}
          onCommit={(targetWeightKg) => void updateRoutineSet(set.id, { targetWeightKg })}
        />
      ) : null}

      {fields.reps ? (
        <NumberCell
          label="Target reps"
          inputMode="numeric"
          value={set.targetReps}
          placeholder={hint?.reps != null ? String(hint.reps) : "–"}
          toText={(reps) => String(reps)}
          fromText={(text) => parseNumber(text, { integer: true, max: 999 })}
          onCommit={(targetReps) => void updateRoutineSet(set.id, { targetReps })}
        />
      ) : null}

      {fields.distance ? (
        <NumberCell
          label="Target distance"
          value={set.targetDistanceKm}
          placeholder={hint?.distanceKm != null ? distanceText(hint.distanceKm) : "–"}
          toText={distanceText}
          fromText={(text) => {
            const value = parseNumber(text, { max: 1000 });
            return value === undefined ? undefined : fromDisplayDistance(value, f.distanceUnit);
          }}
          onCommit={(targetDistanceKm) => void updateRoutineSet(set.id, { targetDistanceKm })}
        />
      ) : null}

      {fields.duration ? (
        <NumberCell
          label="Target time"
          inputMode="text"
          value={set.targetDurationSeconds}
          placeholder={hint?.durationSeconds != null ? formatDuration(hint.durationSeconds) : "m:ss"}
          toText={formatDuration}
          fromText={(text) => parseDuration(text) ?? undefined}
          onCommit={(targetDurationSeconds) => void updateRoutineSet(set.id, { targetDurationSeconds })}
        />
      ) : null}

      <NumberCell
        label="Target RPE"
        value={set.targetRpe}
        placeholder="–"
        toText={(rpe) => trimZeros(rpe.toFixed(1))}
        fromText={(text) => {
          const value = parseNumber(text, { max: 10 });
          if (value === undefined || value < 1) return undefined;
          return Math.round(value * 2) / 2;
        }}
        onCommit={(targetRpe) => void updateRoutineSet(set.id, { targetRpe })}
      />

      <button
        type="button"
        aria-label="Remove set"
        disabled={!canRemove}
        onClick={() => void deleteRoutineSet(set.id)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-alarm/10 hover:text-alarm disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-fg-3"
      >
        <X size={15} />
      </button>
    </div>
  );
}

const SET_TYPE_TONE: Record<SetType, string> = {
  normal: "bg-surface-3 text-fg",
  warmup: "bg-warn/15 text-warn",
  drop: "bg-info/15 text-info",
  failure: "bg-alarm/15 text-alarm",
};

function SetTypePicker({ setType, ordinal, onPick }: { setType: SetType; ordinal: number; onPick: (type: SetType) => void }) {
  return (
    <ActionMenu
      align="left"
      label={`${SET_TYPE_LABELS[setType]}. Change set type`}
      triggerClassName={cn("h-9 w-full font-mono text-sm font-semibold", SET_TYPE_TONE[setType], "hover:brightness-125")}
      trigger={SET_TYPE_BADGE[setType] ?? String(ordinal)}
      items={SET_TYPE_ORDER.map((type) => ({
        label: (
          <span className="flex items-center gap-2.5">
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-md font-mono text-xs", SET_TYPE_TONE[type])}>
              {SET_TYPE_BADGE[type] ?? "1"}
            </span>
            {SET_TYPE_LABELS[type]}
          </span>
        ),
        onSelect: () => onPick(type),
      }))}
    />
  );
}
