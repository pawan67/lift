/**
 * A yes/no question, on Radix AlertDialog: it cannot be dismissed by an
 * outside press, only answered (Escape counts as Cancel).
 *
 * `confirm()` asks it from anywhere and resolves with the answer; the one
 * `ConfirmHost` (in `UIProvider`) draws it. A destructive question starts on
 * Cancel, so a stray Enter does not delete anything; any other starts on the
 * confirm button.
 */

"use client";

import { AlertDialog as Primitive } from "radix-ui";
import { useRef, useState } from "react";
import { create } from "zustand";

import { Button } from "./button";
import { dialogPanelClass, DialogFooter, SheetHandle } from "./dialog";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ request: ConfirmRequest | null }>(() => ({ request: null }));

/** Asks a yes/no question in a dialog. Resolves true on confirm. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // A question still open is answered "no" rather than left hanging.
    useConfirmStore.getState().request?.resolve(false);
    useConfirmStore.setState({ request: { ...options, resolve } });
  });
}

export function ConfirmHost() {
  const request = useConfirmStore((state) => state.request);
  const confirmButton = useRef<HTMLButtonElement>(null);

  // Keep drawing the last question while the exit animation plays.
  const [shown, setShown] = useState<ConfirmOptions | null>(request);
  if (request && request !== shown) setShown(request);

  const answer = (ok: boolean) => {
    request?.resolve(ok);
    useConfirmStore.setState({ request: null });
  };

  return (
    <Primitive.Root open={request !== null} onOpenChange={(open) => !open && answer(false)}>
      <Primitive.Portal>
        <Primitive.Overlay className="ui-scrim fixed inset-0 z-[60] bg-scrim" />
        <Primitive.Content
          className={dialogPanelClass("sm", "z-[60]")}
          {...(shown?.body ? {} : { "aria-describedby": undefined })}
          onOpenAutoFocus={(event) => {
            if (shown?.destructive) return; // Radix focuses Cancel.
            event.preventDefault();
            confirmButton.current?.focus();
          }}
        >
          <SheetHandle />
          <div className="px-5 pt-4 pb-3 sm:pt-5">
            <Primitive.Title className="text-base font-semibold tracking-tight text-fg">{shown?.title}</Primitive.Title>
          </div>
          {shown?.body ? <Primitive.Description className="px-5 pb-4 text-sm text-fg-2">{shown.body}</Primitive.Description> : null}
          <DialogFooter>
            <Primitive.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </Primitive.Cancel>
            <Primitive.Action asChild>
              <Button ref={confirmButton} variant={shown?.destructive ? "danger" : "primary"} onClick={() => answer(true)}>
                {shown?.confirmLabel ?? "Confirm"}
              </Button>
            </Primitive.Action>
          </DialogFooter>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
