/** A small action menu: a trigger button and a popover list that closes on outside click or Escape. */

"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { usePresence } from "@/lib/use-presence";

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function ActionMenu({
  items,
  label = "More actions",
  className,
  align = "right",
  trigger,
  triggerClassName,
}: {
  /** `null` entries draw a divider. */
  items: (MenuItem | null)[];
  label?: string;
  className?: string;
  align?: "left" | "right";
  /** Button content; defaults to a "more" icon. */
  trigger?: ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { mounted, closing } = usePresence(open, 100);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "press flex h-8 w-8 items-center justify-center rounded-lg text-fg-3 hover:bg-surface-3 hover:text-fg",
          open && "bg-surface-3 text-fg",
          triggerClassName,
        )}
      >
        {trigger ?? <MoreHorizontal size={17} />}
      </button>
      {mounted ? (
        <div
          role="menu"
          data-closing={closing || undefined}
          style={{ "--origin": align === "right" ? "top right" : "top left" } as React.CSSProperties}
          className={cn(
            "menu-panel absolute top-9 z-40 min-w-48 overflow-hidden rounded-lg border border-line-strong bg-surface-2 p-1 shadow-[0_16px_48px_-8px_rgb(0_0_0/0.85)]",
            align === "right" ? "right-0" : "left-0",
            closing && "pointer-events-none",
          )}
        >
          {items.map((item, index) =>
            item === null ? (
              <div key={`divider-${index}`} className="-mx-1 my-1 h-px bg-line" />
            ) : (
              <button
                key={index}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm disabled:pointer-events-none disabled:opacity-40",
                  item.destructive ? "text-alarm hover:bg-alarm/10" : "text-fg-2 hover:bg-surface-3 hover:text-fg",
                )}
              >
                {item.icon ? <span className="shrink-0 opacity-80">{item.icon}</span> : null}
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
