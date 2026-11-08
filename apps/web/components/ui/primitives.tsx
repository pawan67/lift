/**
 * The small set of building blocks every screen is made from.
 *
 * Kept deliberately plain: Tailwind classes over the palette in `globals.css`,
 * no headless-UI dependency. Anything with real interaction state (dialogs,
 * menus) lives in its own file next to this one.
 */

"use client";

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-volt text-volt-ink hover:bg-volt-deep font-semibold shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]",
  secondary: "bg-surface-3 text-fg hover:bg-surface-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]",
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
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, className, type = "button", ...props },
  ref,
) {
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
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-(--radius-card) border border-line bg-surface shadow-[inset_0_1px_0_rgb(255_255_255/0.025)]", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 pt-5", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] text-fg-3">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 pt-4 pb-5", className)}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Page header
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Shows a back link above the title. */
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-6">
      {back ? (
        <Link href={back.href} className="group mb-3 inline-flex items-center gap-1 text-[13px] text-fg-3 transition-colors hover:text-fg">
          <span aria-hidden className="transition-transform duration-150 ease-out group-hover:-translate-x-0.5">←</span> {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-fg sm:text-[30px]">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-sm text-fg-3">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
  size = "md",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** `sm` for long strips of figures, which wrap badly at full size on a phone. */
  size?: "sm" | "md";
  unit?: ReactNode;
  /** A short second line, e.g. a change against the previous period. */
  hint?: ReactNode;
  tone?: "up" | "down" | "neutral";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[13px] text-fg-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={cn("tabular truncate leading-tight font-semibold tracking-[-0.02em] text-fg", size === "sm" ? "text-xl" : "text-[26px]")}>{value}</span>
        {unit ? <span className="text-sm text-fg-3">{unit}</span> : null}
      </div>
      {hint ? (
        <div
          className={cn(
            "tabular mt-1 text-xs",
            tone === "up" ? "text-signal" : tone === "down" ? "text-alarm/90" : "text-fg-3",
          )}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

type BadgeTone = "neutral" | "volt" | "record" | "signal" | "warn" | "alarm" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-3 text-fg-2",
  volt: "bg-volt-tint text-volt",
  record: "bg-record/15 text-record",
  signal: "bg-signal/15 text-signal",
  warn: "bg-warn/15 text-warn",
  alarm: "bg-alarm/15 text-alarm",
  info: "bg-info/15 text-info",
};

export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

const FIELD = cn(
  "w-full rounded-lg border border-line bg-surface-2 px-3 text-sm text-fg placeholder:text-fg-3",
  "transition-[border-color,box-shadow] duration-150 ease-out hover:border-line-strong",
  "focus:border-volt/60 focus:shadow-[0_0_0_3px_rgb(210_243_75/0.12)] focus:outline-none focus-visible:outline-none",
  "disabled:opacity-50",
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(FIELD, "h-10", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(FIELD, "min-h-20 py-2.5 leading-relaxed", className)} {...props} />;
});

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
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-alarm">{error}</span> : hint ? <span className="mt-1 block text-xs text-fg-3">{hint}</span> : null}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  className,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-lg border border-line bg-surface p-0.5", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "press rounded-md font-medium whitespace-nowrap",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
              active ? "bg-surface-3 text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]" : "text-fg-3 hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export function Chip({
  selected,
  onClick,
  children,
  className,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "press inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap",
        selected ? "border-volt/50 bg-volt-tint text-volt" : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Empty state, skeleton
// ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {icon ? <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-line text-fg-3">{icon}</div> : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-fg-3">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-surface-2", className)} />;
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** A list row inside a Card, with dividers between siblings. */
export function ListRow({
  href,
  onClick,
  children,
  className,
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const classes = cn(
    "flex w-full items-center gap-3 border-t border-line px-5 py-3 text-left first:border-t-0",
    href || onClick ? "transition-colors duration-150 hover:bg-surface-2/70 active:bg-surface-2" : "",
    className,
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {children}
      </button>
    );
  }
  return <div className={classes}>{children}</div>;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-line", className)} />;
}
