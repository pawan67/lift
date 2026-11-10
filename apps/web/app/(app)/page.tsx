"use client";

import { BODY_PART_LABELS, computeWeekStreak, PR_KIND_LABELS } from "@lift/shared";
import { ArrowRight, Dumbbell } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { BarChart, HBarList, TimeChart } from "@/components/charts/charts";
import { rankColor } from "@/components/overview/body-parts";
import { ContributionGraph } from "@/components/overview/contribution-graph";
import { SessionRow } from "@/components/overview/session-row";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Stat } from "@/components/ui/stat";
import { cn } from "@/lib/cn";
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

export default function DashboardPage() {
  const model = useModel();
  const f = useFormat();
  const firstDayOfWeek = useSettings((s) => s.firstDayOfWeek);
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

  const title = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  if (model.sessions.length === 0) {
    return (
      <>
        <PageHeader title={title} />
        <Card>
          <EmptyState
            icon={<Dumbbell size={28} />}
            title="No sessions yet"
            body="Workouts logged in the Lift app on your phone show up here after it syncs. Routines and exercises can be set up here meanwhile."
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
  const last = model.sessions[0]!;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          <>
            Last session {relativeDay(last.startedAt).toLowerCase()}:{" "}
            <Link href={`/history/${last.id}`} className="text-fg-2 transition-colors duration-150 hover:text-fg">
              {last.name || "Workout"}
            </Link>
          </>
        }
        actions={
          <ButtonLink href="/stats" variant="outline" size="sm">
            All statistics <ArrowRight size={14} />
          </ButtonLink>
        }
      />

      {/* The week sits on the page itself: it is the first thing read, not one card among many. */}
      <section className="mb-8 grid gap-x-10 gap-y-6 border-b border-line pb-7 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div>
          <SectionHeading title="This week" meta={formatWeekRange(new Date(week.start))} />
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            {tiles.map((tile) => {
              const hint = weekDelta(tile.now, tile.before);
              return <Stat key={tile.label} label={tile.label} value={tile.value} unit={tile.unit} hint={hint.text} tone={hint.tone} />;
            })}
          </div>
        </div>

        <div className="lg:border-l lg:border-line lg:pl-10">
          <SectionHeading title="Streak" meta={streak > 0 ? `${streak} week${streak === 1 ? "" : "s"} running` : "None running"} metaClassName={streak > 0 ? "text-fg-2" : undefined} />
          <div className="grid grid-cols-7 gap-1">
            {weekDays.map((day) => {
              const key = dayKey(day);
              const entry = dayIndex.days.get(key);
              const shade = entry ? DAY_SHADES[intensityStep(entry.volumeKg, dayIndex.typicalVolumeKg)] : undefined;
              return (
                <div key={key} className="flex flex-col items-center gap-1.5">
                  <span className={cn("text-[11px] leading-none", key === todayKey ? "font-medium text-fg" : "text-fg-3")}>
                    {day.toLocaleDateString(undefined, { weekday: "narrow" })}
                  </span>
                  <span
                    title={entry ? `${entry.sessions.map((s) => s.name).join(", ")}: ${f.volume(entry.volumeKg)}` : undefined}
                    className={cn(
                      "block h-7 w-full rounded-md",
                      !entry && (day > now ? "bg-surface-2" : "bg-surface-3"),
                      key === todayKey && "ring-1 ring-fg-3",
                    )}
                    style={shade ? { background: shade } : undefined}
                  />
                </div>
              );
            })}
          </div>
          <p className="tabular mt-3 text-xs text-fg-3">
            Last week: {week.lastFull.sessions} session{week.lastFull.sessions === 1 ? "" : "s"}, {f.volume(week.lastFull.volumeKg)}
          </p>
        </div>
      </section>

      {/* Trend and body parts answer one question, "how has training gone lately", so they share a card. */}
      <Card className="mb-8 grid grid-cols-1 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2 lg:border-r lg:border-line">
          <CardHeader title="Last 12 weeks" action={<Segmented size="sm" value={metric} options={METRICS} onChange={setMetric} />} />
          <CardBody>
            <BarChart
              data={trend}
              format={formatTrend}
              valueLabel={METRICS.find((m) => m.value === metric)!.label}
              average={trendAverage}
              height={220}
            />
            <TooltipFormatHint format={formatTrendTooltip} value={trend.at(-1)?.value ?? 0} label="This week so far" />
          </CardBody>
        </div>

        <div className="min-w-0 border-t border-line lg:border-t-0">
          <CardHeader title="Sets by body part" subtitle="Last 30 days, secondary muscles count half" />
          <CardBody>
            {bodyParts.length > 0 ? (
              <HBarList
                items={bodyParts.map((entry, rank) => ({
                  key: entry.part,
                  label: BODY_PART_LABELS[entry.part],
                  value: entry.sets,
                  color: rankColor(rank),
                }))}
                format={(value) => `${Math.round(value * 10) / 10}`}
              />
            ) : (
              <p className="py-6 text-center text-sm text-fg-3">No sets in the last 30 days.</p>
            )}
          </CardBody>
        </div>
      </Card>

      <section className="mb-8">
        <SectionHeading title="Training year" action={<SectionLink href="/calendar">Calendar</SectionLink>} />
        <ContributionGraph index={dayIndex} firstDayOfWeek={firstDayOfWeek} f={f} />
      </section>

      <div className="grid grid-cols-1 gap-x-8 gap-y-8 lg:grid-cols-3">
        <section className="min-w-0 lg:col-span-2">
          <SectionHeading title="Recent sessions" action={<SectionLink href="/history">View all</SectionLink>} />
          <Card className="overflow-hidden">
            {model.sessions.slice(0, 6).map((session) => (
              <SessionRow key={session.id} session={session} f={f} />
            ))}
          </Card>
        </section>

        <div className="min-w-0 space-y-8">
          <section>
            <SectionHeading title="Bodyweight" action={<SectionLink href="/measurements/bodyweight">Details</SectionLink>} />
            {bodyweight.latest ? (
              <>
                <div className="flex items-baseline gap-1">
                  <span className="tabular text-[26px] leading-tight font-semibold tracking-[-0.02em]">{f.weightValue(bodyweight.latest.value)}</span>
                  <span className="text-sm text-fg-3">{f.weightUnit}</span>
                </div>
                <p className="tabular mt-0.5 text-xs text-fg-3">
                  {relativeDay(bodyweight.latest.measuredAt)}
                  {bodyweight.delta !== null ? (
                    <>
                      , {bodyweight.delta > 0 ? "+" : bodyweight.delta < 0 ? "−" : ""}
                      {f.weight(Math.abs(bodyweight.delta))} in 4 weeks
                    </>
                  ) : null}
                </p>
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
          </section>

          <section>
            <SectionHeading title="Recent records" action={<SectionLink href="/records">All records</SectionLink>} />
            {recentRecords.length > 0 ? (
              <ul className="-mx-2">
                {recentRecords.map((record) => {
                  const exercise = model.exercises.get(record.exerciseId);
                  return (
                    <li key={record.id}>
                      <Link
                        href={`/exercises/${encodeURIComponent(record.exerciseId)}`}
                        className="flex items-baseline gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-surface-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-fg">{exercise?.name ?? "Unknown exercise"}</div>
                          <div className="text-xs text-fg-3">
                            {PR_KIND_LABELS[record.kind]}, {formatDateShort(record.achievedAt)}
                          </div>
                        </div>
                        <span className="tabular shrink-0 text-sm font-medium text-fg">{f.record(record.kind, record.value)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-fg-3">No records yet.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

/**
 * The change against the same days last week. A few percent either way is
 * ordinary week-to-week noise, so it stays grey; only real swings get colour.
 */
function weekDelta(now: number, before: number): { text: string; tone: "up" | "down" | "neutral" } {
  if (before <= 0) return { text: now > 0 ? "None by now last week" : "Nothing yet", tone: "neutral" };
  const change = changeLabel(now, before)!;
  if (change.tone === "neutral") return { text: "No change", tone: "neutral" };
  const small = Math.abs((now - before) / before) < 0.05;
  return { text: `${change.text} vs last week`, tone: small ? "neutral" : change.tone };
}

function SectionHeading({
  title,
  meta,
  metaClassName,
  action,
}: {
  title: string;
  meta?: string;
  metaClassName?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
        {meta ? <span className={cn("tabular truncate text-[13px] text-fg-3", metaClassName)}>{meta}</span> : null}
      </div>
      {action}
    </div>
  );
}

function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="shrink-0 text-[13px] text-fg-3 transition-colors duration-150 hover:text-fg">
      {children}
    </Link>
  );
}

/** The chart's axis is compact; the exact figure for the week in progress sits under it. */
function TooltipFormatHint({ format, value, label }: { format: (value: number) => string; value: number; label: string }) {
  return (
    <p className="tabular mt-2 text-xs text-fg-3">
      {label}: <span className="text-fg-2">{format(value)}</span>. Dashed line: 11-week average.
    </p>
  );
}
