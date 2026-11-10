/**
 * A rounded on/off filter, on Radix Toggle (`aria-pressed`, `data-state`).
 * For a set where several can be on at once; a single choice is `Segmented`.
 */

"use client";

import { Toggle } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Chip({
  selected = false,
  onClick,
  children,
  className,
}: {
  selected?: boolean;
  /** Called on every press; the caller flips `selected`. */
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Toggle.Root
      pressed={selected}
      onPressedChange={() => onClick?.()}
      className={cn(
        "press inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap",
        "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg",
        "data-[state=on]:border-volt/50 data-[state=on]:bg-volt-tint data-[state=on]:text-volt",
        className,
      )}
    >
      {children}
    </Toggle.Root>
  );
}
