"use client";

import { MUSCLE_GROUP_LABELS, PR_KIND_LABELS } from "@lift/shared";
import { ChevronLeft, ChevronRight, Clock, Flame, Trophy } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { BarChart } from "@/components/charts/charts";
import { ExerciseThumb } from "@/components/exercises/exercise-thumb";
import { BodyControl, HeaderControl } from "@/components/stats/card-control";
import { StatsNav } from "@/components/stats/stats-nav";
import { Button, Card, CardBody, CardHeader, EmptyState, ListRow, PageHeader, Segmented, Stat } from "@/components/ui/primitives";
import { useModel } from "@/lib/data/model";
import { changeLabel, compactNumber, formatDateShort, integer, useFormat } from "@/lib/format";
import {
  bucketSessions,
  emptyTotals,
  periodTotals,
  sessionsIn,
  summarizeExercises,
  tallyMuscles,
  type PeriodTotals,
} from "@/lib/stats/aggregate";
import { addMonths, startOfMonth } from "@/lib/stats/windows";

const MONTHS = 12;

type Metric = "sessions" | "duration" | "volume" | "sets" | "reps";

const METRICS: { value: Metric; label: string }[] = [
  { value: "sessions", label: "Workouts" },
  { value: "duration", label: "Time" },
  { value: "volume", label: "Volume" },
  { value: "sets", label: "Sets" },
  { value: "reps", label: "Reps" },
];

const READ: Record<Metric, (totals: PeriodTotals) => number> = {
  sessions: (t) => t.sessions,
  duration: (t) => t.durationSeconds,
  volume: (t) => t.volumeKg,
  sets: (t) => t.sets,
  reps: (t) => t.reps,
};

