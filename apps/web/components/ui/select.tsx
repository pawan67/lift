/**
 * A choice from a list, drawn in the app's own palette on Radix Select.
 *
 * Never the browser's `<select>`: its option list is the operating system's
 * (white, blue highlight) and cannot be styled. Radix keeps the keyboard
 * behaviour people expect from one: arrows, Home/End, Enter or Space to pick,
 * Escape to close, and type-to-jump.
 *
 * Lists longer than a dozen get a search field, which Radix Select cannot
 * hold, so those render as `Combobox` with the same props.
 */

"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { Select as Primitive } from "radix-ui";

import { cn } from "@/lib/cn";

import { Combobox, OPTION_ROW, OptionRow, SelectChevron, selectTriggerClass, type SelectOption } from "./combobox";
import { POP_PANEL } from "./popover";

export type { SelectOption } from "./combobox";

/** Lists longer than this get a search field. */
const SEARCH_THRESHOLD = 12;

/** Radix reserves the empty string for "nothing chosen", so "" travels as this. */
const EMPTY = "\u0000empty";
const encode = (value: string) => (value === "" ? EMPTY : value);
const decode = (value: string) => (value === EMPTY ? "" : value);

export function Select<T extends string>(props: {
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
  const { value, onValueChange, options, placeholder = "Choose…", size = "md", searchable, className, disabled, align = "start" } = props;
  if (searchable ?? options.length > SEARCH_THRESHOLD) return <Combobox {...props} />;

  const known = options.some((option) => option.value === value);

  return (
    <Primitive.Root
      // "" is Radix's own "nothing chosen": it shows the placeholder.
      value={known ? encode(value) : ""}
      onValueChange={(next) => onValueChange(decode(next) as T)}
      disabled={disabled}
    >
      <Primitive.Trigger aria-label={props["aria-label"]} className={selectTriggerClass(size, className)}>
        <span className="truncate">
          <Primitive.Value placeholder={<span className="text-fg-3">{placeholder}</span>} />
        </span>
        <Primitive.Icon asChild>
          <SelectChevron size={size} />
        </Primitive.Icon>
      </Primitive.Trigger>

      <Primitive.Portal>
        <Primitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={8}
          align={align}
          style={
            {
              "--origin": "var(--radix-select-content-transform-origin)",
              minWidth: `max(var(--radix-select-trigger-width), ${size === "sm" ? 160 : 200}px)`,
              maxHeight: "min(var(--radix-select-content-available-height), 360px)",
            } as React.CSSProperties
          }
          className={cn(POP_PANEL, "flex flex-col")}
        >
          <Primitive.ScrollUpButton className="flex h-6 shrink-0 items-center justify-center text-fg-3">
            <ChevronUp size={14} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport className="p-1">
            {options.map((option) => (
              <Primitive.Item
                key={option.value}
                value={encode(option.value)}
                textValue={option.text ?? (typeof option.label === "string" ? option.label : undefined)}
                className={cn(OPTION_ROW, "data-highlighted:bg-surface-4 data-highlighted:text-fg data-disabled:opacity-40")}
              >
                <OptionRow
                  label={<Primitive.ItemText>{option.label}</Primitive.ItemText>}
                  hint={option.hint}
                  selected={option.value === value}
                />
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="flex h-6 shrink-0 items-center justify-center text-fg-3">
            <ChevronDown size={14} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
