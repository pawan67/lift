"use client";

import { supersetPlacements } from "@lift/shared";
import { Copy, Dumbbell, Plus, Trash2 } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, type DragEvent } from "react";

import { HBarList } from "@/components/charts/charts";
import { ExerciseSelector } from "@/components/exercises/exercise-selector";
import { ExerciseBlock, type DragHandlers } from "@/components/routines/exercise-block";
import { DraftTextarea, TitleInput } from "@/components/routines/fields";
import { confirm, toast } from "@/components/ui/dialog";
import { Button, ButtonLink, Card, EmptyState, Select } from "@/components/ui/primitives";
import { useModel } from "@/lib/data/model";
import { useData } from "@/lib/data/store";
import {
  addExercisesToRoutine,
  deleteRoutine,
  duplicateRoutine,
  moveRoutineExercise,
  updateRoutine,
} from "@/lib/routines/repository";
import { lastDoneLabel, lastPerformance, routineFigures, routineMuscles } from "@/lib/routines/summary";

function RoutineEditor() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const model = useModel();
  const routine = model.routineById.get(id);
  const tombstoned = useData((state) => state.tables.routines.get(id)?.deletedAt != null);

  const [selecting, setSelecting] = useState(params.get("add") === "1");
  const [armed, setArmed] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ index: number; after: boolean } | null>(null);
  // Blocks present when the routine first renders; anything added later gets a short entrance.
  const [initialIds, setInitialIds] = useState<ReadonlySet<string> | null>(null);
  if (routine && initialIds === null) setInitialIds(new Set(routine.exercises.map((block) => block.row.id)));

  const placements = useMemo(() => supersetPlacements(routine?.exercises.map((block) => block.row) ?? []), [routine]);
  const figures = useMemo(() => (routine ? routineFigures(routine) : null), [routine]);
  const muscles = useMemo(() => (routine ? routineMuscles(routine) : []), [routine]);
  const lasts = useMemo(
    () => new Map(routine?.exercises.map((block) => [block.row.exerciseId, lastPerformance(model, block.row.exerciseId)]) ?? []),
    [routine, model],
  );

  if (!routine || !figures) {
    return (
      <Card className="mx-auto mt-6 max-w-lg">
        <EmptyState
          title={tombstoned ? "This routine was deleted" : "Routine not found"}
          body={tombstoned ? "It was removed on this or another device." : "It may not have synced to this browser yet."}
          action={
            <ButtonLink href="/routines" variant="secondary">
              Back to routines
            </ButtonLink>
          }
        />
      </Card>
    );
  }

  const exerciseIds = routine.exercises.map((block) => block.row.exerciseId);

  const onMove = (from: number, to: number) => {
    if (to < 0 || to >= routine.exercises.length || from === to) return;
    void moveRoutineExercise(routine.id, from, to);
  };

  const dragHandlers = (index: number): DragHandlers => ({
    draggable: armed === index,
    dragging: dragFrom === index,
    dropBefore: drop?.index === index && !drop.after && dragFrom !== null,
    dropAfter: drop?.index === index && drop.after && dragFrom !== null,
    onArm: () => setArmed(index),
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
      setDragFrom(index);
    },
    onDragOver: (event: DragEvent) => {
      if (dragFrom === null) return;
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      const after = event.clientY > box.top + box.height / 2;
      if (drop?.index !== index || drop.after !== after) setDrop({ index, after });
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      if (dragFrom !== null && drop) {
        const target = drop.after ? drop.index + 1 : drop.index;
        onMove(dragFrom, target > dragFrom ? target - 1 : target);
      }
      setDragFrom(null);
      setDrop(null);
      setArmed(null);
    },
    onDragEnd: () => {
      setDragFrom(null);
      setDrop(null);
      setArmed(null);
    },
  });

  const onDuplicate = async () => {
    const copy = await duplicateRoutine(routine.id);
    if (copy) {
      toast(`Duplicated “${routine.name}”`);
      router.push(`/routines/${copy}`);
    }
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: `Delete “${routine.name}”?`,
      body: "The routine is removed from every device. Sessions you already logged from it stay in your history.",
      confirmLabel: "Delete routine",
      destructive: true,
    });
    if (!ok) return;
    router.replace("/routines");
    await deleteRoutine(routine.id);
    toast("Routine deleted");
  };

  return (
    <>
      <div className="mb-6">
        <button
          type="button"
          onClick={() => router.push("/routines")}
          className="group mb-3 inline-flex items-center gap-1 text-[13px] text-fg-3 transition-colors duration-150 hover:text-fg"
        >
          <span aria-hidden className="transition-transform duration-150 ease-out group-hover:-translate-x-0.5">←</span> Routines
        </button>
        <TitleInput aria-label="Routine name" value={routine.name} maxLength={80} onCommit={(name) => void updateRoutine(routine.id, { name })} />
        <p className="tabular mt-1.5 text-sm text-fg-3">
          <span className="text-fg-2">
            {figures.exercises} exercise{figures.exercises === 1 ? "" : "s"} · {figures.sets} set{figures.sets === 1 ? "" : "s"}
            {figures.minutes ? ` · ~${figures.minutes} min` : ""}
          </span>
          <span className="mx-2 text-fg-3/50">/</span>
          {lastDoneLabel(routine.lastPerformedAt)}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <DraftTextarea
            aria-label="Routine notes"
            value={routine.row.notes ?? ""}
            placeholder="Notes for the whole routine: the plan, cues, how to progress"
            rows={2}
            maxLength={2000}
            onCommit={(notes) => void updateRoutine(routine.id, { notes })}
          />

          {routine.exercises.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Dumbbell size={28} />}
                title="No exercises yet"
                body="Add the exercises in the order you do them, then set the targets for each set."
                action={
                  <Button variant="primary" onClick={() => setSelecting(true)}>
                    <Plus size={16} /> Add exercises
                  </Button>
                }
              />
            </Card>
          ) : (
            <div onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node) && setDrop(null)}>
              {routine.exercises.map((block, index) => {
                const placement = placements.get(block.row.id);
                const next = routine.exercises[index + 1];
                const linkedToNext = placement !== undefined && next !== undefined && placements.get(next.row.id)?.group === placement.group;
                return (
                  <div key={block.row.id} className={linkedToNext ? "" : "mb-3"}>
                    <ExerciseBlock
                      routineId={routine.id}
                      block={block}
                      index={index}
                      count={routine.exercises.length}
                      placement={placement}
                      linkedToNext={linkedToNext}
                      last={lasts.get(block.row.exerciseId) ?? null}
                      onMove={onMove}
                      drag={dragHandlers(index)}
                      entering={initialIds !== null && !initialIds.has(block.row.id)}
                    />
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => setSelecting(true)}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-(--radius-card) border border-dashed border-line-strong text-sm font-medium text-fg-2 transition-colors duration-150 hover:bg-surface-2 hover:text-fg active:bg-surface-3"
              >
                <Plus size={16} /> Add exercises
              </button>
            </div>
          )}
        </div>

        {/* Sidebar: plain sections on the page, split by hairlines, so the exercise cards stay the only boxes. */}
        <aside className="divide-y divide-line lg:sticky lg:top-8 lg:self-start">
          {muscles.length > 0 ? (
            <section className="pb-5">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold tracking-tight text-fg">Sets per muscle</h2>
                <span className="text-xs text-fg-3">secondary count half</span>
              </div>
              <HBarList
                items={muscles.slice(0, 8).map((entry) => ({ key: entry.muscle, label: entry.label, value: entry.sets }))}
                format={(sets) => (Number.isInteger(sets) ? String(sets) : sets.toFixed(1))}
              />
            </section>
          ) : null}

          <section className="space-y-3 py-5 first:pt-0">
            <label className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-fg-2">Folder</span>
              <Select
                className="h-8 w-44 rounded-md text-[13px]"
                value={routine.row.folderId && model.folders.some((folder) => folder.id === routine.row.folderId) ? routine.row.folderId : ""}
                onChange={(event) => void updateRoutine(routine.id, { folderId: event.target.value || null })}
              >
                <option value="">No folder</option>
                {model.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => void onDuplicate()}>
                <Copy size={14} /> Duplicate
              </Button>
              <Button variant="danger" size="sm" className="flex-1" onClick={() => void onDelete()}>
                <Trash2 size={14} /> Delete
              </Button>
            </div>
          </section>
        </aside>
      </div>

      <ExerciseSelector
        open={selecting}
        onClose={() => {
          setSelecting(false);
          // Drop `?add=1` so a reload does not reopen the selector.
          if (params.get("add")) router.replace(`/routines/${routine.id}`);
        }}
        onSelect={(ids) => {
          if (ids.length === 0) return;
          void addExercisesToRoutine(routine.id, ids).then(() =>
            toast(ids.length === 1 ? "Exercise added" : `${ids.length} exercises added`),
          );
        }}
        multiple
        excludeIds={exerciseIds}
        context={exerciseIds}
        title={`Add to ${routine.name}`}
        confirmLabel="Add to routine"
      />
    </>
  );
}

export default function RoutineEditorPage() {
  return (
    <Suspense>
      <RoutineEditor />
    </Suspense>
  );
}
