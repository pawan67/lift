"use client";

import {
  MEASUREMENT_GROUPS,
  MEASUREMENT_GROUP_KINDS,
  MEASUREMENT_GROUP_LABELS,
  MEASUREMENT_KIND_LABELS,
  changeOverWindow,
  changePerDay,
  formatMeasurementDelta,
  formatMeasurementValue,
  isNegligibleChange,
  type MeasurementKind,
} from "@lift/shared";
import { ChevronRight, Plus, Ruler, Scale } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { MeasurementHistoryChart } from "@/components/measurements/history-chart";
import { LogMeasurementsDialog } from "@/components/measurements/log-dialog";
import { Sparkline } from "@/components/measurements/sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { useModel } from "@/lib/data/model";
import { useFormat } from "@/lib/format";
import { useNow } from "@/lib/measurements/use-now";
import {
  STALE_AFTER_DAYS,
  buildBodyFigures,
  buildSymmetryNotes,
  describeRate,
  describeRecency,
  missingInputHint,
  summarizeKinds,
  toPoints,
  type KindSummary,
} from "@/lib/measurements/insights";
import { MEASUREMENT_RANGES, rangeDays, type MeasurementRange } from "@/lib/measurements/ranges";
import { useSettings } from "@/lib/settings";

const CHANGE_WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

