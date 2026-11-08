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
import { lastDoneLabel, routineFigures } from "@/lib/routines/summary";

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
        <div className="space-y-10">
          {groups.map((group, groupIndex) => {
            const folderIndex = group.folder ? groupIndex : -1;
            if (!group.folder && group.routines.length === 0) return null;
            return (
              <section key={group.folder?.id ?? "none"}>
                {group.folder || hasFolders ? (
                  <div className="mb-3 flex items-center gap-2">
                    {group.folder ? <Folder size={16} className="text-fg-3" /> : null}
                    <h2 className="text-sm font-semibold text-fg">{group.folder?.name ?? "Not in a folder"}</h2>
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
                  <div className="rounded-(--radius-card) border border-dashed border-line px-5 py-6 text-center text-sm text-fg-3">
                    Empty folder.{" "}
                    <Link href={`/routines/new?folder=${group.folder?.id}`} className="text-volt hover:underline">
                      Create a routine in it
                    </Link>{" "}
                    or move one here.
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {group.routines.map((routine, index) => (
                      <RoutineCard
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
                  </div>
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

function RoutineCard({ routine, menu }: { routine: RoutineView; menu: Parameters<typeof ActionMenu>[0]["items"] }) {
  const figures = routineFigures(routine);
  const names = routine.exercises.map((block) => block.exercise?.name ?? "Unknown exercise");
  const shown = names.slice(0, 4);

  return (
    <Card className="group relative transition-colors hover:border-line-strong">
      <Link href={`/routines/${routine.id}`} className="block px-5 pt-4 pb-4" aria-label={`Edit ${routine.name}`}>
        <div className="pr-10">
          <h3 className="truncate text-[15px] font-semibold text-fg">{routine.name}</h3>
          <p className="tabular mt-0.5 text-xs text-fg-3">
            {figures.exercises} exercise{figures.exercises === 1 ? "" : "s"} · {figures.sets} set{figures.sets === 1 ? "" : "s"}
            {figures.minutes ? ` · ~${figures.minutes} min` : ""}
          </p>
        </div>
        {shown.length > 0 ? (
          <p className="mt-3 line-clamp-2 text-sm text-fg-2">
            {shown.join(", ")}
            {names.length > shown.length ? <span className="text-fg-3"> +{names.length - shown.length} more</span> : null}
          </p>
        ) : (
          <p className="mt-3 text-sm text-fg-3">No exercises yet</p>
        )}
        <p className="mt-3 text-xs text-fg-3">
          {lastDoneLabel(routine.lastPerformedAt)}
        </p>
      </Link>
      <ActionMenu className="absolute top-3 right-3" label={`Actions for ${routine.name}`} items={menu} />
    </Card>
  );
}

