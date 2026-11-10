/**
 * Search box plus the muscle and equipment filters, for the library and the
 * selector alike.
 *
 * The filters open inline under the search rather than in a popover: the
 * selector lives in a scrolling dialog, where a floating panel would be
 * clipped, and inline chips read the same in both places. Muscles are grouped
 * by body part, the way the phone's body map groups them, so "legs" is one
 * glance rather than a scan of twenty-one chips.
 */

"use client";

import {
  BODY_PARTS,
  BODY_PART_LABELS,
  EQUIPMENT,
  EQUIPMENT_LABELS,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  MUSCLE_TO_BODY_PART,
  type Equipment,
  type MuscleGroup,
} from "@lift/shared";
import { ChevronDown, Search, X } from "lucide-react";
import { forwardRef, useState, type KeyboardEvent } from "react";

import { Chip } from "@/components/ui/chip";
import { fieldClass } from "@/components/ui/input";
import { cn } from "@/lib/cn";

const MUSCLES_BY_PART = BODY_PARTS.map((part) => ({
  part,
  muscles: MUSCLE_GROUPS.filter((muscle) => MUSCLE_TO_BODY_PART[muscle] === part),
})).filter((group) => group.muscles.length > 0);

export const SearchBox = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    autoFocus?: boolean;
    className?: string;
  }
>(function SearchBox({ value, onChange, placeholder = "Search exercises", onKeyDown, autoFocus, className }, ref) {
  return (
    <div className={cn("relative", className)}>
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3" />
      <input
        ref={ref}
        type="search"
        value={value}
        autoFocus={autoFocus}
        data-autofocus={autoFocus ? "" : undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={fieldClass({ className: "h-10 pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden" })}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-fg-3 transition-colors duration-150 hover:bg-surface-3 hover:text-fg"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
});

function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function summary(labels: string[], fallback: string): string {
  if (labels.length === 0) return fallback;
  if (labels.length === 1) return labels[0]!;
  return `${labels[0]} +${labels.length - 1}`;
}

type Panel = "muscle" | "equipment" | null;

/*
 * The open panel eases in so the chips appear to come from the trigger rather
 * than pushing the list down in one frame. Entry only: closing is instant, the
 * list below takes the space back at once.
 */
const PANEL = cn(
  "mt-3 rounded-xl border border-line bg-surface-2/40 p-3",
  "transition-[opacity,transform] duration-200 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0",
);

export function ExerciseFilters({
  muscles,
  onMusclesChange,
  equipment,
  onEquipmentChange,
  muscleCounts,
  equipmentCounts,
  className,
}: {
  muscles: MuscleGroup[];
  onMusclesChange: (value: MuscleGroup[]) => void;
  equipment: Equipment[];
  onEquipmentChange: (value: Equipment[]) => void;
  muscleCounts?: Partial<Record<MuscleGroup, number>>;
  equipmentCounts?: Partial<Record<Equipment, number>>;
  className?: string;
}) {
  const [panel, setPanel] = useState<Panel>(null);

  const trigger = (key: Exclude<Panel, null>, label: string, active: boolean) => (
    <button
      type="button"
      aria-expanded={panel === key}
      onClick={() => setPanel((current) => (current === key ? null : key))}
      className={cn(
        "press inline-flex h-8 items-center gap-1.5 rounded-lg border pr-2 pl-3 text-xs font-medium whitespace-nowrap",
        active ? "border-volt/50 bg-volt-tint text-volt" : "border-line bg-surface-2 text-fg-2 hover:border-line-strong hover:text-fg",
        panel === key && !active && "border-line-strong text-fg",
      )}
    >
      {label}
      <ChevronDown
        size={13}
        className={cn("opacity-70 transition-transform duration-150 ease-out motion-reduce:transition-none", panel === key && "rotate-180")}
      />
    </button>
  );

  const anything = muscles.length > 0 || equipment.length > 0;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {trigger("muscle", summary(muscles.map((m) => MUSCLE_GROUP_LABELS[m]), "Muscle"), muscles.length > 0)}
        {trigger("equipment", summary(equipment.map((e) => EQUIPMENT_LABELS[e]), "Equipment"), equipment.length > 0)}
        {anything ? (
          <button
            type="button"
            onClick={() => {
              onMusclesChange([]);
              onEquipmentChange([]);
            }}
            className="h-8 rounded-lg px-2 text-xs text-fg-3 transition-colors duration-150 hover:text-fg"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {panel === "muscle" ? (
        <div className={cn(PANEL, "space-y-2.5")}>
          {MUSCLES_BY_PART.map((group) => (
            <div key={group.part} className="sm:flex sm:items-start sm:gap-3">
              <div className="mb-1.5 w-20 shrink-0 text-xs text-fg-3 sm:mb-0 sm:pt-2">
                {BODY_PART_LABELS[group.part]}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.muscles.map((muscle) => (
                  <Chip key={muscle} selected={muscles.includes(muscle)} onClick={() => onMusclesChange(toggle(muscles, muscle))}>
                    {MUSCLE_GROUP_LABELS[muscle]}
                    {muscleCounts?.[muscle] !== undefined ? <span className="tabular opacity-60">{muscleCounts[muscle]}</span> : null}
                  </Chip>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {panel === "equipment" ? (
        <div className={cn(PANEL, "flex flex-wrap gap-1.5")}>
          {EQUIPMENT.map((item) => (
            <Chip key={item} selected={equipment.includes(item)} onClick={() => onEquipmentChange(toggle(equipment, item))}>
              {EQUIPMENT_LABELS[item]}
              {equipmentCounts?.[item] !== undefined ? <span className="tabular opacity-60">{equipmentCounts[item]}</span> : null}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}
