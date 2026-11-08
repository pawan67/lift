/**
 * Chart wrappers over Recharts, styled once for the palette.
 *
 * Screens pass plain `{ label, value }`-shaped data and a formatter; axis,
 * grid, tooltip and colours are decided here so every chart in the app reads
 * as one system.
 */

"use client";

import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart as RLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const CHART_COLORS = {
  volt: "#d2f34b",
  voltDim: "rgba(210, 243, 75, 0.35)",
  grid: "#1e1e24",
  axis: "#84848f",
  record: "#f5c445",
  signal: "#63cc5a",
  warn: "#e8913c",
  alarm: "#ec5a62",
  info: "#6aa8f7",
  violet: "#a78bfa",
  muted: "#3a3a46",
};

/** A categorical ramp for series that need telling apart. */
export const SERIES_COLORS = ["#d2f34b", "#6aa8f7", "#f5c445", "#a78bfa", "#63cc5a", "#e8913c", "#ec5a62", "#5eead4"];

const AXIS_TICK = { fill: CHART_COLORS.axis, fontSize: 11, fontFamily: "var(--font-sans)", style: { fontVariantNumeric: "tabular-nums" } };

function TooltipBox({ title, rows }: { title: ReactNode; rows: { label: ReactNode; value: ReactNode; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.8)]">
      <div className="mb-1 text-[11px] text-fg-3">{title}</div>
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          {row.color ? <span className="h-2 w-2 rounded-full" style={{ background: row.color }} /> : null}
          <span className="text-fg-2">{row.label}</span>
          <span className="tabular ml-auto pl-3 font-medium text-fg">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export interface SeriesPoint {
  /** Axis label. */
  label: string;
  /** Tooltip title; defaults to the label. */
  title?: string;
  value: number;
  /** Optional emphasis, e.g. the current week. */
  highlight?: boolean;
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

export function BarChart({
  data,
  format,
  height = 220,
  color = CHART_COLORS.volt,
  valueLabel = "Value",
  yTicks = true,
  average,
}: {
  data: SeriesPoint[];
  format: (value: number) => string;
  height?: number;
  color?: string;
  valueLabel?: string;
  yTicks?: boolean;
  /** Draws a dashed line at this value. */
  average?: number;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: yTicks ? 0 : -24 }}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis
            tick={yTicks ? AXIS_TICK : false}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(value: number) => format(value)}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]!.payload as SeriesPoint;
              return <TooltipBox title={point.title ?? point.label} rows={[{ label: valueLabel, value: format(point.value), color }]} />;
            }}
          />
          {average !== undefined && average > 0 ? (
            <ReferenceLine y={average} stroke={CHART_COLORS.axis} strokeDasharray="4 4" />
          ) : null}
          <Bar dataKey="value" radius={[4, 4, 1, 1]} maxBarSize={36} isAnimationActive={false}>
            {data.map((point, index) => (
              <Cell key={index} fill={point.highlight === false ? CHART_COLORS.voltDim : color} />
            ))}
          </Bar>
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line / area over time
// ---------------------------------------------------------------------------

export interface TimePoint {
  /** Epoch ms. */
  t: number;
  value: number;
  /** Optional second series, e.g. a smoothed trend. */
  trend?: number | null;
}