export default function MonthlyPage() {
  const model = useModel();
  const f = useFormat();
  // Read once per visit: a report that shifts under the reader mid-page is worse than one a minute stale.
  const [now] = useState(() => Date.now());
  const thisMonth = startOfMonth(new Date(now)).getTime();
  const [month, setMonth] = useState(thisMonth);
  const [metric, setMetric] = useState<Metric>("sessions");

  const earliestMonth = model.firstSessionAt === null ? null : startOfMonth(new Date(model.firstSessionAt)).getTime();
  // Plain numbers rather than a shared Date: the compiler cannot prove a Date passed around is never mutated.
  const shift = (months: number) => addMonths(new Date(month), months).getTime();
  const monthEnd = shift(1);
  const span = useMemo(() => ({ from: month, to: monthEnd }), [month, monthEnd]);

  const series = useMemo(() => {
    const first = addMonths(new Date(month), -(MONTHS - 1));
    const starts = Array.from({ length: MONTHS }, (_, i) => {
      const start = addMonths(first, i);
      return { start: start.getTime(), label: start.toLocaleDateString(undefined, { month: "short" }) };
    });
    return bucketSessions(model, starts, monthEnd);
  }, [model, month, monthEnd]);

  const totals = series.at(-1) ?? { ...emptyTotals() };
  const previousStart = shift(-1);
  const inProgress = month === thisMonth;
  // A month still under way is compared with the same stretch of the one before,
  // not with all of it. And a month before the log began is no comparison at all.
  const previous = useMemo(() => {
    if (earliestMonth === null || previousStart < earliestMonth) return null;
    if (!inProgress) return series.at(-2) ?? emptyTotals();
    const elapsed = now - month;
    return periodTotals(model, { from: previousStart, to: Math.min(previousStart + elapsed, month) });
  }, [earliestMonth, previousStart, inProgress, series, month, model, now]);
  const comparedTo = inProgress ? "vs same days last month" : "vs last month";

  const sessions = useMemo(() => sessionsIn(model, span), [model, span]);
  const longest = useMemo(() => [...sessions].sort((a, b) => b.durationSeconds - a.durationSeconds)[0] ?? null, [sessions]);
  const biggest = useMemo(() => [...sessions].sort((a, b) => b.volumeKg - a.volumeKg)[0] ?? null, [sessions]);
  const topLifts = useMemo(() => summarizeExercises(model, span).slice(0, 5), [model, span]);
  const topMuscles = useMemo(
    () => tallyMuscles(model, span).filter((m) => m.directSets > 0).sort((a, b) => b.directSets - a.directSets).slice(0, 5),
    [model, span],
  );
  const records = useMemo(
    () => model.records.filter((record) => record.achievedAt >= month && record.achievedAt < monthEnd),
    [model, month, monthEnd],
  );

  const daysInMonth = Math.round((monthEnd - month) / 86_400_000);
  const title = new Date(month).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const chart = series.map((bucket) => ({
    label: bucket.label,
    title: new Date(bucket.start).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    value: metric === "volume" ? f.toWeight(READ[metric](bucket)) : READ[metric](bucket),
    highlight: bucket.start === month,
  }));

  const format = (value: number) =>
    metric === "volume" ? compactNumber(value) : metric === "duration" ? f.durationShort(value) : integer(value);

  const stat = (label: string, value: string, unit: string | undefined, now: number, before: number | undefined) => {
    const delta = previous && before !== undefined ? changeLabel(now, before) : null;
    return (
      <Stat
        label={label}
        value={value}
        unit={unit}
        hint={delta ? `${delta.text} ${comparedTo}` : previous ? (now > 0 ? "None last month" : undefined) : undefined}
        tone={delta?.tone}
      />
    );
  };

  const canBack = earliestMonth !== null && month > earliestMonth;
  const canForward = month < thisMonth;

  const picker = (
    <div className="flex items-center gap-1">
      <Button size="icon" variant="ghost" disabled={!canBack} onClick={() => setMonth(shift(-1))} aria-label="Previous month">
        <ChevronLeft size={18} />
      </Button>
      <span className="min-w-36 text-center text-sm font-medium text-fg">{title}</span>
      <Button size="icon" variant="ghost" disabled={!canForward} onClick={() => setMonth(shift(1))} aria-label="Next month">
        <ChevronRight size={18} />
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader title="Monthly report" subtitle={inProgress ? "This month so far, against the twelve before it" : "One month against the twelve before it"} actions={picker} />
      <StatsNav />

      <Card className="mb-6">
        <CardBody className="grid grid-cols-2 gap-6 pt-5 sm:grid-cols-3 xl:grid-cols-6">
          {stat("Workouts", integer(totals.sessions), undefined, totals.sessions, previous?.sessions)}
          {stat("Time", f.durationShort(totals.durationSeconds), undefined, totals.durationSeconds, previous?.durationSeconds)}
          {stat("Volume", f.volumeValue(totals.volumeKg), f.weightUnit, totals.volumeKg, previous?.volumeKg)}
          {stat("Sets", integer(totals.sets), undefined, totals.sets, previous?.sets)}
          {stat("Reps", integer(totals.reps), undefined, totals.reps, previous?.reps)}
          <Stat label="Active days" value={totals.activeDays} unit={`of ${daysInMonth}`} hint={`${records.length} ${records.length === 1 ? "record" : "records"}`} />
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="Twelve months"
          subtitle={`${title} highlighted`}
          action={<HeaderControl><Segmented size="sm" value={metric} options={METRICS} onChange={setMetric} /></HeaderControl>}
        />
        <CardBody>
          <BodyControl><Segmented size="sm" value={metric} options={METRICS} onChange={setMetric} /></BodyControl>
          <BarChart data={chart} format={format} valueLabel={METRICS.find((m) => m.value === metric)?.label} height={240} />
        </CardBody>
      </Card>

      {totals.sessions === 0 ? (
        <Card>
          <EmptyState title={`No workouts in ${title}`} body="Use the arrows to look at another month." />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader title="Highlights" />
            <div className="pt-3 pb-2">
              {longest ? (
                <ListRow href={`/history/${longest.id}`}>
                  <Clock size={18} className="shrink-0 text-info" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-fg-3">Longest session</div>
                    <div className="truncate text-sm text-fg">
                      {longest.name} · {formatDateShort(longest.startedAt)}
                    </div>
                  </div>
                  <span className="tabular text-sm font-medium text-fg">{f.durationShort(longest.durationSeconds)}</span>
                </ListRow>
              ) : null}
              {biggest ? (
                <ListRow href={`/history/${biggest.id}`}>
                  <Flame size={18} className="shrink-0 text-warn" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-fg-3">Biggest session</div>
                    <div className="truncate text-sm text-fg">
                      {biggest.name} · {formatDateShort(biggest.startedAt)}
                    </div>
                  </div>
                  <span className="tabular text-sm font-medium text-fg">{f.volume(biggest.volumeKg)}</span>
                </ListRow>
              ) : null}
              {topMuscles.map((muscle, index) => (
                <ListRow key={muscle.muscle}>
                  <span className="tabular w-[18px] shrink-0 text-center font-mono text-xs text-fg-3">{index + 1}</span>
                  <div className="min-w-0 flex-1 text-sm text-fg">{MUSCLE_GROUP_LABELS[muscle.muscle]}</div>
                  <span className="tabular text-sm text-fg-2">{integer(muscle.directSets)} sets</span>
                </ListRow>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Top lifts" subtitle="By sessions this month" />
            <div className="pt-3 pb-2">
              {topLifts.map((lift) => (
                <ListRow key={lift.exercise.id} href={`/exercises/${lift.exercise.id}`}>
                  <ExerciseThumb exercise={lift.exercise} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-fg">{lift.exercise.name}</div>
                    <div className="text-xs text-fg-3">
                      {lift.times} {lift.times === 1 ? "session" : "sessions"} · {lift.sets} sets
                    </div>
                  </div>
                  {lift.bestOneRepMaxKg > 0 ? (
                    <span className="tabular text-sm font-medium text-fg">{f.weight(lift.bestOneRepMaxKg)}</span>
                  ) : null}
                </ListRow>
              ))}
            </div>
          </Card>

          {records.length > 0 ? (
            <Card className="min-w-0 lg:col-span-2">
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Trophy size={16} className="text-record" /> Records this month
                  </span>
                }
                subtitle={`${records.length} personal ${records.length === 1 ? "best" : "bests"}`}
              />
              <ul className="grid px-5 pt-3 pb-4 sm:grid-cols-2 sm:gap-x-8">
                {records.slice(0, 20).map((record) => (
                  <li key={record.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5 text-sm">
                    <div className="min-w-0">
                      <Link href={`/exercises/${record.exerciseId}`} className="block truncate text-fg hover:text-volt">
                        {model.exercises.get(record.exerciseId)?.name ?? "Exercise"}
                      </Link>
                      <div className="text-xs text-fg-3">
                        {PR_KIND_LABELS[record.kind]} · {formatDateShort(record.achievedAt)}
                      </div>
                    </div>
                    <span className="tabular shrink-0 font-medium text-record">{f.record(record.kind, record.value)}</span>
                  </li>
                ))}
              </ul>
              {records.length > 20 ? <p className="px-5 pb-4 text-xs text-fg-3">And {records.length - 20} more.</p> : null}
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
