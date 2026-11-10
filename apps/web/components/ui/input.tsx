/**
 * Text fields and the label around them.
 *
 * `fieldClass` is the one look every field-shaped control shares: inputs,
 * textareas, and the triggers of the select, combobox and date picker. Change
 * the border, fill or focus halo here and all of them follow.
 */

"use client";

import { Label } from "radix-ui";
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/** Border, fill, hover and the focus halo. `:focus-visible` only, for button-like triggers. */
export function fieldClass({ focus = "focus", className }: { focus?: "focus" | "focus-visible"; className?: string } = {}) {
  return cn(
    "w-full rounded-lg border border-line bg-surface-2 text-sm text-fg placeholder:text-fg-3",
    "transition-[border-color,box-shadow,background-color] duration-150 ease-out hover:border-line-strong",
    focus === "focus"
      ? "focus:border-volt/60 focus:shadow-[0_0_0_3px_var(--ring)] focus:outline-none focus-visible:outline-none"
      : "focus-visible:border-volt/60 focus-visible:shadow-[0_0_0_3px_var(--ring)] focus-visible:outline-none",
    "disabled:opacity-50",
    className,
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={fieldClass({ className: cn("h-10 px-3", className) })} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={fieldClass({ className: cn("min-h-20 px-3 py-2.5 leading-relaxed", className) })} {...props} />;
});

/** A label above its control, with a hint or an error below. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Label.Root className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-alarm">{error}</span> : hint ? <span className="mt-1 block text-xs text-fg-3">{hint}</span> : null}
    </Label.Root>
  );
}
