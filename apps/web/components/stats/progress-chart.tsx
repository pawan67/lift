/** Several lifts' estimated 1RM on one time axis, one colour each. */

"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_COLORS, SERIES_COLORS, monthTicks, niceScale } from "@/components/charts/charts";

const AXIS_TICK = { fill: CHART_COLORS.axis, fontSize: 11, fontFamily: "var(--font-sans)", style: { fontVariantNumeric: "tabular-nums" } };

export interface ProgressSeries {
  id: string;
  name: string;
  points: { t: number; value: number }[];
}

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]!;
}

export function ProgressChart({
  series,
  format,
  height = 300,
}: {
  series: ProgressSeries[];
  format: (value: number) => string;
  height?: number;
}) {
  // One row per timestamp, a column per lift; a lift absent that day is null and the line bridges it.
  const byTime = new Map<number, Record<string, number | null>>();
  series.forEach((entry) => {
    for (const point of entry.points) {
      const row = byTime.get(point.t) ?? { t: point.t };
      row[entry.id] = point.value;
      byTime.set(point.t, row);
    }
  });
  const data = [...byTime.values()].sort((a, b) => (a.t as number) - (b.t as number));
  const values = series.flatMap((entry) => entry.points.map((point) => point.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const nice = niceScale(min, max);
  const span = data.length > 1 ? (data.at(-1)!.t as number) - (data[0]!.t as number) : 0;
  const long = span > 120 * 86_400_000;
  const xTicks = long ? monthTicks(data[0]!.t as number, data.at(-1)!.t as number) : undefined;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            ticks={xTicks}
            tickFormatter={(t: number) =>
              new Date(t).toLocaleDateString(undefined, long ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" })
            }
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={nice.domain}
            ticks={nice.ticks}
            tickFormatter={(value: number) => format(value)}
          />
          <Tooltip
            cursor={{ stroke: CHART_COLORS.muted }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 shadow-toast">
                  <div className="mb-1 text-[11px] text-fg-3">
                    {new Date(Number(label)).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                  </div>
                  {payload
                    .filter((item) => item.value !== null && item.value !== undefined)
                    .map((item) => (
                      <div key={String(item.dataKey)} className="flex items-center gap-2 text-sm">
                        <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                        <span className="max-w-48 truncate text-fg-2">{item.name}</span>
                        <span className="tabular ml-auto pl-3 font-medium text-fg">{format(Number(item.value))}</span>
                      </div>
                    ))}
                </div>
              );
            }}
          />
          {series.map((entry, index) => (
            <Line
              key={entry.id}
              type="monotone"
              dataKey={entry.id}
              name={entry.name}
              stroke={seriesColor(index)}
              strokeWidth={2}
              dot={entry.points.length <= 30 ? { r: 2.5, strokeWidth: 0, fill: seriesColor(index) } : false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
