/**
 * Short confirmations at the bottom of the screen, on Radix Toast.
 *
 * `toast()` can be called from anywhere, including outside React; the one
 * `Toaster` (in `UIProvider`) draws them. Radix announces each one to screen
 * readers, pauses the timer while the pointer or focus is on a toast or the
 * window is in the background, and lets a toast be swiped away. F8 moves focus
 * to the stack.
 */

"use client";

import { Toast as Primitive } from "radix-ui";
import type { ReactNode } from "react";
import { create } from "zustand";

import { cn } from "@/lib/cn";

type Tone = "info" | "error" | "success";

/** One button on the toast, such as Undo. */
interface ToastAction {
  label: string;
  onAction: () => void;
}

interface ToastEntry {
  id: number;
  message: string;
  tone: Tone;
  open: boolean;
  action?: ToastAction;
}

const useToastStore = create<{ toasts: ToastEntry[] }>(() => ({ toasts: [] }));
let nextToast = 1;

const TOAST_MS = 3500;
/** At most this many on screen; the oldest goes first. */
const MAX_TOASTS = 3;
/** Long enough for the exit animation in `theme.css` to finish. */
const EXIT_MS = 200;

export function toast(message: string, tone: Tone = "success", action?: ToastAction): void {
  const id = nextToast++;
  useToastStore.setState((state) => ({ toasts: [...state.toasts.filter((entry) => entry.open).slice(-(MAX_TOASTS - 1)), { id, message, tone, open: true, action }] }));
}

function close(id: number) {
  useToastStore.setState((state) => ({ toasts: state.toasts.map((entry) => (entry.id === id ? { ...entry, open: false } : entry)) }));
  setTimeout(() => useToastStore.setState((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) })), EXIT_MS);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Primitive.Provider duration={TOAST_MS} swipeDirection="down" label="Notification">
      {children}
    </Primitive.Provider>
  );
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  return (
    <>
      {toasts.map((entry) => (
        <Primitive.Root
          key={entry.id}
          open={entry.open}
          onOpenChange={(open) => !open && close(entry.id)}
          type={entry.tone === "error" ? "foreground" : "background"}
          onClick={() => close(entry.id)}
          className={cn(
            "ui-toast pointer-events-auto flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-toast",
            entry.tone === "error" ? "border-alarm/40 bg-alarm-surface text-alarm" : "border-line-strong bg-surface-3 text-fg",
          )}
        >
          {entry.tone === "success" ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-volt" aria-hidden /> : null}
          <Primitive.Description>{entry.message}</Primitive.Description>
          {entry.action ? (
            // `altText` is what a screen reader is told to do instead, since
            // the toast may be gone before the button can be reached.
            <Primitive.Action
              altText={`${entry.action.label}: press F8 to reach it`}
              onClick={entry.action.onAction}
              className="ml-1 shrink-0 rounded-md px-1.5 py-0.5 text-[13px] font-semibold text-volt hover:bg-surface-2"
            >
              {entry.action.label}
            </Primitive.Action>
          ) : null}
        </Primitive.Root>
      ))}
      <Primitive.Viewport className="pointer-events-none fixed inset-x-0 bottom-20 z-[90] m-0 flex list-none flex-col items-center gap-2 px-4 outline-none lg:bottom-6" />
    </>
  );
}
