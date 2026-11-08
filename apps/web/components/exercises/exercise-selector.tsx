/**
 * Picks exercises for a routine.
 *
 * Opens on what is most likely wanted: exercises that go with what the routine
 * already holds (`suggestExercises`, the phone's ranking), then the lifts
 * trained most recently, then the whole catalog with this person's lifts
 * first. Typing ranks by name, with training history breaking ties. All 6,800
 * rows are one virtualised list, so it opens and filters without a stall.
 *
 * Several can be picked before confirming; the order they were picked in is
 * the order they are added. When the search finds nothing, the same query can
 * become a custom exercise without leaving the dialog.
 */

"use client";

import { suggestExercises } from "@lift/shared/exercises/search";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Dialog } from "@/components/ui/dialog";
import { Badge, Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useModel, type ExerciseInfo } from "@/lib/data/model";
import { exerciseSubtitle } from "@/lib/exercises/labels";
import { useEquipmentCounts, useExerciseQuery, useFilteredExercises, useMuscleCounts } from "@/lib/exercises/search";
import { relativeDay } from "@/lib/format";

import { ExerciseForm } from "./exercise-form";
import { ExerciseFilters, SearchBox } from "./filters";
import { ExerciseThumb } from "./exercise-thumb";

export interface ExerciseSelectorProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen ids, in the order they were picked. The selector closes itself afterwards via onClose. */
  onSelect: (exerciseIds: string[]) => void;
  /** Allow picking several before confirming. Default true. */
  multiple?: boolean;
  /** Ids already in the routine: shown as added, not selectable. */
  excludeIds?: readonly string[];
  /** Ids already in the routine, used to rank suggestions ("goes with what you have"). */
  context?: readonly string[];
  title?: string;
  confirmLabel?: string;
}

export function ExerciseSelector(props: ExerciseSelectorProps) {
  const { open, onClose, title = "Add exercises" } = props;
  return (
    <Dialog open={open} onClose={onClose} title={title} size="full">
      {/* Mounted only while open, so every opening starts from a clean search. */}
      {open ? <SelectorBody {...props} /> : null}
    </Dialog>
  );
}

type Item =
  | { kind: "header"; key: string; label: string }
  | { kind: "exercise"; key: string; exercise: ExerciseInfo };

const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 60;
const SECTION_SIZE = 6;
const NONE: readonly string[] = [];

