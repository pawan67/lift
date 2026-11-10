/**
 * A date and time field with its own calendar, in place of the browser's
 * `datetime-local` picker (which draws the operating system's calendar). The
 * panel is a Radix Popover: it closes on Escape or an outside press and hands
 * focus back to the field.
 *
 * Works on the same `YYYY-MM-DDTHH:mm` local string a `datetime-local` input
 * does, so callers keep their parsing. The week starts on the day chosen in
 * Settings. Arrow keys move the day, Page Up/Down the month; days after `max`
 * cannot be picked.
 */

"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";
import { useSettings } from "@/lib/settings";

import { Button } from "./button";
import { fieldClass } from "./input";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./popover";

const pad = (n: number) => String(n).padStart(2, "0");

function parse(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return new Date();
  const [, y, m, d, h, min] = match.map(Number) as [number, number, number, number, number, number];
  return new Date(y, m - 1, d, h, min);
}

function format(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Six weeks starting on the configured first weekday, covering `month`. */
function monthGrid(month: Date, firstDay: 0 | 1): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() - firstDay + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + i));
}

function clampNumber(text: string, max: number): number | null {
  if (!/^\d{1,2}$/.test(text)) return null;
  const n = Number(text);
  return n >= 0 && n <= max ? n : null;
}

