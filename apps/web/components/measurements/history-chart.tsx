/**
 * One kind's readings over a window, with the smoothed trend beside them.
 *
 * The trend is smoothed over the whole history and then cut to the window, so
 * its first point in the window already carries what came before rather than
 * restarting from whatever single reading happens to open the range.
 */

"use client";

import { smoothMeasurements, toDisplayMeasurementValue, trimZeros, type MeasurementKind, measurementUnitLabel } from "@lift/shared";
import { useMemo } from "react";

import { TimeChart } from "@/components/charts/charts";
import { EmptyState } from "@/components/ui/empty-state";
import type { BodyMeasurementRow } from "@/lib/data/types";
import { useFormat } from "@/lib/format";
import { useNow } from "@/lib/measurements/use-now";
import { toPoints } from "@/lib/measurements/insights";

export function MeasurementHistoryChart({
  kind,
  rows,
  days,
  height = 260,
}: {
  kind: MeasurementKind;
  /** Oldest first. */
  rows: readonly BodyMeasurementRow[];
  /** Window in days; null for all of it. */
  days: number | null;
  height?: number;
}) {
  const prefs = useFormat().measurementPrefs;
  const now = useNow();

  const data = useMemo(() => {
    const points = toPoints(rows);
    const smoothed = smoothMeasurements(points);
    const cutoff = days === null ? -Infinity : now - days * 86_400_000;
    return points
      .map((point, index) => ({
        t: point.at,
        value: toDisplayMeasurementValue(kind, point.value, prefs),
        trend: toDisplayMeasurementValue(kind, smoothed[index]!.value, prefs),
      }))
      .filter((point) => point.t >= cutoff);
  }, [rows, days, kind, prefs, now]);

  if (data.length === 0) {
    return <EmptyState title="Nothing in this range" body="Pick a longer range to see older readings." className="py-10" />;
  }

  const unit = measurementUnitLabel(kind, prefs);
  const span = data[data.length - 1]!.t - data[0]!.t;
  return (
    <TimeChart
      data={data}
      height={height}
      format={(value) => trimZeros(value.toFixed(1))}
      valueLabel={`Reading (${unit})`}
      trendLabel={`Trend (${unit})`}
      // Nice round ticks around the data rather than a padded fit.
      domain={["auto", "auto"]}
      // Day and month until the window spans years: a month-only label repeats when two ticks share a month.
      dateFormat={(t) =>
        new Date(t).toLocaleDateString(undefined, span > 730 * 86_400_000 ? { month: "short", year: "numeric" } : { day: "numeric", month: "short" })
      }
    />
  );
}
