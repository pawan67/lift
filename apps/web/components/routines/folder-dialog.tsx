/** Picks a folder for a routine, or none. */

"use client";

import { Check, Folder, FolderMinus } from "lucide-react";

import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import type { RoutineFolderRow } from "@/lib/data/types";

export function FolderDialog({
  open,
  onClose,
  folders,
  current,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  folders: readonly RoutineFolderRow[];
  current: string | null;
  onPick: (folderId: string | null) => void;
}) {
  const options: { id: string | null; name: string }[] = [{ id: null, name: "No folder" }, ...folders.map((folder) => ({ id: folder.id, name: folder.name }))];

  return (
    <Dialog open={open} onClose={onClose} title="Move to folder" size="sm">
      <ul className="py-2">
        {options.map((option) => {
          const selected = option.id === current;
          return (
            <li key={option.id ?? "none"}>
              <button
                type="button"
                onClick={() => {
                  onPick(option.id);
                  onClose();
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm transition-colors hover:bg-surface-2",
                  selected ? "text-fg" : "text-fg-2",
                )}
              >
                {option.id === null ? <FolderMinus size={16} className="text-fg-3" /> : <Folder size={16} className="text-fg-3" />}
                <span className="flex-1 truncate">{option.name}</span>
                {selected ? <Check size={16} className="text-volt" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
