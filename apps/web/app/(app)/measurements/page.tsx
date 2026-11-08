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
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Segmented } from "@/components/ui/primitives";
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
      <PageHeader title="Measurements" subtitle="Bodyweight, tape measurements and what they add up to." actions={actions} />

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
        <div className="space-y-6">
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

            {/* Derived figures */}
            <Card>
              <CardHeader title="Body figures" subtitle="Worked out from your latest readings" />
              <CardBody className="space-y-4">
                {figures.length === 0 && !hint ? <p className="text-sm text-fg-3">Log bodyweight and your waist to see these.</p> : null}
                {figures.length > 0 ? (
                  <ul className="divide-y divide-line">
                    {figures.map((figure) => (
                      <li key={figure.key} className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0">
                        <div className="min-w-0">
                          <div className="text-sm text-fg-2">{figure.label}</div>
                          <div
                            className={cn(
                              "mt-0.5 text-xs",
                              figure.tone === "good" ? "text-signal" : figure.tone === "caution" ? "text-warn" : "text-fg-3",
                            )}
                          >
                            {figure.detail}
                          </div>
                        </div>
                        <div className="tabular shrink-0 text-lg font-semibold text-fg">{figure.value}</div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {hint ? (
                  <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-sm text-fg-2">
                    {hint.message}{" "}
                    {hint.action === "settings" ? (
                      <Link href="/settings#body" className="font-medium text-volt hover:underline">
                        Open settings
                      </Link>
                    ) : (
                      <button type="button" onClick={() => setLogging(hint.kind)} className="font-medium text-volt hover:underline">
                        Log {MEASUREMENT_KIND_LABELS[hint.kind].toLowerCase()}
                      </button>
                    )}
                  </div>
                ) : null}
                {symmetryNotes.length > 0 ? (
                  <div>
                    <h3 className="mb-2 font-mono text-[11px] tracking-wider text-fg-3 uppercase">Left and right</h3>
                    <ul className="space-y-1.5">
                      {symmetryNotes.map((note) => (
                        <li key={note.label} className="flex justify-between gap-3 text-sm">
                          <span className="text-fg-2">{note.label}</span>
                          <span className={cn("tabular", note.notable ? "text-warn" : "text-fg")}>{note.summary}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          </div>

          {/* Every kind */}
          <div className="grid items-start gap-6 lg:grid-cols-2">
            {MEASUREMENT_GROUPS.map((group) => (
              <Card key={group}>
                <CardHeader title={MEASUREMENT_GROUP_LABELS[group]} />
                <ul className="mt-3">
                  {MEASUREMENT_GROUP_KINDS[group].map((kind) => (
                    <KindRow key={kind} kind={kind} summary={summaries.get(kind)} />
                  ))}
                </ul>
              </Card>
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
    <li className="border-t border-line first:border-t-0">
      <Link href={`/measurements/${kind}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
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
        <ChevronRight size={16} className="shrink-0 text-fg-3" />
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
          <Link href="/measurements/bodyweight" className="font-mono text-[11px] tracking-wider text-fg-3 uppercase hover:text-fg">
            Bodyweight
          </Link>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="tabular text-4xl font-semibold tracking-tight text-fg">
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

      <div className="grid grid-cols-3 gap-3 px-5 pt-5">
        {changes.map(({ days: windowDays, label, change }) => {
          const negligible = change ? isNegligibleChange("bodyweight", change.delta, prefs) : true;
          return (
            <div key={windowDays} className="rounded-xl bg-surface-2 px-3 py-2.5">
              <div className="text-[11px] text-fg-3">{label}</div>
              <div className={cn("tabular mt-0.5 text-sm font-semibold", !change ? "text-fg-3" : negligible ? "text-fg" : change.delta > 0 ? "text-info" : "text-signal")}>
                {!change ? "No data" : negligible ? "Steady" : formatMeasurementDelta("bodyweight", change.delta, prefs)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-2 pt-4 pb-4 sm:px-3">
        <MeasurementHistoryChart kind="bodyweight" rows={rows} days={days} />
      </div>
    </>
  );
}
