"use client";

import { BODY_PART_LABELS, BODY_PARTS, type BodyPart } from "@lift/shared";
import { CalendarDays, ChevronRight, FileText, History, LineChart, PieChart, Trophy, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { BarChart, HBarList, type SeriesPoint } from "@/components/charts/charts";
import { ExerciseThumb } from "@/components/exercises/exercise-thumb";
import { RangePicker } from "@/components/stats/range-picker";
import { BodyControl, HeaderControl } from "@/components/stats/card-control";
import { StatsNav } from "@/components/stats/stats-nav";
import { Card, CardBody, CardHeader, EmptyState, ListRow, PageHeader, Segmented, Stat } from "@/components/ui/primitives";
import { useModel } from "@/lib/data/model";
import { changeLabel, compactNumber, integer, useFormat } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import {
  bucketSessions,
  periodTotals,
  summarizeExercises,
  tallyBodyParts,
  tallyMuscles,
  type PeriodTotals,
  type TimeBucket,
} from "@/lib/stats/aggregate";
import {
  bucketLabel,
  bucketsFor,
  eachDay,
  granularityForMonths,
  monthsBetween,
  statWindow,
  type Granularity,
  type StatRange,
} from "@/lib/stats/windows";

type Metric = "volume" | "sets" | "sessions" | "duration";

const METRICS: { value: Metric; label: string }[] = [
  { value: "volume", label: "Volume" },
  { value: "sets", label: "Sets" },
  { value: "sessions", label: "Sessions" },
  { value: "duration", label: "Time" },
];

const METRIC_VALUE: Record<Metric, (bucket: TimeBucket) => number> = {
  volume: (bucket) => bucket.volumeKg,
  sets: (bucket) => bucket.sets,
  sessions: (bucket) => bucket.sessions,
  duration: (bucket) => bucket.durationSeconds,
};

/** Day bars for a week, week bars up to a quarter, then months and coarser. */
function granularityFor(range: StatRange, firstSessionAt: number | null): Granularity | "day" {
  switch (range) {
    case "7d":
      return "day";
    case "30d":
    case "3m":
      return "week";
    case "1y":
      return "month";
    case "all":
      return firstSessionAt === null ? "month" : granularityForMonths(monthsBetween(new Date(firstSessionAt), new Date()));
  }
}

function avgSession(totals: PeriodTotals): number {
  return totals.sessions > 0 ? totals.durationSeconds / totals.sessions : 0;
}

export default function StatsPage() {
  const model = useModel();
  const f = useFormat();
  const firstDayOfWeek = useSettings((s) => s.firstDayOfWeek);
  const [range, setRange] = useState<StatRange>("30d");
  const [metric, setMetric] = useState<Metric>("volume");

  const window = useMemo(() => statWindow(range), [range]);
  const span = useMemo(() => ({ from: window.from?.getTime() ?? null, to: window.to.getTime() }), [window]);

  const totals = useMemo(() => periodTotals(model, span), [model, span]);
  const previous = useMemo(
    () => (window.previous ? periodTotals(model, { from: window.previous.from.getTime(), to: window.previous.to.getTime() }) : null),
    [model, window],
  );

  const buckets = useMemo(() => {
    const granularity = granularityFor(range, model.firstSessionAt);
    const earliest = model.firstSessionAt === null ? null : new Date(model.firstSessionAt);
    const starts =
      granularity === "day"
        ? eachDay(window.from!, window.to).map((date) => ({
            start: date.getTime(),
            label: date.toLocaleDateString(undefined, { weekday: "short" }),
          }))
        : bucketsFor(window, granularity, earliest, firstDayOfWeek).map((bucket) => ({
            start: bucket.start,
            label: bucket.label || bucketLabel(new Date(bucket.start), granularity),
          }));
    return bucketSessions(model, starts, window.to.getTime(), window.from?.getTime() ?? null);
  }, [model, range, window, firstDayOfWeek]);

  const chartData: SeriesPoint[] = useMemo(() => {
    const read = METRIC_VALUE[metric];
    return buckets.map((bucket) => ({
      label: bucket.label,
      title: new Date(bucket.start).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
      value: metric === "volume" ? f.toWeight(read(bucket)) : read(bucket),
    }));
  }, [buckets, metric, f]);

  const chartFormat = (value: number) =>
    metric === "volume"
      ? `${compactNumber(value)}`
      : metric === "duration"
        ? f.durationShort(value)
        : integer(value);

  const bodyParts = useMemo(() => {
    const parts = tallyBodyParts(tallyMuscles(model, span));
    return BODY_PARTS.filter((part) => part !== "other")
      .map((part) => ({ part, sets: parts.get(part)?.directSets ?? 0 }))
      .sort((a, b) => b.sets - a.sets);
  }, [model, span]);

  const topLifts = useMemo(() => summarizeExercises(model, span).slice(0, 5), [model, span]);

  const change = (now: number, before: number | undefined) => (previous && before !== undefined ? changeLabel(now, before) : null);
  const stat = (label: string, value: string, unit: string | undefined, now: number, before: number | undefined) => {
    const delta = change(now, before);
    return (
      <Stat
        label={label}
        value={value}
        unit={unit}
        hint={delta ? `${delta.text} vs previous` : previous ? "Nothing before" : undefined}
        tone={delta?.tone}
      />
    );
  };

  const empty = totals.sessions === 0;

  return (
    <>
      <PageHeader title="Statistics" subtitle={window.label} actions={<RangePicker value={range} onChange={setRange} />} />
      <StatsNav />

      <Card className="mb-6">
        <CardBody className="grid grid-cols-2 gap-x-6 gap-y-6 pt-5 sm:grid-cols-4 xl:grid-cols-7">
          {stat("Sessions", integer(totals.sessions), undefined, totals.sessions, previous?.sessions)}
          {stat("Volume", f.volumeValue(totals.volumeKg), f.weightUnit, totals.volumeKg, previous?.volumeKg)}
          {stat("Sets", integer(totals.sets), undefined, totals.sets, previous?.sets)}
          {stat("Reps", integer(totals.reps), undefined, totals.reps, previous?.reps)}
          {stat("Time", f.durationShort(totals.durationSeconds), undefined, totals.durationSeconds, previous?.durationSeconds)}
          {stat(
            "Avg session",
            totals.sessions ? f.durationShort(avgSession(totals)) : "–",
            undefined,
            avgSession(totals),
            previous ? avgSession(previous) : undefined,
          )}
          {stat("Records", integer(totals.records), undefined, totals.records, previous?.records)}
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="Over time"
          subtitle={metric === "volume" ? `Working-set volume, ${f.weightUnit}` : METRICS.find((m) => m.value === metric)?.label}
          action={<HeaderControl><Segmented size="sm" value={metric} options={METRICS} onChange={setMetric} /></HeaderControl>}
        />
        <CardBody>
          <BodyControl><Segmented size="sm" value={metric} options={METRICS} onChange={setMetric} /></BodyControl>
          {empty && range !== "all" ? (
            <EmptyState title="No sessions in this range" body="Pick a longer range, or log a workout on your phone." />
          ) : (
            <BarChart
              data={chartData}
              format={chartFormat}
              valueLabel={METRICS.find((m) => m.value === metric)?.label}
              average={chartData.length > 1 ? chartData.reduce((sum, point) => sum + point.value, 0) / chartData.length : undefined}
              height={260}
            />
          )}
        </CardBody>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader
            title="Where the sets went"
            subtitle="Direct working sets by body part"
            action={<SeeAll href="/stats/muscles" />}
          />
          <CardBody>
            {bodyParts.every((entry) => entry.sets === 0) ? (
              <EmptyState title="No working sets in this range" className="py-8" />
            ) : (
              <HBarList
                items={bodyParts.map((entry) => ({
                  key: entry.part,
                  label: BODY_PART_LABELS[entry.part as BodyPart],
                  value: entry.sets,
                }))}
                format={(value) => `${integer(value)} sets`}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Most trained lifts" subtitle="By sessions in this range" action={<SeeAll href="/stats/lifts" />} />
          <div className="pt-3 pb-2">
            {topLifts.length === 0 ? (
              <EmptyState title="No lifts in this range" className="py-8" />
            ) : (
              topLifts.map((lift) => (
                <ListRow key={lift.exercise.id} href={`/exercises/${lift.exercise.id}`}>
                  <ExerciseThumb exercise={lift.exercise} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-fg">{lift.exercise.name}</div>
                    <div className="text-xs text-fg-3">
                      {lift.times} {lift.times === 1 ? "session" : "sessions"} · {lift.sets} sets
                    </div>
                  </div>
                  {lift.bestOneRepMaxKg > 0 ? (
                    <div className="text-right">
                      <div className="tabular text-sm font-medium text-fg">{f.weight(lift.bestOneRepMaxKg)}</div>
                      <div className="text-[11px] text-fg-3">est. 1RM</div>
                    </div>
                  ) : null}
                </ListRow>
              ))
            )}
          </div>
        </Card>
      </div>

      <h2 className="mb-3 font-mono text-[11px] tracking-widest text-fg-3 uppercase">Explore</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Explore href="/stats/muscles" icon={PieChart} title="Muscles" body="Weekly sets against growth landmarks, body-part balance" />
        <Explore href="/stats/lifts" icon={LineChart} title="Lifts" body="Main exercises, estimated 1RM progress, leaderboard" />
        <Explore href="/stats/monthly" icon={CalendarDays} title="Monthly report" body="One month against the twelve around it" />
        <Explore href="/stats/report" icon={FileText} title="Training report" body="Last week, month or quarter, as a page or a PDF" />
        <Explore href="/history" icon={History} title="History" body="Every session, set by set" />
        <Explore href="/records" icon={Trophy} title="Personal records" body="Bests per exercise, by kind and date" />
      </div>
    </>
  );
}

function SeeAll({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-0.5 text-xs text-fg-3 hover:text-volt">
      Details <ChevronRight size={14} />
    </Link>
  );
}

function Explore({ href, icon: Icon, title, body }: { href: string; icon: LucideIcon; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-(--radius-card) border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-volt-tint text-volt">
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{title}</div>
        <div className="mt-0.5 text-xs text-fg-3">{body}</div>
      </div>
      <ChevronRight size={16} className="mt-2 text-fg-3 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
