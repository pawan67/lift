/**
 * Inputs that edit a synced row without writing on every keystroke.
 *
 * Each keeps a local draft and commits it on blur, on Enter, or after a pause
 * in typing. One write per edit rather than one per character keeps the
 * outbox (and the phone's next pull) small. A change arriving from sync while
 * the field is not being edited replaces the draft.
 */

"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { Input, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const DEBOUNCE_MS = 600;

/** Local draft over an external value, reset when the external value moves while idle. */
function useDraft(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [editing, setEditing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ draft, value, commit });
  useEffect(() => {
    latest.current = { draft, value, commit };
  });

  if (value !== seen) {
    setSeen(value);
    if (!editing) setDraft(value);
  }

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { draft: current, value: stored, commit: save } = latest.current;
    if (current !== stored) save(current);
  };

  // Commit whatever is pending when the field unmounts (navigating away mid-edit).
  useEffect(() => () => flush(), []);

  return {
    draft,
    onChange(next: string) {
      setDraft(next);
      latest.current = { ...latest.current, draft: next };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    },
    onFocus() {
      setEditing(true);
    },
    onBlur() {
      setEditing(false);
      flush();
    },
  };
}

type TextProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "onFocus"> & {
  value: string;
  onCommit: (value: string) => void;
};

export function DraftInput({ value, onCommit, className, onKeyDown, ...props }: TextProps) {
  const field = useDraft(value, onCommit);
  return (
    <Input
      {...props}
      className={className}
      value={field.draft}
      onFocus={field.onFocus}
      onBlur={field.onBlur}
      onChange={(event) => field.onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        onKeyDown?.(event);
      }}
    />
  );
}

/** A heading-sized input with no chrome until hovered or focused. */
export function TitleInput({ value, onCommit, className, ...props }: TextProps) {
  const field = useDraft(value, onCommit);
  return (
    <input
      {...props}
      value={field.draft}
      onFocus={field.onFocus}
      onBlur={field.onBlur}
      onChange={(event) => field.onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={cn(
        "-mx-2 w-full rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-fg sm:text-[30px]",
        "transition-colors duration-150 hover:border-line focus:border-volt/60 focus:outline-none focus-visible:outline-none",
        className,
      )}
    />
  );
}

type AreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onBlur" | "onFocus"> & {
  value: string;
  onCommit: (value: string) => void;
};

export function DraftTextarea({ value, onCommit, ...props }: AreaProps) {
  const field = useDraft(value, onCommit);
  return (
    <Textarea
      {...props}
      value={field.draft}
      onFocus={field.onFocus}
      onBlur={field.onBlur}
      onChange={(event) => field.onChange(event.target.value)}
    />
  );
}

/**
 * A compact numeric cell for the set table.
 *
 * `toText` renders the stored value in display units and `fromText` parses the
 * typed text back to storage units (null clears the target). Commits on blur
 * and Enter only: a half-typed number is not a value worth syncing.
 */
export function NumberCell({
  value,
  toText,
  fromText,
  onCommit,
  placeholder,
  inputMode = "decimal",
  label,
  className,
}: {
  value: number | null;
  toText: (stored: number) => string;
  fromText: (text: string) => number | null | undefined;
  onCommit: (stored: number | null) => void;
  placeholder?: string;
  inputMode?: "decimal" | "numeric" | "text";
  label: string;
  className?: string;
}) {
  const text = value === null ? "" : toText(value);
  const [draft, setDraft] = useState(text);
  const [seen, setSeen] = useState(text);
  const [invalid, setInvalid] = useState(false);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  if (text !== seen) {
    setSeen(text);
    if (!editing) setDraft(text);
  }

  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const trimmed = draft.trim();
    if (trimmed === text) return;
    if (trimmed === "") {
      setInvalid(false);
      onCommit(null);
      return;
    }
    const parsed = fromText(trimmed);
    // `undefined` means unreadable: keep the old value and say so.
    if (parsed === undefined) {
      setInvalid(true);
      setDraft(text);
      return;
    }
    setInvalid(false);
    onCommit(parsed);
  };

  return (
    <input
      aria-label={label}
      inputMode={inputMode}
      value={draft}
      placeholder={placeholder}
      onFocus={(event) => {
        setEditing(true);
        event.currentTarget.select();
      }}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          setDraft(text);
          event.currentTarget.blur();
        }
      }}
      // No transition: tabbing through a table of cells should land instantly.
      className={cn(
        "tabular h-8 w-full min-w-0 rounded-md border bg-surface-2 px-2 text-center text-sm text-fg placeholder:text-fg-3/60",
        "hover:border-line-strong focus:border-volt/70 focus:bg-surface-3 focus:outline-none focus-visible:outline-none",
        invalid ? "border-alarm" : "border-transparent",
        className,
      )}
    />
  );
}