function SelectorBody({
  onClose,
  onSelect,
  multiple = true,
  excludeIds = NONE,
  context,
  confirmLabel,
}: ExerciseSelectorProps) {
  const model = useModel();
  const query = useExerciseQuery();
  const filtered = useFilteredExercises(model, query);
  const muscleCounts = useMuscleCounts(model);
  const equipmentCounts = useEquipmentCounts(model);

  const [picked, setPicked] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const [creating, setCreating] = useState(false);

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (!query.narrowed) {
      const suggestions = suggestExercises({
        catalog: model.exerciseList,
        index: model.trainingIndex,
        context: [...(context ?? excludeIds)],
        limit: SECTION_SIZE,
      });
      if (suggestions.length > 0) {
        out.push({ kind: "header", key: "h-suggested", label: context?.length || excludeIds.length ? "Goes with this routine" : "Suggested" });
        for (const exercise of suggestions) out.push({ kind: "exercise", key: `s-${exercise.id}`, exercise });
      }

      const shown = new Set(suggestions.map((exercise) => exercise.id));
      const recent = [...model.trainingIndex.usage.entries()]
        .sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt)
        .map(([id]) => model.exercises.get(id))
        .filter((exercise): exercise is ExerciseInfo => !!exercise && !exercise.isArchived && !shown.has(exercise.id))
        .slice(0, SECTION_SIZE);
      if (recent.length > 0) {
        out.push({ kind: "header", key: "h-recent", label: "Recently trained" });
        for (const exercise of recent) out.push({ kind: "exercise", key: `r-${exercise.id}`, exercise });
      }

      out.push({ kind: "header", key: "h-all", label: `All exercises · ${filtered.length.toLocaleString()}` });
    } else if (filtered.length > 0) {
      out.push({ kind: "header", key: "h-results", label: `${filtered.length.toLocaleString()} result${filtered.length === 1 ? "" : "s"}` });
    }
    for (const exercise of filtered) out.push({ kind: "exercise", key: `a-${exercise.id}`, exercise });
    return out;
  }, [model, filtered, query.narrowed, context, excludeIds]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (items[index]!.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT),
    overscan: 10,
    getItemKey: (index) => items[index]!.key,
  });

  // A new result set starts at the top with nothing highlighted.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
    setActive(-1);
  }, [filtered]);

  const choose = useCallback(
    (exercise: ExerciseInfo) => {
      if (excluded.has(exercise.id)) return;
      if (!multiple) {
        onSelect([exercise.id]);
        onClose();
        return;
      }
      setPicked((current) => (current.includes(exercise.id) ? current.filter((id) => id !== exercise.id) : [...current, exercise.id]));
    },
    [excluded, multiple, onClose, onSelect],
  );

  const confirm = () => {
    if (picked.length === 0) return;
    onSelect(picked);
    onClose();
  };

  const move = (step: 1 | -1) => {
    if (items.length === 0) return;
    let next = active;
    for (let guard = 0; guard < items.length; guard += 1) {
      next += step;
      if (next < 0 || next >= items.length) return;
      if (items[next]!.kind === "exercise") break;
    }
    setActive(next);
    virtualizer.scrollToIndex(next, { align: "auto" });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[active];
      if (item?.kind === "exercise") choose(item.exercise);
      else if ((event.metaKey || event.ctrlKey) && picked.length > 0) confirm();
      else if (active < 0 && query.search.trim() && filtered.length > 0) choose(filtered[0]!);
    }
  };

  if (creating) {
    return (
      <div className="p-5">
        <p className="mb-5 text-sm text-fg-3">A custom exercise syncs to your phone like any other.</p>
        <ExerciseForm
          compact
          initialName={query.search.trim()}
          submitLabel={multiple ? "Create and select" : "Create and add"}
          onCancel={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            query.setSearch("");
            if (!multiple) {
              onSelect([id]);
              onClose();
              return;
            }
            setPicked((current) => [...current, id]);
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
        />
      </div>
    );
  }

  const search = query.search.trim();

  return (
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <div className="space-y-3 border-b border-line px-5 pt-4 pb-3">
        <SearchBox ref={searchRef} value={query.search} onChange={query.setSearch} autoFocus />
        <ExerciseFilters
          muscles={query.muscles}
          onMusclesChange={query.setMuscles}
          equipment={query.equipment}
          onEquipmentChange={query.setEquipment}
          muscleCounts={muscleCounts}
          equipmentCounts={equipmentCounts}
        />
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-multiselectable={multiple} aria-label="Exercises">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <p className="text-sm font-medium text-fg">No exercise matches{search ? ` “${search}”` : " these filters"}</p>
            <p className="mt-1 text-sm text-fg-3">Check the spelling, clear a filter, or add it as your own.</p>
            <Button className="mt-4" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> Create {search ? `“${search}”` : "custom exercise"}
            </Button>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize() }} className="relative">
            {virtualizer.getVirtualItems().map((row) => {
              const item = items[row.index]!;
              if (item.kind === "header") {
                return (
                  <div
                    key={row.key}
                    style={{ transform: `translateY(${row.start}px)`, height: row.size }}
                    className="absolute inset-x-0 top-0 flex items-end px-5 pb-1.5 font-mono text-[10px] tracking-widest text-fg-3 uppercase"
                  >
                    {item.label}
                  </div>
                );
              }
              const exercise = item.exercise;
              const order = picked.indexOf(exercise.id);
              const added = excluded.has(exercise.id);
              const usage = model.trainingIndex.usage.get(exercise.id);
              return (
                <button
                  key={row.key}
                  type="button"
                  role="option"
                  aria-selected={order >= 0}
                  aria-disabled={added}
                  tabIndex={-1}
                  onClick={() => choose(exercise)}
                  onMouseMove={() => active !== row.index && setActive(row.index)}
                  style={{ transform: `translateY(${row.start}px)`, height: row.size }}
                  className={cn(
                    "absolute inset-x-0 top-0 flex items-center gap-3 px-5 text-left transition-colors",
                    active === row.index && !added && "bg-surface-2",
                    added && "cursor-default opacity-45",
                  )}
                >
                  <ExerciseThumb exercise={exercise} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className={cn("truncate text-sm", order >= 0 ? "font-medium text-volt" : "text-fg")}>{exercise.name}</div>
                    <div className="truncate text-xs text-fg-3">
                      {exerciseSubtitle(exercise)}
                      {usage ? ` · ${usage.uses}× · ${relativeDay(usage.lastUsedAt)}` : ""}
                    </div>
                  </div>
                  {exercise.isCustom ? <Badge>Custom</Badge> : null}
                  {added ? (
                    <Badge tone="neutral">Added</Badge>
                  ) : multiple ? (
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular",
                        order >= 0 ? "border-volt bg-volt text-volt-ink" : "border-line-strong text-transparent",
                      )}
                    >
                      {order >= 0 ? order + 1 : <Check size={12} />}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
        {filtered.length > 0 && search ? (
          <div className="border-t border-line px-5 py-3">
            <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-2 text-sm text-fg-2 hover:text-volt">
              <Plus size={15} /> Not here? Create “{search}” as a custom exercise
            </button>
          </div>
        ) : null}
      </div>

      {multiple ? (
        <div className="flex items-center gap-3 border-t border-line bg-surface px-5 py-3">
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {picked.length === 0 ? (
              <span className="text-sm text-fg-3">
                Pick one or more<span className="hidden sm:inline">. They are added in the order you pick them.</span>
              </span>
            ) : (
              picked.map((id, index) => {
                const exercise = model.exercises.get(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPicked((current) => current.filter((entry) => entry !== id))}
                    className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-surface-3 pr-2 pl-1 text-xs text-fg hover:bg-surface-4"
                    title="Remove"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-volt text-[10px] font-semibold text-volt-ink">{index + 1}</span>
                    <span className="max-w-40 truncate">{exercise?.name ?? "Exercise"}</span>
                    <X size={12} className="text-fg-3" />
                  </button>
                );
              })
            )}
          </div>
          <Button variant="primary" onClick={confirm} disabled={picked.length === 0}>
            {confirmLabel ?? (picked.length > 1 ? `Add ${picked.length} exercises` : "Add exercise")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
