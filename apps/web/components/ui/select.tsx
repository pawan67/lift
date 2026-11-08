/**
 * A listbox select, drawn in the app's own palette.
 *
 * Never the browser's `<select>`: its option list is the operating system's
 * (white, blue highlight) and cannot be styled. This one keeps the keyboard
 * behaviour people expect from a select: arrows, Home/End, Enter or Space to
 * pick, Escape to close, and type-to-jump. Long lists get a search field.
 *
 * Moving through options with the keyboard is instant: it happens dozens of
 * times in a row, so it never animates.
 */

"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { Popover } from "./popover";

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Plain text for search and type-to-jump, when `label` is not a string. */
  text?: string;
  /** A second, dimmer line or trailing figure. */
  hint?: ReactNode;
}

/** Lists longer than this get a search field. */
const SEARCH_THRESHOLD = 12;

function optionText(option: SelectOption): string {
  return option.text ?? (typeof option.label === "string" ? option.label : String(option.value));
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder = "Choose…",
  size = "md",
  searchable,
  className,
  disabled,
  align = "start",
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  size?: "sm" | "md";
  /** Defaults to on for lists longer than a dozen. */
  searchable?: boolean;
  className?: string;
  disabled?: boolean;
  align?: "start" | "end";
  "aria-label"?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const typeahead = useRef({ text: "", at: 0 });

  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;
  const selected = options.find((option) => option.value === value);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => optionText(option).toLowerCase().includes(needle));
  }, [options, query]);

  const openList = () => {
    if (disabled) return;
    setQuery("");
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const choose = (option: SelectOption<T> | undefined) => {
    if (!option) return;
    if (option.value !== value) onValueChange(option.value);
    close();
  };

  // Focus moves into the panel once it exists: the search field, or the list.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => (withSearch ? search.current : list.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, withSearch]);

  // Keep the active option in view, without smooth scrolling.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onTriggerKey = (event: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openList();
    }
  };

  const onListKey = (event: KeyboardEvent) => {
    const last = visible.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => Math.min(last, index + 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
        return;
      case "Home":
        if (withSearch) return;
        event.preventDefault();
        setActive(0);
        return;
      case "End":
        if (withSearch) return;
        event.preventDefault();
        setActive(last);
        return;
      case "PageDown":
        event.preventDefault();
        setActive((index) => Math.min(last, index + 8));
        return;
      case "PageUp":
        event.preventDefault();
        setActive((index) => Math.max(0, index - 8));
        return;
      case "Enter":
        event.preventDefault();
        choose(visible[active]);
        return;
      case " ":
        if (withSearch) return;
        event.preventDefault();
        choose(visible[active]);
        return;
      case "Escape":
        // Stops here, so a dialog around the select stays open.
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      case "Tab":
        close(false);
        return;
    }
    // Type to jump, the way a native select does.
    if (!withSearch && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const text = (now - typeahead.current.at < 700 ? typeahead.current.text : "") + event.key.toLowerCase();
      typeahead.current = { text, at: now };
      const hit = visible.findIndex((option) => optionText(option).toLowerCase().startsWith(text));
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKey}
        className={cn(
          "group flex w-full min-w-0 items-center justify-between gap-2 border border-line bg-surface-2 text-left text-fg",
          "transition-[border-color,box-shadow,background-color] duration-150 ease-out hover:border-line-strong",
          "focus-visible:border-volt/60 focus-visible:shadow-[0_0_0_3px_rgb(210_243_75/0.12)] focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-50",
          size === "sm" ? "h-8 rounded-md pr-2 pl-2.5 text-[13px]" : "h-10 rounded-lg pr-2.5 pl-3 text-sm",
          open && "border-line-strong bg-surface-3",
          className,
        )}
      >
        <span className={cn("truncate", !selected && "text-fg-3")}>{selected ? selected.label : placeholder}</span>
        <ChevronDown
          size={size === "sm" ? 14 : 15}
          className={cn("shrink-0 text-fg-3 transition-transform duration-200 ease-out", open && "rotate-180 text-fg-2")}
          aria-hidden
        />
      </button>

      <Popover open={open} onClose={() => close(false)} anchor={trigger} align={align} minWidth={withSearch ? 280 : size === "sm" ? 160 : 200}>
        {withSearch ? (
          <div className="relative shrink-0 border-b border-line">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3" aria-hidden />
            <input
              ref={search}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onListKey}
              placeholder="Search"
              aria-controls={listId}
              aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
              className="h-10 w-full bg-transparent pr-3 pl-8 text-sm text-fg placeholder:text-fg-3 focus:outline-none focus-visible:outline-none"
            />
          </div>
        ) : null}
        <div
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={withSearch ? -1 : 0}
          aria-label={ariaLabel}
          aria-activedescendant={!withSearch && visible[active] ? `${listId}-${active}` : undefined}
          onKeyDown={withSearch ? undefined : onListKey}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 focus:outline-none focus-visible:outline-none"
        >
          {visible.length === 0 ? <div className="px-2.5 py-6 text-center text-[13px] text-fg-3">No matches</div> : null}
          {visible.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(option)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 pl-2.5 text-sm select-none",
                  index === active ? "bg-surface-4 text-fg" : "text-fg-2",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint ? <span className="tabular shrink-0 text-xs text-fg-3">{option.hint}</span> : null}
                <Check size={14} className={cn("shrink-0 text-volt", !isSelected && "invisible")} aria-hidden />
              </div>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
