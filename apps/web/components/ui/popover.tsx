/**
 * A panel anchored to a trigger, on Radix Popover: the combobox and the date
 * picker are built on it.
 *
 * Portalled, so a dialog's scroll area or a card's `overflow-hidden` cannot
 * clip it. Radix places it below the trigger, flips it above when there is
 * more room there, keeps it inside the viewport, follows the trigger on scroll
 * and closes it on an outside press or Escape (one layer at a time, so a
 * dialog around it stays open). It grows out of the edge it hangs from.
 */

"use client";

import { Popover as Primitive } from "radix-ui";
import { forwardRef, type ComponentPropsWithoutRef, type CSSProperties } from "react";

import { cn } from "@/lib/cn";

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverAnchor = Primitive.Anchor;
export const PopoverClose = Primitive.Close;

/** The surface menus, popovers and select lists share. */
export const POP_PANEL = "ui-pop z-[70] overflow-hidden rounded-lg border border-line-strong bg-surface-2 shadow-pop";

export const PopoverContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Primitive.Content> & {
    /** At least as wide as the trigger, and at least this. Ignored when `width` is set. */
    minWidth?: number;
    /** A fixed width instead, for content with its own shape like a calendar. */
    width?: number;
  }
>(function PopoverContent({ className, style, minWidth = 200, width, sideOffset = 6, collisionPadding = 8, align = "start", ...props }, ref) {
  const sizing: CSSProperties & Record<string, string | number> = {
    "--origin": "var(--radix-popover-content-transform-origin)",
    maxHeight: "var(--radix-popover-content-available-height)",
    ...(width
      ? { width: `min(${width}px, calc(100vw - 16px))` }
      : { minWidth: `max(var(--radix-popover-trigger-width), min(${minWidth}px, calc(100vw - 16px)))` }),
  };
  return (
    <Primitive.Portal>
      <Primitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        align={align}
        style={{ ...sizing, ...style }}
        className={cn(POP_PANEL, "flex flex-col outline-none", className)}
        {...props}
      />
    </Primitive.Portal>
  );
});
