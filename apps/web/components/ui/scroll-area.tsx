/**
 * A scroll container with a thin overlay scrollbar in the palette, on Radix
 * ScrollArea. Native scrolling underneath (wheel, touch, keyboard), so it
 * costs nothing to use around long lists like the nav rail.
 *
 * Radix wraps the content in a `display: table` box, which lets long rows
 * grow past the viewport and breaks `truncate`; it is reset to a block here.
 */

"use client";

import { ScrollArea as Primitive } from "radix-ui";
import { forwardRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export const ScrollArea = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    className?: string;
    viewportClassName?: string;
    /** Props for the scrolling element itself (roles, ids, key handlers). */
    viewportProps?: React.HTMLAttributes<HTMLDivElement>;
  }
>(function ScrollArea({ children, className, viewportClassName, viewportProps }, ref) {
  return (
    <Primitive.Root type="hover" scrollHideDelay={400} className={cn("relative flex min-h-0 flex-col overflow-hidden", className)}>
      <Primitive.Viewport ref={ref} className={cn("min-h-0 w-full flex-1 [&>div]:block! overscroll-contain", viewportClassName)} {...viewportProps}>
        {children}
      </Primitive.Viewport>
      <Primitive.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none p-0.5 transition-opacity duration-150 select-none data-[state=hidden]:opacity-0"
      >
        <Primitive.Thumb className="relative flex-1 rounded-full bg-surface-4 hover:bg-line-strong" />
      </Primitive.Scrollbar>
    </Primitive.Root>
  );
});
