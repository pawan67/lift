/**
 * A select with a search field, for lists too long to scan (more than a dozen
 * options), on Radix Popover. Radix Select cannot hold a text field, so this
 * is the long-list half of `Select`, which hands over to it automatically.
 *
 * Focus starts in the search field and stays there; arrows, Page Up/Down and
 * Enter work the list through `aria-activedescendant`. Escape and an outside
 * press close it (Radix), and focus returns to the trigger.
 *
 * Moving through options with the keyboard is instant: it happens dozens of
 * times in a row, so it never animates.
 */

"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { fieldClass } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { ScrollArea } from "./scroll-area";

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Plain text for search and type-to-jump, when `label` is not a string. */
  text?: string;
  /** A second, dimmer line or trailing figure. */
  hint?: ReactNode;
}

export function optionText(option: SelectOption): string {
  return option.text ?? (typeof option.label === "string" ? option.label : String(option.value));
}

/** The closed field, shared by `Select` and `Combobox`. */
export function selectTriggerClass(size: "sm" | "md", className?: string) {
  return fieldClass({
    focus: "focus-visible",
    className: cn(
      "group flex min-w-0 items-center justify-between gap-2 text-left disabled:pointer-events-none",
      "data-[state=open]:border-line-strong data-[state=open]:bg-surface-3",
      size === "sm" ? "h-8 rounded-md pr-2 pl-2.5 text-[13px]" : "h-10 pr-2.5 pl-3",
      className,
    ),
  });
}

export function SelectChevron({ size }: { size: "sm" | "md" }) {
  return (
    <ChevronDown
      size={size === "sm" ? 14 : 15}
      className="shrink-0 text-fg-3 transition-transform duration-200 ease-out group-data-[state=open]:rotate-180 group-data-[state=open]:text-fg-2"
      aria-hidden
    />
  );
}

/** One row of a list: label, optional hint, and a check on the chosen one. */
export function OptionRow({ label, hint, selected }: { label: ReactNode; hint?: ReactNode; selected: boolean }) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="tabular shrink-0 text-xs text-fg-3">{hint}</span> : null}
      <Check size={14} className={cn("shrink-0 text-volt", !selected && "invisible")} aria-hidden />
    </>
  );
}

export const OPTION_ROW = "flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 pl-2.5 text-sm text-fg-2 outline-none select-none";

export function Combobox<T extends string>({
  value,
  onValueChange,
  options,
  placeholder = "Choose…",
  size = "md",
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
  className?: string;
  disabled?: boolean;
  align?: "start" | "end";
  "aria-label"?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((option) => option.value === value);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => optionText(option).toLowerCase().includes(needle));
  }, [options, query]);

  const onOpenChange = (next: boolean) => {
    if (next) {
      setQuery("");
      setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    }
    setOpen(next);
  };

  const choose = (option: SelectOption<T> | undefined) => {
    if (!option) return;
    if (option.value !== value) onValueChange(option.value);
    setOpen(false);
  };

  // Keep the active option in view, without smooth scrolling.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onSearchKey = (event: KeyboardEvent) => {
    const last = visible.length - 1;
    const steps: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 };
    if (event.key in steps) {
      event.preventDefault();
      setActive((index) => Math.min(last, Math.max(0, index + steps[event.key]!)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(visible[active]);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        className={selectTriggerClass(size, className)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        <span className={cn("truncate", !selected && "text-fg-3")}>{selected ? selected.label : placeholder}</span>
        <SelectChevron size={size} />
      </PopoverTrigger>

      <PopoverContent
        align={align}
        minWidth={280}
        aria-label={ariaLabel}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          search.current?.focus();
        }}
      >
        <div className="relative shrink-0 border-b border-line">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            ref={search}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onSearchKey}
            placeholder="Search"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
            className="h-10 w-full bg-transparent pr-3 pl-8 text-sm text-fg placeholder:text-fg-3 focus:outline-none focus-visible:outline-none"
          />
        </div>
        <ScrollArea ref={list} className="flex-1" viewportClassName="p-1" viewportProps={{ id: listId, role: "listbox", "aria-label": ariaLabel }}>
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
                className={cn(OPTION_ROW, index === active && "bg-surface-4 text-fg")}
              >
                <OptionRow label={option.label} hint={option.hint} selected={isSelected} />
              </div>
            );
          })}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
