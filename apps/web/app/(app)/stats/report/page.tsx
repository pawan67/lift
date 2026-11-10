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
import { Download } from "lucide-react";
import { useMemo, useState } from "react";

import { BarChart, HBarList } from "@/components/charts/charts";
import { quietTone, type Tone } from "@/components/stats/delta";
import { Section, TH } from "@/components/stats/section";
import { StatsNav } from "@/components/stats/stats-nav";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Stat } from "@/components/ui/stat";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
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

function delta(now: number, before: number): { text: string; tone: Tone } | undefined {
  if (before <= 0) return undefined;
  const change = percentChange(now, before);
  if (change === 0) return { text: "No change", tone: "neutral" };
  return { text: `${change > 0 ? "+" : "−"}${Math.abs(change)}%`, tone: quietTone(now, before, change > 0 ? "up" : "down") };
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

      <Card className="mb-10">
        <div className="border-b border-line px-5 py-6">
          <div className="text-sm font-medium text-fg">{reportTitle(report.days)}</div>
          <div className="tabular mt-0.5 text-[13px] text-fg-3">
            {formatPeriod(report.from, report.to)}, changes against the {report.days} days before
          </div>
          <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="tabular text-4xl font-semibold tracking-[-0.03em] text-fg sm:text-5xl">{formatTonnage(totals.volumeKg, f.weightUnit)}</span>
            <span className="text-sm text-fg-3">moved</span>
          </div>
          <p className="mt-1.5 text-sm text-fg-2">
            {totals.sessions === 0
              ? "No sessions in this period."
              : `${totals.sessions} ${totals.sessions === 1 ? "session" : "sessions"} over ${totals.trainingDays} ${
                  totals.trainingDays === 1 ? "day" : "days"
                } of ${report.days}.`}
          </p>
        </div>
        <CardBody className="grid grid-cols-2 gap-x-6 gap-y-5 pt-5 sm:grid-cols-5">
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
            <Section className="mb-10" title="Notes">
              <ul className="space-y-1.5 pt-2">
                {report.highlights.map((line) => (
                  <li key={line} className="flex gap-3 text-sm text-fg-2">
                    <span className="mt-[0.6em] h-px w-2 shrink-0 bg-fg-3" />
                    {line}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Card className="mb-10">
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

          <div className="mb-10 grid items-start gap-x-12 gap-y-10 lg:grid-cols-5">
            <Section className="lg:col-span-3" title="Top lifts" meta="by volume">
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className={cn(TH, "pr-3")}>Lift</th>
                      <th className={cn(TH, "px-3 text-right")}>Sets</th>
                      <th className={cn(TH, "px-3 text-right")}>Best set</th>
                      <th className={cn(TH, "px-3 text-right")}>Est. 1RM</th>
                      <th className={cn(TH, "pl-3 text-right")}>Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.lifts.map((lift) => (
                      <tr key={lift.name} className="border-t border-line">
                        <td className="max-w-56 truncate py-2 pr-3 text-fg">{lift.name}</td>
                        <td className="tabular px-3 py-2 text-right text-fg-2">{lift.sets}</td>
                        <td className="tabular px-3 py-2 text-right text-fg-2">
                          {lift.bestSet
                            ? lift.bestSet.weightKg > 0
                              ? `${f.weightValue(lift.bestSet.weightKg)} × ${lift.bestSet.reps}`
                              : `${lift.bestSet.reps} reps`
                            : "–"}
                        </td>
                        <td className="tabular px-3 py-2 text-right font-medium text-fg">
                          {lift.bestOneRepMaxKg > 0 ? f.weight(lift.bestOneRepMaxKg) : <span className="font-normal text-fg-3">–</span>}
                        </td>
                        <td className="tabular py-2 pl-3 text-right text-fg-2">{f.volume(lift.volumeKg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section className="lg:col-span-2" title="Muscles" meta="working sets, by primary muscle">
              <div className="pt-3">
                <HBarList
                  max={maxMuscle}
                  items={report.muscles.map((muscle) => ({
                    key: muscle.muscle,
                    label: MUSCLE_GROUP_LABELS[muscle.muscle as MuscleGroup] ?? muscle.muscle,
                    value: muscle.sets,
                  }))}
                  format={(value) => integer(value)}
                />
              </div>
            </Section>
          </div>

          <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-2 [&>*]:min-w-0">
            <Section title="New records" meta="best est. 1RM beaten">
              {report.records.length === 0 ? (
                <p className="py-3 text-sm text-fg-3">No new 1RM records this time.</p>
              ) : (
                <ul>
                  {report.records.map((record) => (
                    <li key={record.name} className="flex items-center justify-between gap-3 border-t border-line py-2 text-sm first:border-t-0">
                      <span className="truncate text-fg">{record.name}</span>
                      <span className="tabular shrink-0">
                        {record.previousKg ? <span className="mr-2 text-xs text-fg-3">from {f.weight(record.previousKg)}</span> : null}
                        <span className="font-medium text-record">{f.weight(record.oneRepMaxKg)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Biggest session">
              {report.biggestSession ? (
                <div className="flex items-end justify-between gap-4 pt-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-fg">{report.biggestSession.name}</div>
                    <div className="mt-0.5 text-[13px] text-fg-3">{formatDate(report.biggestSession.startedAt, { weekday: "long", day: "numeric", month: "long" })}</div>
                  </div>
                  <div className="tabular shrink-0 text-2xl font-semibold tracking-[-0.02em] text-fg">{f.volume(report.biggestSession.volumeKg)}</div>
                </div>
              ) : (
                <p className="py-3 text-sm text-fg-3">No volume logged.</p>
              )}
            </Section>
          </div>
        </>
      )}
    </>
  );
}
