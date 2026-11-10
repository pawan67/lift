"use client";

import {
  MEASUREMENT_KINDS,
  MEASUREMENT_KIND_LABELS,
  MEASUREMENT_KIND_META,
  formatMeasurementDelta,
  formatMeasurementValue,
  isNegligibleChange,
  summarizeMeasurements,
  type MeasurementKind,
} from "@lift/shared";
import { Pencil, Plus, Ruler } from "lucide-react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { EditEntryDialog } from "@/components/measurements/entry-dialog";
import { MeasurementHistoryChart } from "@/components/measurements/history-chart";
import { LogMeasurementsDialog } from "@/components/measurements/log-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Stat } from "@/components/ui/stat";
import { useModel } from "@/lib/data/model";
import type { BodyMeasurementRow } from "@/lib/data/types";
import { formatDate, formatDateTime, useFormat } from "@/lib/format";
import { describeRate, describeRecency, toPoints } from "@/lib/measurements/insights";
import { MEASUREMENT_RANGES, rangeDays, type MeasurementRange } from "@/lib/measurements/ranges";
import { useNow } from "@/lib/measurements/use-now";

const PAGE_SIZE = 50;

function isKind(value: string): value is MeasurementKind {
  return (MEASUREMENT_KINDS as readonly string[]).includes(value);
}

export default function MeasurementKindPage() {
  const params = useParams<{ kind: string }>();
  const kind = params.kind;
  if (!isKind(kind)) notFound();
  return <KindView kind={kind} />;
}

function KindView({ kind }: { kind: MeasurementKind }) {
  const model = useModel();
  const format = useFormat();
  const prefs = format.measurementPrefs;
  const now = useNow();

  const [range, setRange] = useState<MeasurementRange>("1y");
  const [logging, setLogging] = useState(false);
  const [editing, setEditing] = useState<BodyMeasurementRow | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);

  const rows = useMemo(() => model.measurements.get(kind) ?? [], [model, kind]);
  const days = rangeDays(range);

  const stats = useMemo(() => {
    const points = toPoints(rows).filter((point) => days === null || point.at >= now - days * 86_400_000);
    return summarizeMeasurements(points);
  }, [rows, days, now]);

  const allStats = useMemo(() => summarizeMeasurements(toPoints(rows)), [rows]);
  const newestFirst = useMemo(() => [...rows].reverse(), [rows]);
  const label = MEASUREMENT_KIND_LABELS[kind];
  const counterpart = MEASUREMENT_KIND_META[kind].counterpart;

  const rate = stats ? describeRate(kind, stats.changePerWeek, stats.count, stats.latest.at - stats.first.at, prefs) : null;
  const change = stats && stats.count > 1 ? stats.change : null;

  return (
    <>
      <PageHeader
        back={{ href: "/measurements", label: "Measurements" }}
        title={label}
        subtitle={
          allStats
            ? `${allStats.count} reading${allStats.count === 1 ? "" : "s"} since ${formatDate(allStats.first.at)}`
            : "No readings yet"
        }
        actions={
          <>
            {counterpart ? (
              <Link href={`/measurements/${counterpart}`} className="group mr-2 inline-flex items-center gap-1 text-sm text-fg-3 transition-colors duration-150 hover:text-fg">
                {MEASUREMENT_KIND_LABELS[counterpart]}
                <span aria-hidden className="transition-transform duration-150 ease-out group-hover:translate-x-0.5">→</span>
              </Link>
            ) : null}
            <Button variant="primary" onClick={() => setLogging(true)}>
              <Plus size={16} /> Log {label.toLowerCase()}
            </Button>
          </>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Ruler size={28} />}
            title={`No ${label.toLowerCase()} readings`}
            body="Log one to start the chart. It syncs to the app on your phone."
            action={
              <Button variant="primary" onClick={() => setLogging(true)}>
                Log {label.toLowerCase()}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-8">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
              <div className="text-sm text-fg-2">
                Latest {format.measurement(kind, allStats!.latest.value)}, {describeRecency(Math.floor((now - allStats!.latest.at) / 86_400_000)).toLowerCase()}
              </div>
              <Segmented size="sm" value={range} onChange={setRange} options={MEASUREMENT_RANGES} />
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-5 px-5 pt-5 sm:grid-cols-4">
              <Stat label="Change" value={change === null ? "–" : isNegligibleChange(kind, change, prefs) ? "Steady" : formatMeasurementDelta(kind, change, prefs)} hint={rate ?? undefined} />
              <Stat label="Average" value={stats ? format.measurement(kind, stats.mean) : "–"} hint={stats ? `${stats.count} reading${stats.count === 1 ? "" : "s"}` : undefined} />
              <Stat label="Lowest" value={stats ? format.measurement(kind, stats.lowest.value) : "–"} hint={stats ? formatDate(stats.lowest.at) : undefined} />
              <Stat label="Highest" value={stats ? format.measurement(kind, stats.highest.value) : "–"} hint={stats ? formatDate(stats.highest.at) : undefined} />
            </div>

            <div className="px-2 pt-5 pb-4 sm:px-3">
              <MeasurementHistoryChart kind={kind} rows={rows} days={days} height={300} />
            </div>
          </Card>

          {/* Entries sit on the page as a plain table; the chart above is the one card. */}
          <section>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-tight text-fg">Entries</h2>
              <span className="text-xs text-fg-3">Newest first</span>
            </div>
            <ul className="border-t border-line">
              {newestFirst.slice(0, shown).map((row, index) => {
                const previous = newestFirst[index + 1];
                const delta = previous ? row.value - previous.value : null;
                return (
                  <li key={row.id} className="border-b border-line">
                    <button
                      type="button"
                      onClick={() => setEditing(row)}
                      className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-4 rounded-md px-2 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2/70 active:bg-surface-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-fg">{formatDateTime(row.measuredAt)}</div>
                        {row.notes ? <div className="mt-0.5 truncate text-xs text-fg-3">{row.notes}</div> : null}
                      </div>
                      <div className="tabular w-20 text-right text-xs text-fg-3">
                        {delta === null || isNegligibleChange(kind, delta, prefs) ? "" : formatMeasurementDelta(kind, delta, prefs)}
                      </div>
                      <div className="tabular w-24 text-right text-sm font-semibold text-fg">
                        {formatMeasurementValue(kind, row.value, prefs)}
                      </div>
                      <Pencil size={14} className="shrink-0 text-fg-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {newestFirst.length > shown ? (
              <div className="pt-2">
                <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setShown((count) => count + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, newestFirst.length - shown)} more
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      )}

      <LogMeasurementsDialog open={logging} onClose={() => setLogging(false)} kinds={[kind]} title={`Log ${label.toLowerCase()}`} />
      <EditEntryDialog entry={editing} onClose={() => setEditing(null)} />
    </>
  );
}
