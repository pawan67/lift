/**
 * A short label on hover or keyboard focus, for icon-only controls and legend
 * keys. Not for anything a touch user needs to read: there is no hover on a
 * phone, so the text must also be the control's accessible name or appear
 * elsewhere.
 *
 * Dense grids (calendar days, the training-year heatmap) keep a plain `title`
 * instead: a tooltip per cell is hundreds of components for no gain.
 */

"use client";

import { Tooltip as Primitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** One per app, so moving between triggers skips the delay. Mounted in `UIProvider`. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Primitive.Provider delayDuration={400} skipDelayDuration={300}>
      {children}
    </Primitive.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  className,
}: {
  content: ReactNode;
  /** A single focusable element; it becomes the trigger. */
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}) {
  if (content == null || content === "") return <>{children}</>;
  return (
    <Primitive.Root>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "ui-tooltip z-[80] max-w-64 rounded-md border border-line-strong bg-surface-3 px-2 py-1 text-xs leading-snug text-fg shadow-pop select-none",
            className,
          )}
        >
          {content}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