export function DateTimeField({
  value,
  onChange,
  max,
  className,
  "aria-label": ariaLabel = "Date and time",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Latest allowed moment, same format. */
  max?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const firstDay = useSettings((s) => s.firstDayOfWeek);
  const [open, setOpen] = useState(false);
  const current = parse(value);
  const limit = max ? parse(max) : null;
  const [month, setMonth] = useState(() => new Date(current.getFullYear(), current.getMonth(), 1));
  const [hours, setHours] = useState(pad(current.getHours()));
  const [minutes, setMinutes] = useState(pad(current.getMinutes()));

  const commit = (date: Date) => {
    const bounded = limit && date > limit ? limit : date;
    onChange(format(bounded));
  };

  const onOpenChange = (next: boolean) => {
    if (next) {
      setMonth(new Date(current.getFullYear(), current.getMonth(), 1));
      setHours(pad(current.getHours()));
      setMinutes(pad(current.getMinutes()));
    }
    setOpen(next);
  };

  const pickDay = (day: Date) => {
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), current.getHours(), current.getMinutes());
    commit(next);
    if (day.getMonth() !== month.getMonth()) setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
  };

  const moveDay = (days: number) => {
    const next = new Date(current);
    next.setDate(next.getDate() + days);
    if (limit && dayStart(next) > dayStart(limit)) return;
    commit(next);
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>("[data-selected]")?.focus());
  };

  const onGridKey = (event: KeyboardEvent) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in steps) {
      event.preventDefault();
      moveDay(steps[event.key]!);
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      const next = new Date(current);
      next.setMonth(next.getMonth() + (event.key === "PageUp" ? -1 : 1));
      moveDay(Math.round((next.getTime() - current.getTime()) / 86_400_000));
    }
  };

  const applyTime = (h: string, m: string) => {
    const hour = clampNumber(h, 23);
    const minute = clampNumber(m, 59);
    if (hour === null || minute === null) return;
    commit(new Date(current.getFullYear(), current.getMonth(), current.getDate(), hour, minute));
  };

  const days = monthGrid(month, firstDay);
  const today = new Date();
  const nextMonthStart = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const canGoForward = !limit || nextMonthStart <= limit;
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 7 + firstDay + i).toLocaleDateString(undefined, { weekday: "narrow" }),
  );

  const label = current.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const time = current.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-haspopup="dialog"
        aria-label={`${ariaLabel}: ${label}, ${time}`}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
        className={fieldClass({
          focus: "focus-visible",
          className: cn("flex h-10 items-center gap-2.5 px-3 text-left data-[state=open]:border-line-strong data-[state=open]:bg-surface-3", className),
        })}
      >
        <CalendarDays size={15} className="shrink-0 text-fg-3" aria-hidden />
        <span className="truncate">{label}</span>
        <span className="tabular ml-auto shrink-0 text-fg-2">{time}</span>
      </PopoverTrigger>

      <PopoverContent
        width={300}
        role="dialog"
        aria-label={ariaLabel}
        onOpenAutoFocus={(event) => {
          // The chosen day, so arrow keys work straight away.
          const day = grid.current?.querySelector<HTMLElement>("[data-selected]");
          if (!day) return;
          event.preventDefault();
          day.focus();
        }}
      >
        <div className="w-full overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="press rounded-md p-1.5 text-fg-3 hover:bg-surface-3 hover:text-fg"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-fg">
              {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </span>
            <button
              type="button"
              aria-label="Next month"
              disabled={!canGoForward}
              onClick={() => setMonth(nextMonthStart)}
              className="press rounded-md p-1.5 text-fg-3 hover:bg-surface-3 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid grid-cols-7 pb-1">
            {weekdays.map((day, i) => (
              <span key={i} className="py-1 text-center text-[11px] font-medium text-fg-3">
                {day}
              </span>
            ))}
          </div>

          <div ref={grid} role="grid" onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5">
            {days.map((day) => {
              const inMonth = day.getMonth() === month.getMonth();
              const selected = sameDay(day, current);
              const isToday = sameDay(day, today);
              const blocked = Boolean(limit && dayStart(day) > dayStart(limit));
              return (
                <button
                  key={day.getTime()}
                  type="button"
                  role="gridcell"
                  tabIndex={selected ? 0 : -1}
                  data-selected={selected || undefined}
                  aria-selected={selected}
                  aria-label={day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  disabled={blocked}
                  onClick={() => pickDay(day)}
                  className={cn(
                    "press tabular relative flex h-9 items-center justify-center rounded-md text-[13px]",
                    "focus-visible:outline-offset-0",
                    selected
                      ? "bg-volt font-semibold text-volt-ink"
                      : inMonth
                        ? "text-fg hover:bg-surface-3"
                        : "text-fg-3/60 hover:bg-surface-3",
                    blocked && "pointer-events-none opacity-25",
                  )}
                >
                  {day.getDate()}
                  {isToday && !selected ? <span className="absolute bottom-1 h-1 w-1 rounded-full bg-volt" aria-hidden /> : null}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <span className="mr-auto text-[13px] text-fg-2">Time</span>
            <input
              aria-label="Hours"
              inputMode="numeric"
              maxLength={2}
              value={hours}
              onFocus={(event) => event.target.select()}
              onChange={(event) => {
                const text = event.target.value.replace(/\D/g, "");
                setHours(text);
                applyTime(text, minutes);
              }}
              onBlur={() => setHours(pad(clampNumber(hours, 23) ?? current.getHours()))}
              className="tabular h-8 w-11 rounded-md border border-line bg-surface text-center text-sm text-fg focus:border-volt/60 focus:outline-none focus-visible:outline-none"
            />
            <span className="text-fg-3">:</span>
            <input
              aria-label="Minutes"
              inputMode="numeric"
              maxLength={2}
              value={minutes}
              onFocus={(event) => event.target.select()}
              onChange={(event) => {
                const text = event.target.value.replace(/\D/g, "");
                setMinutes(text);
                applyTime(hours, text);
              }}
              onBlur={() => setMinutes(pad(clampNumber(minutes, 59) ?? current.getMinutes()))}
              className="tabular h-8 w-11 rounded-md border border-line bg-surface text-center text-sm text-fg focus:border-volt/60 focus:outline-none focus-visible:outline-none"
            />
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const now = new Date();
                commit(now);
                setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                setHours(pad(now.getHours()));
                setMinutes(pad(now.getMinutes()));
              }}
            >
              Now
            </Button>
            <PopoverClose asChild>
              <Button size="sm" variant="secondary">
                Done
              </Button>
            </PopoverClose>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
