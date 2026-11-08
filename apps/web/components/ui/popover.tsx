/**
 * A panel anchored to a trigger, for the select and date pickers.
 *
 * Portalled to the body with fixed positioning, so a dialog's scroll area or a
 * card's `overflow-hidden` cannot clip it. It opens below the trigger and flips
 * above when there is more room there, follows the trigger on scroll and
 * resize, and closes on an outside press. It grows out of the trigger's edge
 * (`--origin`) and fades out on close (see `.menu-panel` in globals.css).
 */

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { usePresence } from "@/lib/use-presence";

const GAP = 6;
const MARGIN = 8;

interface Placement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

function place(trigger: HTMLElement, panelHeight: number, minWidth: number, align: "start" | "end", fixedWidth?: number): Placement {
  const rect = trigger.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const below = viewportHeight - rect.bottom - GAP - MARGIN;
  const above = rect.top - GAP - MARGIN;
  const flip = panelHeight > below && above > below;
  const width = Math.min(fixedWidth ?? Math.max(rect.width, minWidth), viewportWidth - MARGIN * 2);
  let left = align === "end" ? rect.right - width : rect.left;
  left = Math.min(Math.max(MARGIN, left), viewportWidth - width - MARGIN);
  return {
    top: flip ? rect.top - GAP : rect.bottom + GAP,
    left,
    width,
    maxHeight: Math.max(160, flip ? above : below),
    above: flip,
  };
}

export function Popover({
  open,
  onClose,
  anchor,
  children,
  minWidth = 200,
  width,
  align = "start",
  className,
  role,
  id,
  "aria-label": ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** The panel is at least as wide as the trigger, and at least this. */
  minWidth?: number;
  /** A fixed width instead, for content with its own shape like a calendar. */
  width?: number;
  align?: "start" | "end";
  className?: string;
  role?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { mounted, closing } = usePresence(open, 100);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const update = () => {
      if (!anchor.current) return;
      setPlacement(place(anchor.current, panel.current?.scrollHeight ?? 320, minWidth, align, width));
    };
    update();
    // Measured again once the panel has laid out, so the flip uses its real height.
    const frame = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchor, minWidth, align, width]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [open, onClose, anchor]);

  if (!mounted || !placement) return null;

  const style: React.CSSProperties & { "--origin": string } = {
    position: "fixed",
    left: placement.left,
    width: placement.width,
    maxHeight: placement.maxHeight,
    ...(placement.above ? { bottom: window.innerHeight - placement.top } : { top: placement.top }),
    "--origin": `${placement.above ? "bottom" : "top"} ${align === "end" ? "right" : "left"}`,
  };

  return createPortal(
    <div
      ref={panel}
      id={id}
      role={role}
      aria-label={ariaLabel}
      data-closing={closing || undefined}
      style={style}
      className={cn(
        "menu-panel z-[70] flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface-2 shadow-[0_16px_48px_-8px_rgb(0_0_0/0.85)]",
        closing && "pointer-events-none",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
