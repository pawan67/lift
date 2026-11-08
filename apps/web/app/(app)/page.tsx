"use client";

import { BODY_PART_LABELS, computeWeekStreak, PR_KIND_LABELS } from "@lift/shared";
import { ArrowRight, Dumbbell, Flame, Trophy } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { BarChart, HBarList, TimeChart } from "@/components/charts/charts";
import { bodyPartColor } from "@/components/overview/body-parts";
import { ContributionGraph } from "@/components/overview/contribution-graph";
import { SessionRow } from "@/components/overview/session-row";
import {
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Segmented,
  Stat,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useData } from "@/lib/data/store";
import { useModel } from "@/lib/data/model";
import { changeLabel, compactNumber, formatDateShort, integer, relativeDay, useFormat } from "@/lib/format";
import { buildDayIndex, dayKey, DAY_SHADES, intensityStep } from "@/lib/overview/days";
import { pickMetric, setsByBodyPart, totalsBetween, weeklyBuckets, type TrendMetric } from "@/lib/overview/totals";
import { useSettings } from "@/lib/settings";
import { addDays, formatWeekRange, startOfWeek } from "@/lib/stats/windows";

const DAY_MS = 86_400_000;

const METRICS: { value: TrendMetric; label: string }[] = [
  { value: "volume", label: "Volume" },
  { value: "duration", label: "Time" },
  { value: "sets", label: "Sets" },
  { value: "reps", label: "Reps" },
];

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const model = useModel();
  const f = useFormat();
  const firstDayOfWeek = useSettings((s) => s.firstDayOfWeek);
  const user = useData((s) => s.user);
  const [metric, setMetric] = useState<TrendMetric>("volume");

  const now = useMemo(() => new Date(), []);

  const week = useMemo(() => {
    const start = startOfWeek(now, firstDayOfWeek).getTime();
    const elapsed = now.getTime() - start;
    const lastStart = start - 7 * DAY_MS;
    return {
      start,
      current: totalsBetween(model.sessions, start, Infinity),
      // The same stretch of last week, so Wednesday is not measured against a whole week.
      lastSoFar: totalsBetween(model.sessions, lastStart, lastStart + elapsed),
      lastFull: totalsBetween(model.sessions, lastStart, start),
    };
  }, [model.sessions, now, firstDayOfWeek]);

  const streak = useMemo(() => computeWeekStreak(model.sessions.map((s) => new Date(s.startedAt)), now), [model.sessions, now]);
  const dayIndex = useMemo(() => buildDayIndex(model.sessions), [model.sessions]);
  const buckets = useMemo(() => weeklyBuckets(model.sessions, 12, firstDayOfWeek, now), [model.sessions, firstDayOfWeek, now]);
  const bodyParts = useMemo(() => setsByBodyPart(model.sessions, now.getTime() - 30 * DAY_MS), [model.sessions, now]);

  const trend = useMemo(
    () =>
      buckets.map((bucket, i) => {
        const raw = pickMetric(bucket.totals, metric);
        return {
          label: bucket.start.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
          title: formatWeekRange(bucket.start),
          value: metric === "volume" ? f.toWeight(raw) : metric === "duration" ? raw / 60 : raw,
          highlight: i === buckets.length - 1 ? false : undefined,
        };
      }),
    [buckets, metric, f],
  );

  const trendAverage = useMemo(() => {
    const done = trend.slice(0, -1).filter((point) => point.value > 0);
    return done.length > 0 ? done.reduce((sum, point) => sum + point.value, 0) / done.length : 0;
  }, [trend]);

  const formatTrend = (value: number) => {
    if (metric === "volume") return `${compactNumber(value)}`;
    if (metric === "duration") return value >= 60 ? `${Math.round(value / 60)}h` : `${Math.round(value)}m`;
    return compactNumber(value);
  };
  const formatTrendTooltip = (value: number) => {
    if (metric === "volume") return `${integer(value)} ${f.weightUnit}`;
    if (metric === "duration") return f.durationShort(value * 60);
    return `${integer(value)} ${metric}`;
  };

  const bodyweight = useMemo(() => {
    const rows = model.measurements.get("bodyweight") ?? [];
    const since = now.getTime() - 120 * DAY_MS;
    const recent = rows.filter((row) => row.measuredAt >= since);
    const points = (recent.length >= 2 ? recent : rows.slice(-12)).map((row) => ({ t: row.measuredAt, value: f.toWeight(row.value) }));
    const latest = rows.at(-1) ?? null;
    const monthAgo = [...rows].reverse().find((row) => row.measuredAt <= (latest?.measuredAt ?? 0) - 28 * DAY_MS) ?? null;
    return { points, latest, delta: latest && monthAgo ? latest.value - monthAgo.value : null };
  }, [model.measurements, now, f]);

  const recentRecords = useMemo(() => {
    // One line per exercise and kind: a lift that set three records in a session reads as one achievement each.
    const seen = new Set<string>();
    return model.records
      .filter((record) => {
        const key = `${record.exerciseId}:${record.kind}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }, [model.records]);

  const name = user?.name?.split(" ")[0];

  if (model.sessions.length === 0) {
    return (
      <>
        <PageHeader title={name ? `${greeting(now)}, ${name}` : "Dashboard"} />
        <Card>
          <EmptyState
            icon={<Dumbbell size={28} />}
            title="No sessions yet"
            body="Workouts you log in the Lift app on your phone show up here once it syncs. Meanwhile you can set up routines and browse exercises."
            action={
              <div className="flex gap-2">
                <ButtonLink href="/routines" variant="primary">
                  Plan a routine
                </ButtonLink>
                <ButtonLink href="/measurements">Log bodyweight</ButtonLink>
              </div>
            }
          />
        </Card>
      </>
    );
  }

  const tiles = [
    { label: "Sessions", value: integer(week.current.sessions), now: week.current.sessions, before: week.lastSoFar.sessions, unit: undefined },
    { label: "Volume", value: f.volumeValue(week.current.volumeKg), now: week.current.volumeKg, before: week.lastSoFar.volumeKg, unit: f.weightUnit },
    { label: "Sets", value: integer(week.current.sets), now: week.current.sets, before: week.lastSoFar.sets, unit: undefined },
    { label: "Time", value: f.durationShort(week.current.durationSeconds), now: week.current.durationSeconds, before: week.lastSoFar.durationSeconds, unit: undefined },
  ];

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(new Date(week.start), i));
  const todayKey = dayKey(now);

  return (
    <>
      <PageHeader
        title={name ? `${greeting(now)}, ${name}` : "Dashboard"}
        subtitle={`Last session ${relativeDay(model.sessions[0]!.startedAt).toLowerCase()}: ${model.sessions[0]!.name}`}
        actions={
          <ButtonLink href="/stats" variant="outline" size="sm">
            All statistics <ArrowRight size={14} />
          </ButtonLink>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="This week" subtitle={`${formatWeekRange(new Date(week.start))}, compared with the same days last week`} />
          <CardBody className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            {tiles.map((tile) => {
              const change = changeLabel(tile.now, tile.before);
              return (
                <Stat
                  key={tile.label}
                  label={tile.label}
                  value={tile.value}
                  unit={tile.unit}
                  hint={change ? `${change.text} vs last week` : tile.before === 0 && tile.now > 0 ? "None by now last week" : "Nothing yet"}
                  tone={change?.tone}
                />
              );
            })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Streak" subtitle="Consecutive weeks with a session" />
          <CardBody>
            <div className="flex items-baseline gap-2">
              <Flame size={22} className={streak > 0 ? "self-center text-warn" : "self-center text-fg-3"} />
              <span className="tabular text-3xl font-semibold">{streak}</span>
              <span className="text-sm text-fg-3">week{streak === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-4 grid grid-cols-7 gap-1.5">
              {weekDays.map((day) => {
                const key = dayKey(day);
                const entry = dayIndex.days.get(key);
                const shade = entry ? DAY_SHADES[intensityStep(entry.volumeKg, dayIndex.typicalVolumeKg)] : undefined;
                return (
                  <div key={key} className="flex flex-col items-center gap-1">
                    <span className={cn("font-mono text-[10px]", key === todayKey ? "text-fg" : "text-fg-3")}>
                      {day.toLocaleDateString(undefined, { weekday: "narrow" })}
                    </span>
                    <span
                      title={entry ? `${entry.sessions.map((s) => s.name).join(", ")}: ${f.volume(entry.volumeKg)}` : undefined}
                      className={cn(
                        "block h-7 w-full rounded-md",
                        !entry && "bg-surface-3",
                        key === todayKey && "ring-1 ring-fg-2",
                        day > now && !entry && "bg-surface-2",
                      )}
                      style={shade ? { background: shade } : undefined}
                    />
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-fg-3">
              Last week: {week.lastFull.sessions} session{week.lastFull.sessions === 1 ? "" : "s"}, {f.volume(week.lastFull.volumeKg)}
            </p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Last 12 weeks"
            subtitle={metric === "volume" ? `Weekly volume, ${f.weightUnit}` : metric === "duration" ? "Weekly training time" : `Weekly ${metric}`}
            action={<Segmented size="sm" value={metric} options={METRICS} onChange={setMetric} />}
          />
          <CardBody>
            <BarChart
              data={trend}
              format={formatTrend}
              valueLabel={METRICS.find((m) => m.value === metric)!.label}
              average={trendAverage}
              height={230}
            />
            <TooltipFormatHint format={formatTrendTooltip} value={trend.at(-1)?.value ?? 0} label="This week so far" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sets by body part" subtitle="Last 30 days, secondary muscles at half" />
          <CardBody>
            {bodyParts.length > 0 ? (
              <HBarList
                items={bodyParts.map((entry) => ({
                  key: entry.part,
                  label: BODY_PART_LABELS[entry.part],
                  value: entry.sets,
                  color: bodyPartColor(entry.part),
                }))}
                format={(value) => `${Math.round(value * 10) / 10}`}
              />
            ) : (
              <p className="py-6 text-center text-sm text-fg-3">No sets in the last 30 days.</p>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Training year"
            subtitle="Every day of the last year, shaded by volume against your typical session"
            action={
              <Link href="/calendar" className="text-xs text-fg-3 hover:text-fg">
                Calendar
              </Link>
            }
          />
          <CardBody>
            <ContributionGraph index={dayIndex} firstDayOfWeek={firstDayOfWeek} f={f} />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent sessions"
            action={
              <Link href="/history" className="text-xs text-fg-3 hover:text-fg">
                View all
              </Link>
            }
          />
          <div className="mt-3 border-t border-line">
            {model.sessions.slice(0, 6).map((session) => (
              <SessionRow key={session.id} session={session} f={f} />
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Bodyweight"
              subtitle={bodyweight.latest ? `Logged ${relativeDay(bodyweight.latest.measuredAt).toLowerCase()}` : undefined}
              action={
                <Link href="/measurements/bodyweight" className="text-xs text-fg-3 hover:text-fg">
                  Details
                </Link>
              }
            />
            <CardBody>
              {bodyweight.latest ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="tabular text-2xl font-semibold">{f.weightValue(bodyweight.latest.value)}</span>
                    <span className="text-sm text-fg-3">{f.weightUnit}</span>
                    {bodyweight.delta !== null ? (
                      <span className="tabular ml-auto text-xs text-fg-3">
                        {bodyweight.delta > 0 ? "+" : bodyweight.delta < 0 ? "−" : ""}
                        {f.weight(Math.abs(bodyweight.delta))} in 4 weeks
                      </span>
                    ) : null}
                  </div>
                  {bodyweight.points.length >= 2 ? (
                    <div className="mt-3 -mx-1">
                      <TimeChart data={bodyweight.points} height={110} format={(v) => v.toFixed(1)} valueLabel="Bodyweight" />
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-fg-3">
                  No weigh-ins yet.{" "}
                  <Link href="/measurements/bodyweight" className="text-volt hover:underline">
                    Log one
                  </Link>
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent records"
              action={
                <Link href="/records" className="text-xs text-fg-3 hover:text-fg">
                  All records
                </Link>
              }
            />
            {recentRecords.length > 0 ? (
              <ul className="mt-3 border-t border-line">
                {recentRecords.map((record) => {
                  const exercise = model.exercises.get(record.exerciseId);
                  return (
                    <li key={record.id}>
                      <Link
                        href={`/exercises/${encodeURIComponent(record.exerciseId)}`}
                        className="flex items-center gap-3 border-t border-line px-5 py-2.5 transition-colors first:border-t-0 hover:bg-surface-2"
                      >
                        <Trophy size={15} className="shrink-0 text-record" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-fg">{exercise?.name ?? "Unknown exercise"}</div>
                          <div className="text-xs text-fg-3">
                            {PR_KIND_LABELS[record.kind]} · {formatDateShort(record.achievedAt)}
                          </div>
                        </div>
                        <span className="tabular shrink-0 text-sm font-medium">{f.record(record.kind, record.value)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <CardBody>
                <p className="text-sm text-fg-3">No records yet.</p>
              </CardBody>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/** The chart's axis is compact; the exact figure for the week in progress sits under it. */
function TooltipFormatHint({ format, value, label }: { format: (value: number) => string; value: number; label: string }) {
  return (
    <p className="tabular mt-2 text-xs text-fg-3">
      {label}: <span className="text-fg-2">{format(value)}</span>. The dashed line is the 11-week average.
    </p>
  );
}
