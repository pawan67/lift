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
import { usePresence } from "@/lib/use-presence";

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
  const [portalReady, setPortalReady] = useState(false);
  const { mounted, closing } = usePresence(open, 220);

  // While the dialog plays its exit, callers have usually already cleared the
  // state its content was drawn from. Hold on to what it showed last while open.
  const [held, setHeld] = useState({ title, description, children, footer });
  if (open && (held.title !== title || held.description !== description || held.children !== children || held.footer !== footer)) {
    setHeld({ title, description, children, footer });
  }
  const shown = open ? { title, description, children, footer } : held;

  // eslint-disable-next-line react-hooks/set-state-in-effect -- portals need the DOM, which only exists after mount
  useEffect(() => setPortalReady(true), []);

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

  if (!portalReady || !mounted) return null;

  return createPortal(
    <div
      className={cn("fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6", closing && "pointer-events-none")}
      data-closing={closing || undefined}
    >
      <div className="overlay-backdrop absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "dialog-panel relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line-strong/70 bg-surface shadow-[0_24px_80px_-12px_rgb(0_0_0/0.8)] outline-none sm:rounded-xl",
          size === "sm" && "sm:max-w-sm",
          size === "md" && "sm:max-w-lg",
          size === "lg" && "sm:max-w-2xl",
          size === "full" && "h-[92dvh] sm:h-[min(860px,90dvh)] sm:max-w-3xl",
          className,
        )}
      >
        {/* A grab handle, so the phone sheet reads as one. */}
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-surface-4 sm:hidden" aria-hidden />
        {shown.title ? (
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 sm:pt-5">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-fg">{shown.title}</h2>
              {shown.description ? <p className="mt-0.5 text-sm text-fg-3">{shown.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="press -mt-0.5 -mr-1.5 rounded-lg p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg"
            >
              <X size={18} />
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">{shown.children}</div>
        {shown.footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-ink/40 px-5 py-3">{shown.footer}</div>
        ) : null}
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
  leaving?: boolean;
}

const useToastStore = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let nextToast = 1;

const TOAST_MS = 3500;
const TOAST_EXIT_MS = 160;

function dismissToast(id: number) {
  useToastStore.setState((state) => ({ toasts: state.toasts.map((entry) => (entry.id === id ? { ...entry, leaving: true } : entry)) }));
  setTimeout(() => {
    useToastStore.setState((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) }));
  }, TOAST_EXIT_MS);
}

export function toast(message: string, tone: Toast["tone"] = "success"): void {
  const id = nextToast++;
  useToastStore.setState((state) => ({ toasts: [...state.toasts.slice(-2), { id, message, tone }] }));
  // A toast that times out while the tab is hidden was never read: wait for
  // the tab to come back, then give it its full time.
  const start = () => setTimeout(() => dismissToast(id), TOAST_MS);
  if (document.visibilityState === "visible") {
    start();
  } else {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onVisible);
      start();
    };
    document.addEventListener("visibilitychange", onVisible);
  }
}

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {toasts.map((entry) => (
        <div
          key={entry.id}
          role="status"
          data-closing={entry.leaving || undefined}
          onClick={() => dismissToast(entry.id)}
          className={cn(
            "toast pointer-events-auto flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-[0_12px_40px_-8px_rgb(0_0_0/0.8)]",
            entry.tone === "error" ? "border-alarm/40 bg-[#1f0e10] text-alarm" : "border-line-strong bg-surface-3 text-fg",
          )}
        >
          {entry.tone === "success" ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-volt" aria-hidden /> : null}
          {entry.message}
        </div>
      ))}
    </div>
  );
}
