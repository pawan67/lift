"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import type { Formatter } from "@/lib/format";
import {
  contributionColumns,
  DAY_SHADES,
  dayKey,
  intensityStep,
  weekdayHeadings,
  type DayIndex,
} from "@/lib/overview/days";

const GAP = 3;
const MIN_CELL = 11;
const MAX_CELL = 18;

/**
 * A year of training as a grid of days, one column per week, shaded by volume
 * against the typical day. On a narrow screen it scrolls sideways and opens on
 * the current week, which is the end anyone looks at first.
 */
export function ContributionGraph({
  index,
  firstDayOfWeek,
  f,
  weeks = 53,
}: {
  index: DayIndex;
  firstDayOfWeek: 0 | 1;
  f: Formatter;
  weeks?: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Cells grow to fill a wide card and stop shrinking at a size still worth
  // aiming a pointer at; below that the grid scrolls instead.
  const [cell, setCell] = useState(12);
  const today = useMemo(() => new Date(), []);
  const todayKey = dayKey(today);
  const columns = useMemo(() => contributionColumns(today, weeks, firstDayOfWeek), [today, weeks, firstDayOfWeek]);
  const headings = useMemo(() => weekdayHeadings(firstDayOfWeek), [firstDayOfWeek]);

  // A month label sits over the first column that contains the 1st.
  const monthLabels = useMemo(
    () =>
      columns.map((column, i) => {
        const first = column.find((day) => day.getDate() === 1);
        if (!first && i !== 0) return null;
        const date = first ?? column[0]!;
        return date.toLocaleDateString(undefined, { month: "short" });
      }),
    [columns],
  );

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const fit = () => {
      const size = Math.floor(node.clientWidth / weeks) - GAP;
      setCell(Math.max(MIN_CELL, Math.min(MAX_CELL, size)));
      node.scrollLeft = node.scrollWidth;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [weeks]);

  let trainedDays = 0;
  for (const column of columns) for (const day of column) if (index.days.has(dayKey(day))) trainedDays += 1;

  return (
    <div>
      <div className="flex gap-2">
        <div className="shrink-0 pt-[18px]" style={{ display: "grid", gridTemplateRows: `repeat(7, ${cell}px)`, rowGap: GAP }}>
          {headings.map((heading, i) => (
            <span key={i} className="font-mono text-[9px] text-fg-3"
              style={{ lineHeight: `${cell}px` }}>
              {i % 2 === 1 ? heading.short.slice(0, 3) : ""}
            </span>
          ))}
        </div>
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto pb-1">
          <div className="inline-block">
            <div className="relative mb-1.5 h-3" style={{ width: columns.length * (cell + GAP) }}>
              {monthLabels.map((label, i) =>
                label ? (
                  <span
                    key={i}
                    className="absolute font-mono text-[9px] leading-3 text-fg-3"
                    style={{ left: i * (cell + GAP) }}
                  >
                    {i === 0 && columns[0]![0]!.getDate() > 20 ? "" : label}
                  </span>
                ) : null,
              )}
            </div>
            <div className="flex" style={{ gap: GAP }}>
              {columns.map((column, i) => (
                <div key={i} className="flex flex-col" style={{ gap: GAP }}>
                  {column.map((day) => {
                    const key = dayKey(day);
                    const entry = index.days.get(key);
                    const future = day > today;
                    const label = `${day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}${
                      entry ? `: ${entry.sessions.length} session${entry.sessions.length === 1 ? "" : "s"}, ${f.volume(entry.volumeKg)}` : ""
                    }`;
                    const square = (
                      <span
                        className={cn("block rounded-[3px]", key === todayKey && "ring-1 ring-fg-2")}
                        style={{
                          width: cell,
                          height: cell,
                          background: entry
                            ? DAY_SHADES[intensityStep(entry.volumeKg, index.typicalVolumeKg)]
                            : future
                              ? "transparent"
                              : "var(--surface-3)",
                        }}
                      />
                    );
                    return entry ? (
                      <Link
                        key={key}
                        href={entry.sessions.length === 1 ? `/history/${entry.sessions[0]!.id}` : `/calendar?day=${key}`}
                        title={label}
                        aria-label={label}
                      >
                        {square}
                      </Link>
                    ) : (
                      <span key={key} title={future ? undefined : label}>
                        {square}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-3">
        <span className="tabular">
          {trainedDays} training day{trainedDays === 1 ? "" : "s"} in the last year
        </span>
        <span className="flex items-center gap-1.5">
          Lighter
          <span className="block h-2.5 w-2.5 rounded-[3px] bg-surface-3" />
          {DAY_SHADES.map((shade) => (
            <span key={shade} className="block h-2.5 w-2.5 rounded-[3px]" style={{ background: shade }} />
          ))}
          Heavier
        </span>
      </div>
    </div>
  );
}
