/**
 * Pieces of the food statistics page: a calendar of days against the calorie
 * goal and the macro energy split. The same two the phone's statistics screen
 * draws, in the web app's design system.
 *
 * The calendar is its own component rather than the training-days graph
 * because it shades a day by a verdict (under, on target, over) rather than
 * by how heavy it was, but it reuses that graph's week arithmetic
 * (`contributionColumns`) so the two lay weeks out the same way. Colours
 * follow the food page: volt for eaten, alarm for over.
 */

"use client";

import { formatCalories, type MacroSplit, type StatsDay } from "@lift/shared";
import { useMemo } from "react";

import { MACRO_BG, MACROS } from "@/components/food/summary";
import { cn } from "@/lib/cn";
import { parseIsoDate, toIsoDate } from "@/lib/nutrition/dates";
import { contributionColumns, weekdayHeadings } from "@/lib/overview/days";

type Shade = "outside" | "empty" | "logged" | "under" | "on" | "over";

const SHADE_CLASS: Record<Shade, string> = {
  outside: "bg-transparent",
  empty: "bg-surface-3",
  logged: "bg-volt",
  under: "bg-volt/35",
  on: "bg-volt",
  over: "bg-alarm",
};

const SHADE_WORDS: Record<Shade, string> = {
  outside: "",
  empty: "Not logged",
  logged: "Logged",
  under: "Under",
  on: "On target",
  over: "Over",
};

/** Up to this many weeks the calendar is a month page; past it, a strip of week columns. */
const PAGE_WEEKS = 6;

/**
 * Every day of the range against the calorie goal. Short ranges read as a
 * calendar page with dates in the squares, long ones as a strip of week
 * columns, read for its pattern rather than day by day.
 */
export function AdherenceCalendar({
  from,
  to,
  today,
  daily,
  hasGoal,
  firstDayOfWeek,
}: {
  from: string;
  to: string;
  today: string;
  daily: StatsDay[];
  hasGoal: boolean;
  firstDayOfWeek: 0 | 1;
}) {
  const byDate = useMemo(() => new Map(daily.map((day) => [day.date, day])), [daily]);
  const headings = useMemo(() => weekdayHeadings(firstDayOfWeek), [firstDayOfWeek]);
  const weeks = useMemo(() => {
    const start = parseIsoDate(from);
    const end = parseIsoDate(to);
    const lead = (start.getDay() - firstDayOfWeek + 7) % 7;
    const tail = 6 - ((end.getDay() - firstDayOfWeek + 7) % 7);
    const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + lead + tail + 1;
    return contributionColumns(end, Math.max(1, Math.round(span / 7)), firstDayOfWeek).map((column) => column.map(toIsoDate));
  }, [from, to, firstDayOfWeek]);

  const shade = (iso: string): Shade => {
    if (iso < from || iso > to || iso > today) return "outside";
    const day = byDate.get(iso);
    if (!day) return "empty";
    return !hasGoal || day.verdict === null ? "logged" : day.verdict;
  };
  const title = (iso: string, value: Shade) => {
    const day = byDate.get(iso);
    const date = parseIsoDate(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    return `${date}: ${day ? `${formatCalories(day.calories)} kcal${day.inProgress ? " so far" : ""}, ` : ""}${SHADE_WORDS[value].toLowerCase()}`;
  };

  const legend: Shade[] = hasGoal ? ["empty", "under", "on", "over"] : ["empty", "logged"];

  return (
    <div>
      {weeks.length <= PAGE_WEEKS ? (
        <div className="grid grid-cols-7 gap-1.5">
          {headings.map((heading, index) => (
            <div key={index} className="pb-0.5 text-center text-[11px] text-fg-3">
              {heading.short}
            </div>
          ))}
          {weeks.flat().map((iso) => {
            const value = shade(iso);
            return (
              <div
                key={iso}
                title={value === "outside" ? undefined : title(iso, value)}
                aria-label={value === "outside" ? undefined : title(iso, value)}
                role={value === "outside" ? undefined : "img"}
                className={cn(
                  "tabular flex h-10 items-center justify-center rounded-md text-xs",
                  SHADE_CLASS[value],
                  value === "outside" ? "text-fg-3/50" : value === "on" || value === "logged" ? "font-medium text-volt-ink" : value === "over" ? "font-medium text-white" : "text-fg-2",
                  iso === today && "ring-1 ring-fg-2",
                )}
              >
                {parseIsoDate(iso).getDate()}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="grid shrink-0 grid-rows-7 gap-[3px] pt-[18px]">
            {headings.map((heading, index) => (
              <span key={index} className="h-3 text-[10px] leading-3 text-fg-3">
                {index % 2 === 1 ? heading.short.slice(0, 3) : ""}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto pb-1" dir="rtl">
            {/* Right to left so a strip wider than the card opens on today, then back to normal for the cells. */}
            <div className="inline-block" dir="ltr">
              <div className="mb-1.5 flex h-3 gap-[3px]">
                {weeks.map((week, index) => {
                  const month = parseIsoDate(week[0]!).toLocaleDateString(undefined, { month: "short" });
                  const previous = index > 0 ? parseIsoDate(weeks[index - 1]![0]!).toLocaleDateString(undefined, { month: "short" }) : null;
                  return (
                    <span key={week[0]} className="w-3 overflow-visible text-[10px] leading-3 whitespace-nowrap text-fg-3">
                      {month !== previous ? month : ""}
                    </span>
                  );
                })}
              </div>
              <div className="flex gap-[3px]">
                {weeks.map((week) => (
                  <div key={week[0]} className="flex flex-col gap-[3px]">
                    {week.map((iso) => {
                      const value = shade(iso);
                      return (
                        <span
                          key={iso}
                          title={value === "outside" ? undefined : title(iso, value)}
                          className={cn("block h-3 w-3 rounded-[3px]", SHADE_CLASS[value], iso === today && "ring-1 ring-fg-2")}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-fg-3">
        {legend.map((value) => (
          <span key={value} className="inline-flex items-center gap-1.5">
            <span className={cn("block h-2.5 w-2.5 rounded-[3px]", SHADE_CLASS[value])} />
            {SHADE_WORDS[value]}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Where the calories came from, as one bar split three ways, with the split
 * the goals imply as a thinner bar under it.
 */
export function MacroSplitBars({ split, goalSplit }: { split: MacroSplit; goalSplit: MacroSplit | null }) {
  return (
    <div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {MACROS.map((macro) =>
          split[macro.key] > 0 ? <div key={macro.key} className={MACRO_BG[macro.key]} style={{ flexGrow: split[macro.key] }} /> : null,
        )}
      </div>
      {goalSplit ? (
        <div className="mt-1.5 flex h-1 gap-0.5 overflow-hidden rounded-full opacity-45" aria-hidden>
          {MACROS.map((macro) => (
            <div key={macro.key} className={MACRO_BG[macro.key]} style={{ flexGrow: goalSplit[macro.key] }} />
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap justify-between gap-3 text-sm">
        {MACROS.map((macro) => (
          <span key={macro.key} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", MACRO_BG[macro.key])} aria-hidden />
            <span className="text-fg-2">{macro.label}</span>
            <span className="tabular font-semibold text-fg">{Math.round(split[macro.key] * 100)}%</span>
            {goalSplit ? <span className="tabular text-xs text-fg-3">/ {Math.round(goalSplit[macro.key] * 100)}%</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
