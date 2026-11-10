/**
 * A panel that slides in from the right edge, on Radix Dialog: the phone's
 * navigation drawer. Same focus trap, Escape and outside press as `Dialog`.
 */

"use client";

import { X } from "lucide-react";
import { Dialog as Primitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="ui-scrim fixed inset-0 z-50 bg-scrim" />
        <Primitive.Content
          aria-describedby={undefined}
          className={cn("ui-drawer fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col border-l border-line bg-surface outline-none", className)}
        >
          <div className="flex items-center justify-between px-5 py-4">
            <Primitive.Title className="font-semibold">{title}</Primitive.Title>
            <Primitive.Close aria-label={`Close ${title.toLowerCase()}`} className="press rounded-lg p-1.5 text-fg-3 hover:bg-surface-2">
              <X size={18} />
            </Primitive.Close>
          </div>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
