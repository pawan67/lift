/**
 * Modal dialog, confirm prompt, and toasts.
 *
 * The dialog renders into a portal with its own overlay, closes on Escape and
 * on an overlay click, locks page scroll while open, and returns focus to
 * whatever opened it.
 */

"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

import { cn } from "@/lib/cn";

import { Button } from "./primitives";

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
  size?: "sm" | "md" | "lg" | "full";
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- portals need the DOM, which only exists after mount
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);

    // Focus the first field, or the panel itself.
    requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select") ?? panel.current;
      target?.focus();
    });

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl outline-none sm:rounded-2xl",
          size === "sm" && "sm:max-w-sm",
          size === "md" && "sm:max-w-lg",
          size === "lg" && "sm:max-w-2xl",
          size === "full" && "h-[92dvh] sm:h-[min(860px,90dvh)] sm:max-w-3xl",
          className,
        )}
      >
        {title ? (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-fg">{title}</h2>
              {description ? <p className="mt-0.5 text-sm text-fg-3">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 rounded-lg p-1.5 text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <X size={18} />
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ request: ConfirmRequest | null }>(() => ({ request: null }));

/** Asks a yes/no question in a dialog. Resolves true on confirm. */
export function confirm(options: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.setState({ request: { ...options, resolve } });
  });
}

export function ConfirmHost() {
  const request = useConfirmStore((state) => state.request);
  const close = (ok: boolean) => {
    request?.resolve(ok);
    useConfirmStore.setState({ request: null });
  };

  return (
    <Dialog
      open={request !== null}
      onClose={() => close(false)}
      size="sm"
      title={request?.title}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={request?.destructive ? "danger" : "primary"} onClick={() => close(true)} data-autofocus>
            {request?.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      {request?.body ? <p className="px-5 py-4 text-sm text-fg-2">{request.body}</p> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  tone: "info" | "error" | "success";
}

const useToastStore = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let nextToast = 1;

export function toast(message: string, tone: Toast["tone"] = "success"): void {
  const id = nextToast++;
  useToastStore.setState((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
  setTimeout(() => {
    useToastStore.setState((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) }));
  }, 3500);
}

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {toasts.map((entry) => (
        <div
          key={entry.id}
          role="status"
          className={cn(
            "pointer-events-auto rounded-xl border px-4 py-2.5 text-sm shadow-xl",
            entry.tone === "error" ? "border-alarm/40 bg-[#2a1214] text-alarm" : "border-line-strong bg-surface-3 text-fg",
          )}
        >
          {entry.message}
        </div>
      ))}
    </div>
  );
}
