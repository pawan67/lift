"use client";

import { BODY_PART_LABELS, BODY_PARTS, type BodyPart } from "@lift/shared";
import Link from "next/link";
import { useMemo, useState } from "react";

import { BarChart, HBarList, type SeriesPoint } from "@/components/charts/charts";
import { ExerciseThumb } from "@/components/exercises/exercise-thumb";
import { rankColor } from "@/components/overview/body-parts";
import { BodyControl, HeaderControl } from "@/components/stats/card-control";
import { quietChange } from "@/components/stats/delta";
import { RangePicker } from "@/components/stats/range-picker";
import { MoreLink, Section, TH } from "@/components/stats/section";
import { StatsNav } from "@/components/stats/stats-nav";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Stat } from "@/components/ui/stat";
import { useModel } from "@/lib/data/model";
import { compactNumber, integer, useFormat } from "@/lib/format";
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

  const stat = (label: string, value: string, unit: string | undefined, now: number, before: number | undefined) => {
    const delta = previous && before !== undefined ? quietChange(now, before) : null;
    return <Stat label={label} value={value} unit={unit} hint={delta ? delta.text : previous ? "Nothing before" : undefined} tone={delta?.tone} size="sm" />;
  };

  const empty = totals.sessions === 0;
  const metricNote = metric === "volume" ? `Working-set volume, ${f.weightUnit}` : metric === "sets" ? "Working sets" : undefined;

  return (
    <>
      <PageHeader
        title="Statistics"
        subtitle={previous ? `${window.label}, against the ${window.label.replace(/^Last /, "").toLowerCase()} before` : window.label}
        actions={<RangePicker value={range} onChange={setRange} />}
      />
      <StatsNav />

      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-5 border-b border-line pb-6 sm:grid-cols-4 xl:grid-cols-7">
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
      </div>

      <Card className="mb-10">
        <CardHeader
          title="Over time"
          subtitle={metricNote}
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

      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
        <Section title="Sets by body part" meta="direct working sets" action={<MoreLink href="/stats/muscles">Muscles</MoreLink>}>
          {bodyParts.every((entry) => entry.sets === 0) ? (
            <EmptyState title="No working sets in this range" className="py-8" />
          ) : (
            <div className="pt-3">
              <HBarList
                items={bodyParts.map((entry, rank) => ({
                  key: entry.part,
                  label: BODY_PART_LABELS[entry.part as BodyPart],
                  value: entry.sets,
                  color: rankColor(rank),
                }))}
                format={(value) => integer(value)}
              />
            </div>
          )}
        </Section>

        <Section title="Most trained lifts" meta="by sessions" action={<MoreLink href="/stats/lifts">Lifts</MoreLink>}>
          {topLifts.length === 0 ? (
            <EmptyState title="No lifts in this range" className="py-8" />
          ) : (
            <>
              <div className={`flex justify-end ${TH}`}>Best est. 1RM</div>
              <ul>
                {topLifts.map((lift) => (
                  <li key={lift.exercise.id}>
                    <Link
                      href={`/exercises/${lift.exercise.id}`}
                      className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-surface-2"
                    >
                      <ExerciseThumb exercise={lift.exercise} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-fg">{lift.exercise.name}</div>
                        <div className="tabular text-xs text-fg-3">
                          {lift.times} {lift.times === 1 ? "session" : "sessions"}, {lift.sets} sets
                        </div>
                      </div>
                      <div className="tabular text-sm font-medium text-fg">{lift.bestOneRepMaxKg > 0 ? f.weight(lift.bestOneRepMaxKg) : <span className="text-fg-3">–</span>}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      </div>

      <div className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4">
        <MoreLink href="/history">Session history</MoreLink>
        <MoreLink href="/records">Personal records</MoreLink>
      </div>
    </>
  );
}
