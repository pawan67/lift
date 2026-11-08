/**
 * The two charts only the muscles screen draws: a body-part radar comparing two
 * periods, and a weekly-sets trend with the muscle's landmarks drawn across it.
 */

"use client";

import type { VolumeLandmarks } from "@lift/shared";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CHART_COLORS } from "@/components/charts/charts";

const AXIS_TICK = { fill: CHART_COLORS.axis, fontSize: 11, fontFamily: "var(--font-sans)", style: { fontVariantNumeric: "tabular-nums" } };

function Box({ title, rows }: { title: string; rows: { label: string; value: string; color: string }[] }) {
  return (
    <div className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.8)]">
      <div className="mb-1 text-[11px] text-fg-3">{title}</div>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
          <span className="text-fg-2">{row.label}</span>
          <span className="tabular ml-auto pl-3 font-medium text-fg">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export interface RadarPoint {
  axis: string;
  current: number;
  previous: number | null;
}

export function BodyPartRadar({
  data,
  format,
  currentLabel,
  previousLabel,
}: {
  data: RadarPoint[];
  format: (value: number) => string;
  currentLabel: string;
  previousLabel: string | null;
}) {
  const hasPrevious = previousLabel !== null && data.some((point) => point.previous !== null);
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke={CHART_COLORS.grid} />
          <PolarAngleAxis dataKey="axis" tick={{ fill: "#a1a1ac", fontSize: 12 }} />
          {hasPrevious ? (
            <Radar
              name={previousLabel!}
              dataKey="previous"
              stroke={CHART_COLORS.axis}
              fill={CHART_COLORS.axis}
              fillOpacity={0.12}
              strokeDasharray="4 3"
              isAnimationActive={false}
            />
          ) : null}
          <Radar
            name={currentLabel}
            dataKey="current"
            stroke={CHART_COLORS.volt}
            fill={CHART_COLORS.volt}
            fillOpacity={0.25}
            strokeWidth={2}
            isAnimationActive={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]!.payload as RadarPoint;
              const rows = [{ label: currentLabel, value: format(point.current), color: CHART_COLORS.volt }];
              if (hasPrevious && point.previous !== null) {
                rows.push({ label: previousLabel!, value: format(point.previous), color: CHART_COLORS.axis });
              }
              return <Box title={point.axis} rows={rows} />;
            }}
          />
          {hasPrevious ? (
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: "#a1a1ac" }}
            />
          ) : null}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface WeekPoint {
  label: string;
  title: string;
  value: number;
  color: string;
}

export function WeeklySetsChart({ data, landmarks }: { data: WeekPoint[]; landmarks: VolumeLandmarks | null }) {
  const top = Math.max(...data.map((point) => point.value), landmarks && landmarks.mrv > 0 ? landmarks.mrv + 2 : 0, 4);
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 44, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} domain={[0, Math.ceil(top)]} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]!.payload as WeekPoint;
              return <Box title={point.title} rows={[{ label: "Sets", value: point.value.toFixed(1).replace(/\.0$/, ""), color: point.color }]} />;
            }}
          />
          {landmarks && landmarks.mrv > 0 ? (
            <>
              <ReferenceLine y={landmarks.mev} stroke="#84848f" strokeDasharray="4 4" label={{ value: "MEV", position: "right", fill: "#84848f", fontSize: 10 }} />
              <ReferenceLine y={landmarks.mav} stroke="#d2f34b" strokeOpacity={0.6} strokeDasharray="4 4" label={{ value: "MAV", position: "right", fill: "#b6d634", fontSize: 10 }} />
              <ReferenceLine y={landmarks.mrv} stroke="#e8913c" strokeDasharray="4 4" label={{ value: "MRV", position: "right", fill: "#e8913c", fontSize: 10 }} />
            </>
          ) : null}
          <Bar dataKey="value" radius={[4, 4, 1, 1]} maxBarSize={32} isAnimationActive={false}>
            {data.map((point, index) => (
              <Cell key={index} fill={point.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
