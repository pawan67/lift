"use client";

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

import { ExerciseFilters, SearchBox } from "@/components/exercises/filters";
import { ExerciseThumb } from "@/components/exercises/exercise-thumb";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Segmented } from "@/components/ui/primitives";
import { useModel } from "@/lib/data/model";
import { exerciseSubtitle } from "@/lib/exercises/labels";
import {
  useEquipmentCounts,
  useExerciseQuery,
  useFilteredExercises,
  useMuscleCounts,
  type ExerciseScope,
} from "@/lib/exercises/search";
import { relativeDay } from "@/lib/format";

const ROW_HEIGHT = 64;

const SCOPES: { value: ExerciseScope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "trained", label: "Trained" },
  { value: "custom", label: "Custom" },
];

export default function ExercisesPage() {
  const model = useModel();
  const query = useExerciseQuery();
  const rows = useFilteredExercises(model, query);
  const muscleCounts = useMuscleCounts(model);
  const equipmentCounts = useEquipmentCounts(model);

  const listRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);

  // The window scrolls, not the list, so the virtualiser needs to know where the list starts.
  useLayoutEffect(() => {
    const measure = () => setOffset(listRef.current ? listRef.current.getBoundingClientRect().top + window.scrollY : 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollMargin: offset,
    getItemKey: (index) => rows[index]!.id,
  });

  const customCount = model.exerciseList.filter((exercise) => exercise.isCustom).length;
  const trainedCount = model.trainingIndex.usage.size;

  return (
    <>
      <PageHeader
        title="Exercises"
        subtitle={`${model.exerciseList.length.toLocaleString()} in the library · ${trainedCount} trained${customCount ? ` · ${customCount} custom` : ""}`}
        actions={
          <ButtonLink href="/exercises/new" variant="primary">
            <Plus size={16} /> New exercise
          </ButtonLink>
        }
      />

      <div className="mb-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchBox value={query.search} onChange={query.setSearch} className="flex-1" autoFocus />
          <Segmented value={query.scope} onChange={query.setScope} options={SCOPES} />
        </div>
        <ExerciseFilters
          muscles={query.muscles}
          onMusclesChange={query.setMuscles}
          equipment={query.equipment}
          onEquipmentChange={query.setEquipment}
          muscleCounts={muscleCounts}
          equipmentCounts={equipmentCounts}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-xs text-fg-3 sm:px-5">
          <span className="tabular flex-1">
            {rows.length.toLocaleString()} exercise{rows.length === 1 ? "" : "s"}
          </span>
          <span className="hidden w-16 text-right sm:block">Sessions</span>
          <span className="hidden w-24 text-right sm:block">Last trained</span>
        </div>

        <div ref={listRef}>
        {rows.length === 0 ? (
          <EmptyState
            title={query.scope === "custom" && !query.narrowed ? "No custom exercises yet" : "Nothing matches"}
            body={
              query.scope === "custom" && !query.narrowed
                ? "Create one for a movement the library does not have. It syncs to your phone."
                : "Try a different word, or clear the filters."
            }
            action={
              <ButtonLink href="/exercises/new" variant="secondary">
                <Plus size={15} /> New exercise
              </ButtonLink>
            }
          />
        ) : (
          <div style={{ height: virtualizer.getTotalSize() }} className="relative">
            {virtualizer.getVirtualItems().map((item) => {
              const exercise = rows[item.index]!;
              const usage = model.trainingIndex.usage.get(exercise.id);
              return (
                <Link
                  key={item.key}
                  href={`/exercises/${encodeURIComponent(exercise.id)}`}
                  style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`, height: ROW_HEIGHT }}
                  className="absolute inset-x-0 top-0 flex items-center gap-3 border-b border-line px-4 transition-colors duration-150 hover:bg-surface-2/70 active:bg-surface-2 sm:px-5"
                >
                  <ExerciseThumb exercise={exercise} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg">{exercise.name}</span>
                      {exercise.isCustom ? <Badge>Custom</Badge> : null}
                      {exercise.isArchived ? <Badge tone="warn">Archived</Badge> : null}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-fg-3">{exerciseSubtitle(exercise)}</div>
                  </div>
                  {usage ? (
                    <>
                      {/* Phone: one stacked figure. Desktop: two columns under the header labels. */}
                      <div className="shrink-0 text-right sm:hidden">
                        <div className="tabular text-sm text-fg">{usage.uses}×</div>
                        <div className="text-xs text-fg-3">{relativeDay(usage.lastUsedAt)}</div>
                      </div>
                      <span className="tabular hidden w-16 shrink-0 text-right text-sm text-fg sm:block">{usage.uses}</span>
                      <span className="hidden w-24 shrink-0 text-right text-[13px] text-fg-2 sm:block">{relativeDay(usage.lastUsedAt)}</span>
                    </>
                  ) : null}
                </Link>
              );
            })}
          </div>
        )}
        </div>
      </Card>
    </>
  );
}
