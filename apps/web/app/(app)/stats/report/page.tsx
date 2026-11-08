"use client";

import { MUSCLE_GROUP_LABELS, type MuscleGroup } from "@lift/shared";
import {
  buildTrainingReport,
  formatPeriod,
  formatTonnage,
  lastDaysWindow,
  percentChange,
  reportTitle,
  type ReportTotals,
} from "@lift/shared/report";
import { Download, Sparkles, Trophy } from "lucide-react";
import { useMemo, useState } from "react";

import { BarChart, HBarList } from "@/components/charts/charts";
import { StatsNav } from "@/components/stats/stats-nav";
import { toast } from "@/components/ui/dialog";
import { Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Segmented, Stat } from "@/components/ui/primitives";
import { useModel } from "@/lib/data/model";
import { useData } from "@/lib/data/store";
import { compactNumber, formatDate, integer, useFormat } from "@/lib/format";
import { downloadReportPdf, reportWorkouts } from "@/lib/stats/report";

const SPANS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;

type Span = (typeof SPANS)[number]["value"];

const DAY_MS = 86_400_000;

function delta(now: number, before: number): { text: string; tone: "up" | "down" | "neutral" } | undefined {
  if (before <= 0) return undefined;
  const change = percentChange(now, before);
  if (change === 0) return { text: "Level with the period before", tone: "neutral" };
  return { text: `${change > 0 ? "+" : "−"}${Math.abs(change)}% vs the period before`, tone: change > 0 ? "up" : "down" };
}

