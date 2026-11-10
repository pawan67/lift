/**
 * Modal dialog on Radix Dialog: a centred panel on a wide screen and a bottom
 * sheet on a phone. Radix handles the focus trap, Escape, outside press,
 * scroll lock, and returning focus to whatever opened it; stacked overlays
 * (a select or a confirm inside a dialog) close one layer at a time.
 *
 * The panel is centred with `inset-0 m-auto` rather than a translate, so the
 * entry and exit keyframes in `theme.css` own `transform` outright.
 */

"use client";

import { X } from "lucide-react";
import { Dialog as Primitive, VisuallyHidden } from "radix-ui";
import { useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export type DialogSize = "sm" | "md" | "lg" | "full";

/** Panel width and height per size. Shared with the confirm prompt. */
export function dialogPanelClass(size: DialogSize, className?: string) {
  return cn(
    "ui-dialog fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] w-full flex-col overflow-hidden",
    "rounded-t-2xl border border-line-strong/70 bg-surface shadow-dialog outline-none",
    "sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[calc(100dvh-3rem)] sm:rounded-xl",
    size === "sm" && "sm:max-w-sm",
    size === "md" && "sm:max-w-lg",
    size === "lg" && "sm:max-w-2xl",
    size === "full" && "h-[92dvh] sm:h-[min(860px,90dvh)] sm:max-w-3xl",
    className,
  );
}

export function DialogScrim() {
  return <Primitive.Overlay className="ui-scrim fixed inset-0 z-50 bg-scrim" />;
}

/** A grab handle, so the phone sheet reads as one. */
export function SheetHandle() {
  return <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-surface-4 sm:hidden" aria-hidden />;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** `full` is for the exercise selector: tall, and wide on desktop. */
  size?: DialogSize;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // While the dialog plays its exit, callers have usually already cleared the
  // state its content was drawn from. Hold on to what it showed last while open.
  const [held, setHeld] = useState({ title, description, children, footer });
  if (open && (held.title !== title || held.description !== description || held.children !== children || held.footer !== footer)) {
    setHeld({ title, description, children, footer });
  }
  const shown = open ? { title, description, children, footer } : held;

  return (
    <Primitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Primitive.Portal>
        <DialogScrim />
        <Primitive.Content
          ref={panel}
          className={dialogPanelClass(size, className)}
          {...(shown.description ? {} : { "aria-describedby": undefined })}
          onOpenAutoFocus={(event) => {
            // The first field, or the panel itself: never the close button,
            // which is what Radix would pick.
            const target = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea");
            event.preventDefault();
            (target ?? panel.current)?.focus();
          }}
        >
          <SheetHandle />
          {shown.title ? (
            <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 sm:pt-5">
              <div className="min-w-0">
                <Primitive.Title className="text-base font-semibold tracking-tight text-fg">{shown.title}</Primitive.Title>
                {shown.description ? <Primitive.Description className="mt-0.5 text-sm text-fg-3">{shown.description}</Primitive.Description> : null}
              </div>
              <Primitive.Close aria-label="Close" className="press -mt-0.5 -mr-1.5 rounded-lg p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg">
                <X size={18} />
              </Primitive.Close>
            </div>
          ) : (
            <VisuallyHidden.Root asChild>
              <Primitive.Title>Dialog</Primitive.Title>
            </VisuallyHidden.Root>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">{shown.children}</div>
          {shown.footer ? <DialogFooter>{shown.footer}</DialogFooter> : null}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-line bg-ink/40 px-5 py-3", className)}>{children}</div>;
}