export function TimeChart({
  data,
  format,
  height = 240,
  color = CHART_COLORS.volt,
  valueLabel = "Value",
  trendLabel = "Trend",
  area = true,
  domain,
  dateFormat,
}: {
  data: TimePoint[];
  format: (value: number) => string;
  height?: number;
  color?: string;
  valueLabel?: string;
  trendLabel?: string;
  area?: boolean;
  /** Y domain; defaults to a padded fit around the data. */
  domain?: [number | "auto", number | "auto"];
  dateFormat?: (t: number) => string;
}) {
  const span = data.length > 1 ? data[data.length - 1]!.t - data[0]!.t : 0;
  const long = span > 120 * 86_400_000;
  const tickDate =
    dateFormat ??
    ((t: number) =>
      new Date(t).toLocaleDateString(undefined, long ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" }));
  // Over a long window, ticks sit on month boundaries: left to itself the axis
  // spaces them evenly in time and prints the same month twice.
  const xTicks = long && data.length > 1 ? monthTicks(data[0]!.t, data[data.length - 1]!.t) : undefined;
  const hasTrend = data.some((point) => point.trend !== undefined && point.trend !== null);
  const values = data.flatMap((point) => (point.trend !== undefined && point.trend !== null ? [point.value, point.trend] : [point.value]));
  const nice = niceScale(Math.min(...values), Math.max(...values));

  const common = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
  };

  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
      <XAxis
        dataKey="t"
        type="number"
        scale="time"
        domain={["dataMin", "dataMax"]}
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={false}
        tickFormatter={tickDate}
        ticks={xTicks}
        minTickGap={28}
      />
      <YAxis
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={false}
        width={48}
        domain={domain ?? nice.domain}
        ticks={domain ? undefined : nice.ticks}
        tickFormatter={(value: number) => format(value)}
      />
      <Tooltip
        cursor={{ stroke: CHART_COLORS.muted }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const point = payload[0]!.payload as TimePoint;
          const rows = [{ label: valueLabel, value: format(point.value), color }];
          if (hasTrend && point.trend !== undefined && point.trend !== null) {
            rows.push({ label: trendLabel, value: format(point.trend), color: CHART_COLORS.axis });
          }
          return (
            <TooltipBox
              title={new Date(point.t).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
              rows={rows}
            />
          );
        }}
      />
    </>
  );

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {area ? (
          <AreaChart {...common}>
            <defs>
              <linearGradient id={`fill-${color.replace(/[^a-z0-9]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {axes}
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`url(#fill-${color.replace(/[^a-z0-9]/gi, "")})`}
              dot={data.length <= 40 ? { r: 2.5, fill: color, strokeWidth: 0 } : false}
              activeDot={{ r: 4, strokeWidth: 0, fill: color }}
              isAnimationActive={false}
            />
            {hasTrend ? (
              <Line type="monotone" dataKey="trend" stroke={CHART_COLORS.axis} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            ) : null}
          </AreaChart>
        ) : (
          <RLineChart {...common}>
            {axes}
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={data.length <= 40 ? { r: 2.5, fill: color, strokeWidth: 0 } : false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive={false}
            />
            {hasTrend ? (
              <Line type="monotone" dataKey="trend" stroke={CHART_COLORS.axis} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            ) : null}
          </RLineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** First-of-month timestamps inside [from, to], thinned to at most seven. */
export function monthTicks(from: number, to: number): number[] {
  const ticks: number[] = [];
  const cursor = new Date(from);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  if (cursor.getTime() < from) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor.getTime() <= to) {
    ticks.push(cursor.getTime());
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const every = Math.max(1, Math.ceil(ticks.length / 7));
  return ticks.filter((_, index) => index % every === 0);
}

/**
 * A y-domain on round numbers around the data, with about five ticks.
 *
 * Fitting the domain to the data exactly gives ticks like 82.4 and 84.1, which
 * read as noise. Stepping by 1, 2 or 5 times a power of ten does not.
 */
export function niceScale(min: number, max: number): { domain: [number, number]; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { domain: [0, 1], ticks: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw) ?? raw;
  const low = Math.max(min >= 0 ? 0 : -Infinity, Math.floor(min / step) * step);
  const high = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = low; value <= high + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
  return { domain: [low, high], ticks };
}

// ---------------------------------------------------------------------------
// Horizontal bars (rankings, distributions)
// ---------------------------------------------------------------------------

export function HBarList({
  items,
  format,
  color = CHART_COLORS.volt,
  max,
}: {
  items: { key: string; label: ReactNode; value: number; color?: string; detail?: ReactNode }[];
  format: (value: number) => string;
  color?: string;
  /** Scale; defaults to the largest value. */
  max?: number;
}) {
  const top = max ?? Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-fg-2">{item.label}</span>
            <span className="tabular shrink-0 font-medium text-fg">
              {format(item.value)}
              {item.detail ? <span className="ml-1.5 text-xs font-normal text-fg-3">{item.detail}</span> : null}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            {/* Scaled, not sized, so a change of range glides on the compositor. */}
            <div
              className="bar-fill h-full rounded-full"
              style={{ transform: `scaleX(${Math.max(0.015, item.value / top)})`, background: item.color ?? color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