export default function ReportPage() {
  const model = useModel();
  const f = useFormat();
  const athlete = useData((s) => s.user?.name ?? null);
  const [span, setSpan] = useState<Span>("7");
  const [exporting, setExporting] = useState(false);
  // Read once per visit, so the report does not shift while it is being read.
  const [now] = useState(() => Date.now());

  const report = useMemo(() => {
    // Ends at tomorrow's midnight so today's session is in it, as on the phone.
    const { from, to } = lastDaysWindow(now + DAY_MS, Number(span));
    return buildTrainingReport({
      workouts: reportWorkouts(model, to),
      from,
      to,
      unit: f.weightUnit,
      athlete,
      generatedAt: now,
      ...(model.latestBodyweightKg !== null ? { bodyweightKg: model.latestBodyweightKg } : {}),
    });
  }, [model, span, f.weightUnit, athlete, now]);

  const { totals, previous } = report;

  async function exportPdf() {
    setExporting(true);
    try {
      await downloadReportPdf(report);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not make the PDF.", "error");
    } finally {
      setExporting(false);
    }
  }

  const stat = (label: string, value: string, key: keyof ReportTotals, unit?: string) => {
    const change = delta(totals[key], previous[key]);
    return <Stat label={label} value={value} unit={unit} hint={change?.text} tone={change?.tone} />;
  };

  const perDay = report.days <= 14;
  const maxMuscle = Math.max(1, ...report.muscles.map((muscle) => muscle.sets));

  return (
    <>
      <PageHeader
        title="Training report"
        subtitle="The same report the phone exports and the Telegram bot sends"
        actions={
          <>
            <Segmented size="sm" value={span} options={SPANS} onChange={setSpan} />
            <Button variant="primary" size="sm" onClick={() => void exportPdf()} disabled={exporting || totals.sessions === 0}>
              <Download size={14} /> {exporting ? "Making the PDF…" : "Export PDF"}
            </Button>
          </>
        }
      />
      <StatsNav />

      <Card className="mb-6 overflow-hidden">
        <div className="border-b border-line bg-gradient-to-br from-volt/10 via-transparent to-transparent px-5 py-6 sm:px-7">
          <div className="font-mono text-[11px] tracking-widest text-volt uppercase">{reportTitle(report.days)}</div>
          <div className="mt-1 text-sm text-fg-2">{formatPeriod(report.from, report.to)}</div>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="tabular text-4xl font-semibold tracking-tight text-fg sm:text-5xl">{formatTonnage(totals.volumeKg, f.weightUnit)}</span>
            <span className="text-sm text-fg-3">moved</span>
          </div>
          <p className="mt-2 text-sm text-fg-2">
            {totals.sessions === 0
              ? "No sessions in this period."
              : `${totals.sessions} ${totals.sessions === 1 ? "session" : "sessions"} over ${totals.trainingDays} ${
                  totals.trainingDays === 1 ? "day" : "days"
                } of ${report.days}.`}
          </p>
        </div>
        <CardBody className="grid grid-cols-2 gap-6 pt-5 sm:grid-cols-5">
          {stat("Sessions", integer(totals.sessions), "sessions")}
          {stat("Volume", f.volumeValue(totals.volumeKg), "volumeKg", f.weightUnit)}
          {stat("Sets", integer(totals.sets), "sets")}
          {stat("Reps", integer(totals.reps), "reps")}
          {stat("Time", f.durationShort(totals.minutes * 60), "minutes")}
        </CardBody>
      </Card>

      {totals.sessions === 0 ? (
        <Card>
          <EmptyState title="Nothing to report yet" body="Pick a longer period, or train and come back." />
        </Card>
      ) : (
        <>
          {report.highlights.length > 0 ? (
            <Card className="mb-6">
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Sparkles size={16} className="text-volt" /> Notes
                  </span>
                }
                subtitle="Worked out from the numbers, no AI involved"
              />
              <CardBody className="pt-3">
                <ul className="space-y-2">
                  {report.highlights.map((line) => (
                    <li key={line} className="flex gap-3 text-sm text-fg-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-volt" />
                      {line}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <Card className="mb-6">
            <CardHeader title={`Volume ${perDay ? "per day" : "per week"}`} subtitle={f.weightUnit} />
            <CardBody>
              <BarChart
                data={report.buckets.map((bucket) => ({
                  label: bucket.label,
                  title: `${bucket.label}, ${bucket.sessions} ${bucket.sessions === 1 ? "session" : "sessions"}`,
                  value: f.toWeight(bucket.volumeKg),
                }))}
                format={(value) => compactNumber(value)}
                valueLabel="Volume"
                height={220}
              />
            </CardBody>
          </Card>

          <div className="mb-6 grid items-start gap-6 lg:grid-cols-5">
            <Card className="min-w-0 lg:col-span-3">
              <CardHeader title="Top lifts" subtitle="By volume in the period" />
              <div className="overflow-x-auto pt-3 pb-2">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[11px] tracking-wider text-fg-3 uppercase">
                      <th className="py-2 pr-3 pl-5 font-normal">Lift</th>
                      <th className="px-3 py-2 text-right font-normal">Sets</th>
                      <th className="px-3 py-2 text-right font-normal">Best set</th>
                      <th className="px-3 py-2 text-right font-normal">Est. 1RM</th>
                      <th className="py-2 pr-5 pl-3 text-right font-normal">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.lifts.map((lift) => (
                      <tr key={lift.name} className="border-t border-line">
                        <td className="max-w-56 truncate py-2.5 pr-3 pl-5 text-fg">{lift.name}</td>
                        <td className="tabular px-3 py-2.5 text-right text-fg-2">{lift.sets}</td>
                        <td className="tabular px-3 py-2.5 text-right text-fg-2">
                          {lift.bestSet
                            ? lift.bestSet.weightKg > 0
                              ? `${f.weightValue(lift.bestSet.weightKg)} × ${lift.bestSet.reps}`
                              : `${lift.bestSet.reps} reps`
                            : "–"}
                        </td>
                        <td className="tabular px-3 py-2.5 text-right font-medium text-fg">
                          {lift.bestOneRepMaxKg > 0 ? f.weight(lift.bestOneRepMaxKg) : "–"}
                        </td>
                        <td className="tabular py-2.5 pr-5 pl-3 text-right text-fg-2">{f.volume(lift.volumeKg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="min-w-0 lg:col-span-2">
              <CardHeader title="Muscles" subtitle="Working sets, by primary muscle" />
              <CardBody>
                <HBarList
                  max={maxMuscle}
                  items={report.muscles.map((muscle) => ({
                    key: muscle.muscle,
                    label: MUSCLE_GROUP_LABELS[muscle.muscle as MuscleGroup] ?? muscle.muscle,
                    value: muscle.sets,
                  }))}
                  format={(value) => `${integer(value)} sets`}
                />
              </CardBody>
            </Card>
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Trophy size={16} className="text-record" /> New records
                  </span>
                }
                subtitle="Best estimated 1RM beaten in this period"
              />
              {report.records.length === 0 ? (
                <EmptyState title="No new 1RM records this time" className="py-8" />
              ) : (
                <ul className="px-5 pt-3 pb-4">
                  {report.records.map((record) => (
                    <li key={record.name} className="flex items-center justify-between gap-3 border-t border-line py-2.5 text-sm first:border-t-0">
                      <span className="truncate text-fg">{record.name}</span>
                      <span className="tabular shrink-0">
                        <span className="font-medium text-record">{f.weight(record.oneRepMaxKg)}</span>
                        {record.previousKg ? <span className="ml-2 text-xs text-fg-3">from {f.weight(record.previousKg)}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="Biggest session" />
              {report.biggestSession ? (
                <CardBody className="pt-3">
                  <div className="text-base font-medium text-fg">{report.biggestSession.name}</div>
                  <div className="mt-0.5 text-sm text-fg-3">{formatDate(report.biggestSession.startedAt, { weekday: "long", day: "numeric", month: "long" })}</div>
                  <div className="tabular mt-3 text-2xl font-semibold text-fg">{f.volume(report.biggestSession.volumeKg)}</div>
                </CardBody>
              ) : (
                <EmptyState title="No volume logged" className="py-8" />
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
