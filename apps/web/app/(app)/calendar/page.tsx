"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { SessionRow } from "@/components/overview/session-row";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { cn } from "@/lib/cn";
import { useModel } from "@/lib/data/model";
import { integer, useFormat } from "@/lib/format";
import {
  buildDayIndex,
  DAY_SHADE_TEXT,
  DAY_SHADES,
  dayKey,
  intensityStep,
  monthCells,
  summariseMonth,
  weekdayHeadings,
} from "@/lib/overview/days";
import { useSettings } from "@/lib/settings";
import { addMonths, startOfMonth } from "@/lib/stats/windows";

function parseDayKey(key: string | null): Date | null {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

function CalendarScreen() {
  const model = useModel();
  const f = useFormat();
  const firstDayOfWeek = useSettings((s) => s.firstDayOfWeek);
  const params = useSearchParams();

  const [today] = useState(() => new Date());
  const linked = parseDayKey(params.get("day"));
  const [month, setMonth] = useState(() => startOfMonth(linked ?? today));
  const [selected, setSelected] = useState<string | null>(() => (linked ? dayKey(linked) : dayKey(today)));

  const index = useMemo(() => buildDayIndex(model.sessions), [model.sessions]);
  const cells = useMemo(() => monthCells(month, firstDayOfWeek), [month, firstDayOfWeek]);
  const headings = useMemo(() => weekdayHeadings(firstDayOfWeek), [firstDayOfWeek]);
  const summary = useMemo(() => summariseMonth(index.days, month), [index, month]);
  const previous = useMemo(() => summariseMonth(index.days, addMonths(month, -1)), [index, month]);

  const firstMonth = index.first ? startOfMonth(index.first) : startOfMonth(today);
  const atStart = month <= firstMonth;
  const atEnd = month >= startOfMonth(today);
  const todayKey = dayKey(today);
  const selectedDay = selected ? index.days.get(selected) : undefined;
  const selectedDate = parseDayKey(selected);

  const go = (step: number) => {
    setMonth((current) => addMonths(current, step));
    setSelected(null);
  };

  if (model.sessions.length === 0) {
    return (
      <>
        <PageHeader title="Calendar" />
        <Card>
          <EmptyState icon={<CalendarDays size={28} />} title="No sessions yet" body="Training days appear here once the app on your phone syncs a finished session." />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Calendar" />

      <div className="grid grid-cols-1 gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="flex items-center justify-between gap-3 px-5 pt-5">
            <h2 className="text-lg font-semibold tracking-tight">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
            <div className="flex items-center gap-1">
              {!atEnd ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMonth(startOfMonth(today));
                    setSelected(todayKey);
                  }}
                >
                  Today
                </Button>
              ) : null}
              <Button variant="ghost" size="icon" onClick={() => go(-1)} disabled={atStart} aria-label="Previous month">
                <ChevronLeft size={18} />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => go(1)} disabled={atEnd} aria-label="Next month">
                <ChevronRight size={18} />
              </Button>
            </div>
          </div>
          <CardBody>
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {headings.map((heading, i) => (
                <div key={i} className="pb-1 text-center text-xs text-fg-3">
                  <span className="sm:hidden">{heading.narrow}</span>
                  <span className="hidden sm:inline">{heading.short}</span>
                </div>
              ))}
              {cells.map((date, i) => {
                if (!date) return <div key={`blank-${i}`} />;
                const key = dayKey(date);
                const entry = index.days.get(key);
                const step = entry ? intensityStep(entry.volumeKg, index.typicalVolumeKg) : -1;
                const future = date > today;
                const isSelected = key === selected;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={future}
                    onClick={() => setSelected(key)}
                    aria-pressed={isSelected}
                    aria-label={`${date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}${
                      entry ? `, ${entry.sessions.length} session${entry.sessions.length === 1 ? "" : "s"}` : ""
                    }`}
                    className={cn(
                      "press relative flex aspect-square flex-col items-center justify-center rounded-md text-sm sm:rounded-lg",
                      !entry && !future && "bg-surface-2 text-fg-2 hover:bg-surface-3",
                      future && "text-fg-3/50",
                      isSelected && "ring-2 ring-fg ring-offset-2 ring-offset-surface",
                      !isSelected && key === todayKey && "ring-1 ring-fg-3",
                    )}
                    style={entry ? { background: DAY_SHADES[step], color: DAY_SHADE_TEXT[step] } : undefined}
                  >
                    <span className="tabular font-medium">{date.getDate()}</span>
                    {entry && entry.sessions.length > 1 ? (
                      <span className="absolute bottom-1 flex gap-0.5 sm:bottom-1.5">
                        {entry.sessions.map((session) => (
                          <span key={session.id} className="h-1 w-1 rounded-full bg-current opacity-80" />
                        ))}
                      </span>
                    ) : null}
                    {entry && entry.prCount > 0 ? (
                      <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-record sm:top-1.5 sm:right-1.5" title="Personal record" />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-3">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-record" /> Personal record
              </span>
              <span className="flex items-center gap-1.5">
                Lighter
                {DAY_SHADES.map((shade) => (
                  <span key={shade} className="block h-2.5 w-2.5 rounded-[3px]" style={{ background: shade }} />
                ))}
                Heavier
              </span>
            </div>
          </CardBody>
        </Card>

        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold tracking-tight text-fg">This month</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <Stat label="Sessions" value={integer(summary.sessions)} />
              <Stat label="Active days" value={`${summary.activeDays}`} unit={`/ ${summary.daysInMonth}`} />
              <Stat label="Volume" value={f.volumeValue(summary.volumeKg)} unit={f.weightUnit} />
              <Stat label="Time" value={f.durationShort(summary.durationSeconds)} />
              <Stat label="Sets" value={integer(summary.sets)} />
              <Stat label="Records" value={integer(summary.prCount)} />
            </div>
            {previous.sessions > 0 ? (
              <p className="tabular mt-4 border-t border-line pt-3 text-xs text-fg-3">
                Previous month: {previous.sessions} sessions, {f.volume(previous.volumeKg)}
              </p>
            ) : null}
          </section>

          <section>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-tight text-fg">
                {selectedDate ? selectedDate.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) : "No day selected"}
              </h2>
              <span className="tabular shrink-0 text-[13px] text-fg-3">
                {selectedDay
                  ? `${selectedDay.sessions.length} session${selectedDay.sessions.length === 1 ? "" : "s"}, ${f.volume(selectedDay.volumeKg)}`
                  : selectedDate
                    ? "Rest day"
                    : null}
              </span>
            </div>
            {selectedDay ? (
              // Keyed by day so a new pick fades in, which marks that the list below changed.
              <Card key={selected} className="overflow-hidden transition-opacity duration-150 ease-out starting:opacity-0">
                {selectedDay.sessions.map((session) => (
                  <SessionRow key={session.id} session={session} f={f} showDate={false} />
                ))}
              </Card>
            ) : !selectedDate ? (
              <p className="text-sm text-fg-3">Pick a day to see what you trained.</p>
            ) : null}
          </section>
        </div>
      </div>
    </>
  );
}

export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarScreen />
    </Suspense>
  );
}
