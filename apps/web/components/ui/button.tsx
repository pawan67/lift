/**
 * Buttons. `asChild` hands the styling to the child element (a `Link`, an
 * `<a>`) through Radix Slot, so a link that looks like a button stays a link.
 */

"use client";

import Link from "next/link";
import { Slot } from "radix-ui";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { Tooltip } from "./tooltip";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-volt text-volt-ink hover:bg-volt-deep font-semibold shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]",
  secondary: "bg-surface-3 text-fg hover:bg-surface-4 shadow-raised",
  outline: "border border-line-strong text-fg hover:bg-surface-2 hover:border-fg-3/40",
  ghost: "text-fg-2 hover:text-fg hover:bg-surface-2",
  danger: "bg-alarm/12 text-alarm hover:bg-alarm/20",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-lg",
  icon: "h-9 w-9 rounded-lg",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(
    "press inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap select-none",
    "disabled:pointer-events-none disabled:opacity-40",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element with button styling instead of a `<button>`. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, className, asChild = false, type = "button", ...props },
  ref,
) {
  if (asChild) return <Slot.Root ref={ref} className={buttonClass(variant, size, className)} {...props} />;
  return <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...props} />;
});

export function ButtonLink({
  href,
  variant,
  size,
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href={href}>{children}</Link>
    </Button>
  );
}

/**
 * A square, icon-only button. The label is required: it is the accessible
 * name, and it shows as a tooltip on hover and keyboard focus.
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
    label: string;
    /** `sm` is the 32px button that sits in rows and card headers. */
    size?: "sm" | "md";
    tone?: "default" | "danger";
    /** Skip the tooltip, e.g. when the label is already visible nearby. */
    tooltip?: boolean;
  }
>(function IconButton({ label, size = "md", tone = "default", tooltip = true, className, type = "button", ...props }, ref) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        "press inline-flex shrink-0 items-center justify-center rounded-lg text-fg-3 disabled:pointer-events-none disabled:opacity-30",
        size === "sm" ? "h-8 w-8" : "h-9 w-9",
        tone === "danger" ? "hover:bg-alarm/10 hover:text-alarm" : "hover:bg-surface-2 hover:text-fg data-[state=open]:bg-surface-3 data-[state=open]:text-fg",
        className,
      )}
      {...props}
    />
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
});
