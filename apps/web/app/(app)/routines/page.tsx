"use client";

import { reorder } from "@lift/shared";
import { ArrowDown, ArrowUp, Copy, Folder, FolderInput, FolderPlus, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { FolderDialog } from "@/components/routines/folder-dialog";
import { ActionMenu } from "@/components/routines/menu";
import { NameDialog } from "@/components/routines/name-dialog";
import { confirm, toast } from "@/components/ui/dialog";
import { Button, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { useModel, type RoutineView } from "@/lib/data/model";
import type { RoutineFolderRow } from "@/lib/data/types";
import {
  applyFolderOrder,
  applyRoutineOrder,
  createFolder,
  deleteFolder,
  deleteRoutine,
  duplicateRoutine,
  moveRoutineToFolder,
  renameFolder,
} from "@/lib/routines/repository";
import { lastDoneLabel, lastDoneShort, routineFigures } from "@/lib/routines/summary";

interface Group {
  folder: RoutineFolderRow | null;
  routines: RoutineView[];
}

export default function RoutinesPage() {
  const model = useModel();
  const router = useRouter();
  const [newFolder, setNewFolder] = useState(false);
  const [renaming, setRenaming] = useState<RoutineFolderRow | null>(null);
  const [moving, setMoving] = useState<RoutineView | null>(null);

  const groups = useMemo<Group[]>(() => {
    const folderIds = new Set(model.folders.map((folder) => folder.id));
    const byFolder = new Map<string | null, RoutineView[]>();
    for (const routine of model.routines) {
      const key = routine.row.folderId && folderIds.has(routine.row.folderId) ? routine.row.folderId : null;
      const list = byFolder.get(key);
      if (list) list.push(routine);
      else byFolder.set(key, [routine]);
    }
    return [
      ...model.folders.map((folder) => ({ folder, routines: byFolder.get(folder.id) ?? [] })),
      { folder: null, routines: byFolder.get(null) ?? [] },
    ];
  }, [model]);

  const moveRoutine = (group: Group, index: number, to: number) => {
    const rows = group.routines.map((routine) => ({ id: routine.id, position: routine.row.position }));
    void applyRoutineOrder(reorder(rows, index, to));
  };

  const moveFolder = (index: number, to: number) => {
    void applyFolderOrder(reorder(model.folders, index, to));
  };

  const onDuplicate = async (routine: RoutineView) => {
    const id = await duplicateRoutine(routine.id);
    if (id) toast(`Duplicated “${routine.name}”`);
  };

  const onDelete = async (routine: RoutineView) => {
    const ok = await confirm({
      title: `Delete “${routine.name}”?`,
      body: "The routine is removed from every device. Sessions you already logged from it stay in your history.",
      confirmLabel: "Delete routine",
      destructive: true,
    });
    if (!ok) return;
    await deleteRoutine(routine.id);
    toast("Routine deleted");
  };

  const onDeleteFolder = async (folder: RoutineFolderRow, count: number) => {
    const ok = await confirm({
      title: `Delete folder “${folder.name}”?`,
      body: count > 0 ? `Its ${count} routine${count === 1 ? "" : "s"} will be kept and moved out of the folder.` : undefined,
      confirmLabel: "Delete folder",
      destructive: true,
    });
    if (ok) await deleteFolder(folder.id);
  };

  const total = model.routines.length;
  const hasFolders = model.folders.length > 0;

  return (
    <>
      <PageHeader
        title="Routines"
        subtitle={total === 0 ? "Plan your sessions here; they appear on your phone, ready to start." : `${total} routine${total === 1 ? "" : "s"}${hasFolders ? ` in ${model.folders.length} folder${model.folders.length === 1 ? "" : "s"}` : ""}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setNewFolder(true)}>
              <FolderPlus size={16} /> New folder
            </Button>
            <ButtonLink href="/routines/new" variant="primary">
              <Plus size={16} /> New routine
            </ButtonLink>
          </>
        }
      />

      {total === 0 && !hasFolders ? (
        <Card>
          <EmptyState
            icon={<ListChecks size={28} />}
            title="No routines yet"
            body="A routine is a session you run again and again: the exercises, their order, and the sets you aim for."
            action={
              <ButtonLink href="/routines/new" variant="primary">
                <Plus size={16} /> Create a routine
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <div className="space-y-8">
          {groups.map((group, groupIndex) => {
            const folderIndex = group.folder ? groupIndex : -1;
            if (!group.folder && group.routines.length === 0) return null;
            return (
              <section key={group.folder?.id ?? "none"}>
                {group.folder || hasFolders ? (
                  <div className="mb-2 flex h-8 items-center gap-2">
                    {group.folder ? <Folder size={15} className="text-fg-3" /> : null}
                    <h2 className="text-sm font-semibold tracking-tight text-fg">{group.folder?.name ?? "Not in a folder"}</h2>
                    <span className="tabular text-xs text-fg-3">{group.routines.length}</span>
                    {group.folder ? (
                      <ActionMenu
                        className="ml-auto"
                        label={`Folder actions for ${group.folder.name}`}
                        items={[
                          {
                            label: "New routine here",
                            icon: <Plus size={15} />,
                            onSelect: () => router.push(`/routines/new?folder=${group.folder!.id}`),
                          },
                          { label: "Rename", icon: <Pencil size={15} />, onSelect: () => setRenaming(group.folder) },
                          { label: "Move up", icon: <ArrowUp size={15} />, disabled: folderIndex === 0, onSelect: () => moveFolder(folderIndex, folderIndex - 1) },
                          {
                            label: "Move down",
                            icon: <ArrowDown size={15} />,
                            disabled: folderIndex === model.folders.length - 1,
                            onSelect: () => moveFolder(folderIndex, folderIndex + 1),
                          },
                          null,
                          {
                            label: "Delete folder",
                            icon: <Trash2 size={15} />,
                            destructive: true,
                            onSelect: () => void onDeleteFolder(group.folder!, group.routines.length),
                          },
                        ]}
                      />
                    ) : null}
                  </div>
                ) : null}

                {group.routines.length === 0 ? (
                  <div className="rounded-(--radius-card) border border-dashed border-line px-4 py-4 text-sm text-fg-3">
                    Empty folder.{" "}
                    <Link href={`/routines/new?folder=${group.folder?.id}`} className="text-volt hover:underline">
                      Create a routine in it
                    </Link>{" "}
                    or move one here.
                  </div>
                ) : (
                  <Card className="overflow-visible">
                    {group.routines.map((routine, index) => (
                      <RoutineRow
                        key={routine.id}
                        routine={routine}
                        menu={[
                          { label: "Edit", icon: <Pencil size={15} />, onSelect: () => router.push(`/routines/${routine.id}`) },
                          { label: "Duplicate", icon: <Copy size={15} />, onSelect: () => void onDuplicate(routine) },
                          { label: "Move to folder", icon: <FolderInput size={15} />, onSelect: () => setMoving(routine) },
                          { label: "Move up", icon: <ArrowUp size={15} />, disabled: index === 0, onSelect: () => moveRoutine(group, index, index - 1) },
                          {
                            label: "Move down",
                            icon: <ArrowDown size={15} />,
                            disabled: index === group.routines.length - 1,
                            onSelect: () => moveRoutine(group, index, index + 1),
                          },
                          null,
                          { label: "Delete", icon: <Trash2 size={15} />, destructive: true, onSelect: () => void onDelete(routine) },
                        ]}
                      />
                    ))}
                  </Card>
                )}
              </section>
            );
          })}
        </div>
      )}

      <NameDialog
        open={newFolder}
        onClose={() => setNewFolder(false)}
        title="New folder"
        placeholder="e.g. Upper / Lower"
        confirmLabel="Create folder"
        onSubmit={async (name) => {
          await createFolder(name);
        }}
      />
      <NameDialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename folder"
        initial={renaming?.name ?? ""}
        onSubmit={async (name) => {
          if (renaming) await renameFolder(renaming.id, name);
        }}
      />
      <FolderDialog
        open={moving !== null}
        onClose={() => setMoving(null)}
        folders={model.folders}
        current={moving?.row.folderId ?? null}
        onPick={(folderId) => {
          if (moving) void moveRoutineToFolder(moving.id, folderId);
        }}
      />
    </>
  );
}

/**
 * One routine as a row: name and its exercises on the left, the figures in
 * aligned columns, when it was last done, then its menu. A table reads faster
 * than a wall of identical cards once there are more than a handful.
 */
function RoutineRow({ routine, menu }: { routine: RoutineView; menu: Parameters<typeof ActionMenu>[0]["items"] }) {
  const figures = routineFigures(routine);
  const names = routine.exercises.map((block) => block.exercise?.name ?? "Unknown exercise");
  const done = lastDoneLabel(routine.lastPerformedAt);

  return (
    <div className="relative border-t border-line first:border-t-0 [&:first-child>a]:rounded-t-xl [&:last-child>a]:rounded-b-xl">
      <Link
        href={`/routines/${routine.id}`}
        aria-label={`Edit ${routine.name}`}
        className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-1 py-3 pr-12 pl-4 transition-colors duration-150 hover:bg-surface-2/70 active:bg-surface-2 md:grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_4.5rem_8.5rem] md:items-center"
      >
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-tight text-fg">{routine.name}</h3>
          <p className="mt-0.5 truncate text-[13px] text-fg-3" title={names.join(", ")}>
            {names.length > 0 ? names.join(", ") : "No exercises yet"}
          </p>
        </div>
        {/* Wide: one aligned column per figure. Narrow: a single line under the name. */}
        <Figure value={figures.exercises} unit={figures.exercises === 1 ? "exercise" : "exercises"} short="ex" />
        <Figure value={figures.sets} unit={figures.sets === 1 ? "set" : "sets"} short="sets" />
        <Figure value={figures.minutes ? `~${figures.minutes}` : "–"} unit="min" short="min" />
        <p className="hidden text-right text-xs text-fg-3 md:block">{lastDoneShort(routine.lastPerformedAt)}</p>
        <p className="tabular text-xs text-fg-3 md:hidden">
          {figures.exercises} exercise{figures.exercises === 1 ? "" : "s"} · {figures.sets} set{figures.sets === 1 ? "" : "s"}
          {figures.minutes ? ` · ~${figures.minutes} min` : ""} · {done}
        </p>
      </Link>
      <ActionMenu className="absolute top-1/2 right-2 -translate-y-1/2" label={`Actions for ${routine.name}`} items={menu} />
    </div>
  );
}

function Figure({ value, unit, short }: { value: number | string; unit: string; short: string }) {
  return (
    <p className="tabular hidden text-right text-sm text-fg md:block" title={`${value} ${unit}`}>
      {value} <span className="text-xs text-fg-3">{short}</span>
    </p>
  );
}
