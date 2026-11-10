/**
 * Single choices from a short, visible set, on Radix RadioGroup: one tab stop
 * for the group, arrow keys move and pick, and screen readers hear a radio
 * group.
 *
 * - `Segmented` is the compact pill (units, ranges, chart metrics).
 * - `ChoiceCards` is the same choice as a grid of cards, for options that need
 *   a line of explanation each.
 * - `ChoiceGroup` and `ChoiceItem` are the unstyled parts, for a choice with a
 *   shape of its own (the muscle rows on Statistics). Style the checked item
 *   with `data-[state=checked]:`.
 */

"use client";

import { RadioGroup } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export const ChoiceGroup = RadioGroup.Root;
export const ChoiceItem = RadioGroup.Item;

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onChange(next as T)}
      orientation="horizontal"
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-lg border border-line bg-surface p-0.5", className)}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            "press rounded-md font-medium whitespace-nowrap focus-visible:outline-offset-0",
            size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
            "text-fg-3 hover:text-fg data-[state=checked]:bg-surface-3 data-[state=checked]:text-fg data-[state=checked]:shadow-raised",
          )}
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

export function ChoiceCards<T extends string>({
  value,
  options,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode; description?: ReactNode; disabled?: boolean }[];
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <RadioGroup.Root value={value} onValueChange={(next) => onChange(next as T)} aria-label={ariaLabel} className={cn("grid gap-2", className)}>
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            "group press rounded-lg border px-3 py-2.5 text-left",
            "border-line bg-surface-2 hover:border-line-strong data-[state=checked]:border-volt/50 data-[state=checked]:bg-volt-tint",
            "data-disabled:cursor-not-allowed data-disabled:opacity-35 data-disabled:hover:border-line",
          )}
        >
          <div className="text-sm font-medium text-fg transition-colors duration-150 group-data-[state=checked]:text-volt">{option.label}</div>
          {option.description ? <div className="mt-0.5 text-xs text-fg-3">{option.description}</div> : null}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
