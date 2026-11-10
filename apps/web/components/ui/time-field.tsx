/**
 * A time of day, or none: two typed fields for hours and minutes, a "Now"
 * button and a clear. Used where a time is optional, like when a meal was
 * eaten.
 *
 * Typed rather than picked, in place of the browser's time input (which draws
 * the operating system's own control): two numbers are faster to type than to
 * find. The value is `HH:mm` on a 24-hour clock, or null.
 */

"use client";

import { Clock, X } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";

import { Button, IconButton } from "./button";

const pad = (n: number) => String(n).padStart(2, "0");

/** The current time as `HH:mm`. */
export function nowClock(date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function split(value: string | null): [string, string] {
  const match = value ? /^(\d{2}):(\d{2})$/.exec(value) : null;
  return match ? [match[1]!, match[2]!] : ["", ""];
}

export function TimeField({
  value,
  onChange,
  className,
  "aria-label": ariaLabel = "Time",
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const [hours, setHours] = useState(() => split(value)[0]);
  const [minutes, setMinutes] = useState(() => split(value)[1]);
  const [shown, setShown] = useState(value);
  // A value set from outside (Now, clear, a different entry) refills the fields.
  if (value !== shown) {
    setShown(value);
    const [h, m] = split(value);
    setHours(h);
    setMinutes(m);
  }

  const commit = (h: string, m: string) => {
    const hour = /^\d{1,2}$/.test(h) ? Number(h) : NaN;
    const minute = /^\d{1,2}$/.test(m) ? Number(m) : m === "" ? 0 : NaN;
    if (!Number.isInteger(hour) || hour > 23 || !Number.isInteger(minute) || minute > 59) return;
    const next = `${pad(hour)}:${pad(minute)}`;
    setShown(next);
    onChange(next);
  };

  if (value === null && hours === "" && minutes === "") {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Button variant="secondary" size="sm" onClick={() => onChange(nowClock())}>
          <Clock size={14} /> Add time
        </Button>
        <span className="text-xs text-fg-3">Optional</span>
      </div>
    );
  }

  const fieldClass =
    "tabular h-9 w-11 rounded-lg border border-line bg-surface-2 text-center text-[15px] font-semibold text-fg outline-none focus:border-volt/60 focus:shadow-[0_0_0_3px_var(--ring)]";

  return (
    <div role="group" aria-label={ariaLabel} className={cn("flex items-center gap-2", className)}>
      <input
        value={hours}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, "").slice(0, 2);
          setHours(next);
          commit(next, minutes);
        }}
        onBlur={() => setHours(split(value)[0])}
        inputMode="numeric"
        aria-label="Hour, 0 to 23"
        placeholder="HH"
        className={fieldClass}
      />
      <span className="text-fg-3">:</span>
      <input
        value={minutes}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, "").slice(0, 2);
          setMinutes(next);
          commit(hours, next);
        }}
        onBlur={() => setMinutes(split(value)[1])}
        inputMode="numeric"
        aria-label="Minute"
        placeholder="MM"
        className={fieldClass}
      />
      <Button variant="ghost" size="sm" onClick={() => onChange(nowClock())}>
        Now
      </Button>
      <IconButton label="Clear time" size="sm" onClick={() => onChange(null)}>
        <X size={15} />
      </IconButton>
    </div>
  );
}
