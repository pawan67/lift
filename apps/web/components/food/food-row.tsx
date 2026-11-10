/**
 * One food in a list: name, what one serving is, calories and macros. The same
 * row in the diary, search results, recents, favourites and templates.
 *
 * The optional trailing button is the fast path: in the add dialog it logs a
 * recent food at its last amount without opening the amount step.
 */

"use client";

import { formatCalories, type NutrientValues } from "@lift/shared";
import { Check, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

import { MacroLine } from "./summary";

export function FoodRow({
  name,
  detail,
  nutrients,
  onClick,
  badge,
  trailing,
  menu,
  className,
}: {
  name: string;
  detail?: string;
  /** Figures for what the row stands for, already multiplied by quantity. */
  nutrients: NutrientValues;
  onClick?: () => void;
  /** Before the name: a star for favourites, a sparkle for AI. */
  badge?: ReactNode;
  trailing?: { label: string; onClick: () => void; done?: boolean; icon?: ReactNode };
  /** An `ActionMenu`, shown on hover and always on touch. */
  menu?: ReactNode;
  className?: string;
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {badge}
          <span className="truncate text-sm font-medium text-fg">{name}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-3">
          {detail ? <span className="truncate text-xs text-fg-3">{detail}</span> : null}
          <MacroLine values={nutrients} className="shrink-0" />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="tabular text-sm font-semibold text-fg">{formatCalories(nutrients.calories)}</div>
        <div className="text-[11px] text-fg-3">kcal</div>
      </div>
    </>
  );

  return (
    <div className={cn("group flex items-center gap-2 border-t border-line pr-3 first:border-t-0", className)}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-5 text-left transition-colors duration-150 hover:bg-surface-2/70 active:bg-surface-2 rounded-md"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-5">{body}</div>
      )}
      {menu ? <div className="shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">{menu}</div> : null}
      {trailing ? (
        <Tooltip content={trailing.label}>
          <button
            type="button"
            aria-label={trailing.label}
            onClick={trailing.onClick}
            className={cn(
              "press flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              trailing.done ? "bg-signal/15 text-signal" : "bg-volt-tint text-volt hover:bg-volt hover:text-volt-ink",
            )}
          >
            {trailing.done ? <Check size={16} /> : (trailing.icon ?? <Plus size={16} />)}
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}