export default function MeasurementsPage() {
  const model = useModel();
  const format = useFormat();
  const prefs = format.measurementPrefs;
  const heightCm = useSettings((s) => s.heightCm);
  const sex = useSettings((s) => s.sex);

  const [logging, setLogging] = useState<"all" | MeasurementKind | null>(null);
  const [range, setRange] = useState<MeasurementRange>("90d");
  const now = useNow();

  const summaries = useMemo(() => summarizeKinds(model.measurements, now), [model, now]);
  const figures = useMemo(() => buildBodyFigures({ summaries, prefs, heightCm, sex }), [summaries, prefs, heightCm, sex]);
  const hint = useMemo(() => missingInputHint({ summaries, prefs, heightCm, sex }), [summaries, prefs, heightCm, sex]);
  const symmetryNotes = useMemo(() => buildSymmetryNotes(summaries, prefs), [summaries, prefs]);

  const bodyweightRows = model.measurements.get("bodyweight") ?? [];
  const bodyweight = summaries.get("bodyweight");

  const actions = (
    <>
      <Button onClick={() => setLogging("bodyweight")}>
        <Scale size={16} /> Log bodyweight
      </Button>
      <Button variant="primary" onClick={() => setLogging("all")}>
        <Plus size={16} /> Log measurements
      </Button>
    </>
  );

  return (
    <>
      <PageHeader title="Measurements" actions={actions} />

      {summaries.size === 0 ? (
        <Card>
          <EmptyState
            icon={<Ruler size={28} />}
            title="No measurements yet"
            body="Log your bodyweight or a set of tape measurements. They sync to the app on your phone."
            action={actions}
          />
        </Card>
      ) : (
        <div className="space-y-10">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Bodyweight */}
            <Card className="lg:col-span-2">
              {bodyweight ? (
                <BodyweightHero summary={bodyweight} rows={bodyweightRows} range={range} onRange={setRange} />
              ) : (
                <EmptyState
                  icon={<Scale size={26} />}
                  title="No bodyweight logged"
                  body="Weigh in to see your trend and the figures that depend on it."
                  action={
                    <Button variant="primary" onClick={() => setLogging("bodyweight")}>
                      Log bodyweight
                    </Button>
                  }
                />
              )}
            </Card>

            {/* Derived figures: on the page, not in a second card, so the bodyweight chart is the one box up here. */}
            <section className="lg:pt-5">
              <h2 className="text-sm font-semibold tracking-tight text-fg">Body figures</h2>
              {figures.length === 0 && !hint ? <p className="mt-3 text-sm text-fg-3">Log bodyweight and your waist to see these.</p> : null}
              {figures.length > 0 ? (
                <ul className="mt-2 divide-y divide-line">
                  {figures.map((figure) => (
                    <li key={figure.key} className="flex items-baseline justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm text-fg-2">{figure.label}</div>
                        <div className={cn("mt-0.5 text-xs", figure.tone === "caution" ? "text-warn" : "text-fg-3")}>{figure.detail}</div>
                      </div>
                      <div className="tabular shrink-0 text-base font-semibold tracking-[-0.01em] text-fg">{figure.value}</div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {hint ? (
                <p className="mt-2 border-t border-line pt-3 text-[13px] text-fg-3">
                  {hint.message}{" "}
                  {hint.action === "settings" ? (
                    <Link href="/settings#body" className="font-medium whitespace-nowrap text-fg-2 underline decoration-line-strong underline-offset-2 transition-colors duration-150 hover:text-fg hover:decoration-fg-3">
                      {hint.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setLogging(hint.kind)}
                      className="font-medium whitespace-nowrap text-fg-2 underline decoration-line-strong underline-offset-2 transition-colors duration-150 hover:text-fg hover:decoration-fg-3"
                    >
                      Log {MEASUREMENT_KIND_LABELS[hint.kind].toLowerCase()}
                    </button>
                  )}
                </p>
              ) : null}
              {symmetryNotes.length > 0 ? (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold tracking-tight text-fg">Left and right</h3>
                  <ul className="mt-2 divide-y divide-line">
                    {symmetryNotes.map((note) => (
                      <li key={note.label} className="flex justify-between gap-3 py-2 text-sm">
                        <span className="text-fg-2">{note.label}</span>
                        <span className={cn("tabular", note.notable ? "text-warn" : "text-fg")}>{note.summary}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          </div>

          {/* Every kind */}
          <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-2">
            {MEASUREMENT_GROUPS.map((group) => (
              <section key={group}>
                <h2 className="mb-1 text-sm font-semibold tracking-tight text-fg">{MEASUREMENT_GROUP_LABELS[group]}</h2>
                <ul className="border-t border-line">
                  {MEASUREMENT_GROUP_KINDS[group].map((kind) => (
                    <KindRow key={kind} kind={kind} summary={summaries.get(kind)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}

      <LogMeasurementsDialog
        open={logging !== null}
        onClose={() => setLogging(null)}
        kinds={logging === null || logging === "all" ? undefined : [logging]}
        title={logging && logging !== "all" ? `Log ${MEASUREMENT_KIND_LABELS[logging].toLowerCase()}` : undefined}
      />
    </>
  );
}

function KindRow({ kind, summary }: { kind: MeasurementKind; summary: KindSummary | undefined }) {
  const format = useFormat();
  const prefs = format.measurementPrefs;
  const stale = summary ? summary.daysAgo > STALE_AFTER_DAYS : false;
  const change = summary?.sinceMonth ?? null;
  return (
    <li className="border-b border-line">
      <Link href={`/measurements/${kind}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-surface-2/70 active:bg-surface-2">
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-sm", summary ? "text-fg" : "text-fg-3")}>{MEASUREMENT_KIND_LABELS[kind]}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-3">
            {summary ? describeRecency(summary.daysAgo) : "Not logged"}
            {stale ? <Badge tone="warn">Stale</Badge> : null}
          </div>
        </div>
        {summary ? <Sparkline values={summary.spark} className="hidden shrink-0 sm:block" /> : null}
        <div className="w-28 shrink-0 text-right">
          {summary ? (
            <>
              <div className="tabular text-sm font-semibold text-fg">{format.measurement(kind, summary.latest.value)}</div>
              <div className="tabular text-xs text-fg-3">
                {change === null ? "\u00a0" : isNegligibleChange(kind, change, prefs) ? "Steady, 30 days" : `${formatMeasurementDelta(kind, change, prefs)}, 30 days`}
              </div>
            </>
          ) : null}
        </div>
        <ChevronRight size={15} className="shrink-0 text-fg-3/70" />
      </Link>
    </li>
  );
}

function BodyweightHero({
  summary,
  rows,
  range,
  onRange,
}: {
  summary: KindSummary;
  rows: Parameters<typeof MeasurementHistoryChart>[0]["rows"];
  range: MeasurementRange;
  onRange: (range: MeasurementRange) => void;
}) {
  const format = useFormat();
  const prefs = format.measurementPrefs;
  const points = useMemo(() => toPoints(rows), [rows]);
  const clock = useNow();
  const now = Math.max(summary.latest.measuredAt, clock);

  const changes = CHANGE_WINDOWS.map((window) => ({
    ...window,
    change: changeOverWindow(points, window.days, now),
  }));

  // The rate is fitted over the visible window: "per week lately", not since the first weigh-in.
  const days = rangeDays(range);
  const windowPoints = days === null ? points : points.filter((point) => point.at >= now - days * 86_400_000);
  const windowStats = useMemo(() => {
    if (windowPoints.length < 2) return null;
    const first = windowPoints[0]!;
    const last = windowPoints[windowPoints.length - 1]!;
    return { count: windowPoints.length, span: last.at - first.at };
  }, [windowPoints]);
  const rate = useMemo(() => {
    const perDay = changePerDay(windowPoints);
    return perDay === null ? null : perDay * 7;
  }, [windowPoints]);
  const rateText = windowStats ? describeRate("bodyweight", rate, windowStats.count, windowStats.span, prefs) : null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
        <div>
          <Link href="/measurements/bodyweight" className="text-sm font-semibold tracking-tight text-fg transition-colors duration-150 hover:text-volt">
            Bodyweight
          </Link>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="tabular text-4xl font-semibold tracking-[-0.02em] text-fg">
              {formatMeasurementValue("bodyweight", summary.latest.value, prefs, { withUnit: false })}
            </span>
            <span className="text-base text-fg-3">{format.weightUnit}</span>
          </div>
          <div className="mt-1 text-xs text-fg-3">
            {describeRecency(summary.daysAgo)} · trend {formatMeasurementValue("bodyweight", summary.stats.trend, prefs)}
            {rateText ? ` · ${rateText}` : ""}
          </div>
        </div>
        <Segmented size="sm" value={range} onChange={onRange} options={MEASUREMENT_RANGES} />
      </div>

      {/* Plain figures in a row: whether up or down is good depends on the goal, so neither gets a colour. */}
      <dl className="flex gap-8 px-5 pt-4">
        {changes.map(({ days: windowDays, label, change }) => {
          const negligible = change ? isNegligibleChange("bodyweight", change.delta, prefs) : true;
          return (
            <div key={windowDays}>
              <dt className="text-xs text-fg-3">{label}</dt>
              <dd className={cn("tabular mt-0.5 text-sm font-medium", !change || negligible ? "text-fg-3" : "text-fg")}>
                {!change ? "No data" : negligible ? "Steady" : formatMeasurementDelta("bodyweight", change.delta, prefs)}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="px-2 pt-4 pb-4 sm:px-3">
        <MeasurementHistoryChart kind="bodyweight" rows={rows} days={days} />
      </div>
    </>
  );
}
