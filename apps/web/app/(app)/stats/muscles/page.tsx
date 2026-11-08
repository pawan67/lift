"use client";

import {
  BODY_PART_LABELS,
  findVolumeGaps,
  landmarksFor,
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUPS,
  TRAINING_LEVEL_LABELS,
  VOLUME_ZONE_LABELS,
  VOLUME_ZONES,
  volumeZone,
  type BodyPart,
  type MuscleGroup,
  type VolumeLandmarks,
} from "@lift/shared";
import Link from "next/link";
import { useMemo, useState } from "react";

import { BodyPartRadar, WeeklySetsChart, type WeekPoint } from "@/components/stats/muscle-charts";
import { quietChange, toneClass } from "@/components/stats/delta";
import { RangePicker } from "@/components/stats/range-picker";
import { Section, TH } from "@/components/stats/section";
import { StatsNav } from "@/components/stats/stats-nav";
import { ZONE_COLORS, ZONE_DESCRIPTIONS } from "@/components/stats/zones";
import { Card, CardBody, CardHeader, Chip, EmptyState, PageHeader, Segmented } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useModel } from "@/lib/data/model";
import { compactNumber, integer, useFormat } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import {
  setsPerWeek,
  spanWeeks,
  tallyBodyParts,
  tallyMuscles,
  weeklyMuscleSets,
  type MuscleTally,
} from "@/lib/stats/aggregate";
import { formatWeekRange, statWindow, type StatRange } from "@/lib/stats/windows";

const AXES: BodyPart[] = ["chest", "back", "shoulders", "arms", "core", "legs"];

/** Muscles the landmarks measure. Cardio, full body and "other" have no ceiling. */
const MEASURED: MuscleGroup[] = MUSCLE_GROUPS.filter((muscle) => landmarksFor(muscle).mrv > 0);

const TREND_WEEKS = 12;

function round1(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

export default function MusclesPage() {
  const model = useModel();
  const f = useFormat();
  const level = useSettings((s) => s.trainingLevel);
  const firstDayOfWeek = useSettings((s) => s.firstDayOfWeek);
  const [range, setRange] = useState<StatRange>("30d");
  const [axisMetric, setAxisMetric] = useState<"sets" | "volume">("sets");
  const [picked, setPicked] = useState<MuscleGroup | null>(null);

  const window = useMemo(() => statWindow(range), [range]);
  const span = useMemo(() => ({ from: window.from?.getTime() ?? null, to: window.to.getTime() }), [window]);
  const previousSpan = useMemo(
    () => (window.previous ? { from: window.previous.from.getTime(), to: window.previous.to.getTime() } : null),
    [window],
  );

  const muscles = useMemo(() => tallyMuscles(model, span), [model, span]);
  const previousMuscles = useMemo(() => (previousSpan ? tallyMuscles(model, previousSpan) : null), [model, previousSpan]);
  const weeks = spanWeeks(span, model.firstSessionAt);
  const perWeek = useMemo(() => setsPerWeek(muscles, weeks), [muscles, weeks]);
  const gaps = useMemo(() => findVolumeGaps(perWeek, { level }), [perWeek, level]);

  const rows = useMemo(
    () =>
      MEASURED.map((muscle) => {
        const landmarks = landmarksFor(muscle, level);
        const value = perWeek[muscle] ?? 0;
        return { muscle, landmarks, value, zone: volumeZone(value, landmarks) };
      }).sort((a, b) => b.value - a.value || MUSCLE_GROUP_LABELS[a.muscle].localeCompare(MUSCLE_GROUP_LABELS[b.muscle])),
    [perWeek, level],
  );

  const zoneCounts = useMemo(() => {
    const counts = new Map(VOLUME_ZONES.map((zone) => [zone, 0]));
    for (const row of rows) counts.set(row.zone, (counts.get(row.zone) ?? 0) + 1);
    return counts;
  }, [rows]);

  const radar = useMemo(() => {
    const now = tallyBodyParts(muscles);
    const before = previousMuscles ? tallyBodyParts(previousMuscles) : null;
    const read = (entry: { directSets: number; volumeKg: number } | undefined) =>
      axisMetric === "sets" ? (entry?.directSets ?? 0) : f.toWeight(entry?.volumeKg ?? 0);
    return AXES.map((part) => ({
      part,
      axis: BODY_PART_LABELS[part],
      current: read(now.get(part)),
      previous: before ? read(before.get(part)) : null,
    }));
  }, [muscles, previousMuscles, axisMetric, f]);

  const radarTotal = radar.reduce((sum, point) => sum + point.current, 0);

  const trendMuscle = picked ?? rows[0]?.muscle ?? "chest";
  const trendLandmarks = landmarksFor(trendMuscle, level);
  const trend: WeekPoint[] = useMemo(
    () =>
      weeklyMuscleSets(model, [trendMuscle], TREND_WEEKS, firstDayOfWeek).map((bucket) => {
        const value = bucket.values[0]!;
        return {
          label: new Date(bucket.start).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
          title: formatWeekRange(new Date(bucket.start)),
          value,
          color: ZONE_COLORS[volumeZone(value, trendLandmarks)],
        };
      }),
    [model, trendMuscle, firstDayOfWeek, trendLandmarks],
  );

  const detail = useMemo(
    () => [...muscles].filter((tally) => tally.sets > 0).sort((a, b) => b.directSets - a.directSets || b.sets - a.sets),
    [muscles],
  );

  const formatAxis = (value: number) => (axisMetric === "sets" ? `${integer(value)} sets` : `${compactNumber(value)} ${f.weightUnit}`);

  return (
    <>
      <PageHeader
        title="Muscles"
        subtitle={`${window.label}, judged against ${TRAINING_LEVEL_LABELS[level].toLowerCase()} landmarks`}
        actions={<RangePicker value={range} onChange={setRange} />}
      />
      <StatsNav />

      {muscles.length === 0 ? (
        <Card>
          <EmptyState title="No working sets in this range" body="Pick a longer range to see where your sets went." />
        </Card>
      ) : (
        <>
          <VolumeAdvice gaps={gaps} />

          <Card className="mb-6">
            <CardHeader
              title="Weekly sets per muscle"
              subtitle={`Average over ${round1(weeks)} ${weeks === 1 ? "week" : "weeks"}. A secondary muscle counts half a set.`}
            />
            <CardBody>
              <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2">
                {VOLUME_ZONES.map((zone) => (
                  <div key={zone} className="flex items-center gap-1.5 text-xs text-fg-3" title={ZONE_DESCRIPTIONS[zone]}>
                    <span className="h-2 w-2 rounded-full" style={{ background: ZONE_COLORS[zone] }} />
                    {VOLUME_ZONE_LABELS[zone]}
                    <span className="tabular text-fg-2">{zoneCounts.get(zone) ?? 0}</span>
                  </div>
                ))}
              </div>
              <ul className="grid gap-x-12 gap-y-1 lg:grid-cols-2">
                {rows.map((row) => (
                  <LandmarkRow
                    key={row.muscle}
                    muscle={row.muscle}
                    value={row.value}
                    landmarks={row.landmarks}
                    selected={row.muscle === trendMuscle}
                    onSelect={() => setPicked(row.muscle)}
                  />
                ))}
              </ul>
              <p className="mt-4 text-xs leading-relaxed text-fg-3">
                MEV is the minimum that grows a muscle, MAV the top of the most productive band, MRV the most that most
                people recover from. Change the training level in <Link href="/settings" className="text-fg-2 underline decoration-line-strong underline-offset-2 transition-colors duration-150 hover:text-fg">Settings</Link>.
              </p>
            </CardBody>
          </Card>

          <div className="mb-6 grid items-start gap-6 lg:grid-cols-5">
            <Card className="min-w-0 lg:col-span-3">
              <CardHeader
                title={`${MUSCLE_GROUP_LABELS[trendMuscle]}, week by week`}
                subtitle={`Weighted sets, last ${TREND_WEEKS} weeks. MEV ${trendLandmarks.mev}, MAV ${trendLandmarks.mav}, MRV ${trendLandmarks.mrv}.`}
              />
              <CardBody>
                <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
                  {rows.slice(0, 10).map((row) => (
                    <Chip key={row.muscle} selected={row.muscle === trendMuscle} onClick={() => setPicked(row.muscle)}>
                      {MUSCLE_GROUP_LABELS[row.muscle]}
                    </Chip>
                  ))}
                </div>
                <WeeklySetsChart data={trend} landmarks={trendLandmarks} />
              </CardBody>
            </Card>

            <Card className="min-w-0 lg:col-span-2">
              <CardHeader
                title="Body-part balance"
                subtitle={previousSpan ? "This period against the one before" : "All time"}
                action={
                  <Segmented
                    size="sm"
                    value={axisMetric}
                    onChange={setAxisMetric}
                    options={[
                      { value: "sets", label: "Sets" },
                      { value: "volume", label: "Volume" },
                    ]}
                  />
                }
              />
              <CardBody className="pt-2">
                <BodyPartRadar
                  data={radar}
                  format={formatAxis}
                  currentLabel={previousSpan ? "This period" : "All time"}
                  previousLabel={previousSpan ? "Previous" : null}
                />
                <ul className="mt-2 divide-y divide-line border-t border-line text-sm">
                  {radar.map((point) => {
                    const delta = point.previous !== null ? quietChange(point.current, point.previous) : null;
                    return (
                      <li key={point.part} className="flex items-center justify-between gap-3 py-2">
                        <span className="text-fg-2">{point.axis}</span>
                        <span className="flex items-baseline gap-3">
                          <span className="tabular text-xs text-fg-3">
                            {radarTotal > 0 ? `${Math.round((point.current / radarTotal) * 100)}%` : "0%"}
                          </span>
                          <span className="tabular font-medium text-fg">{formatAxis(point.current)}</span>
                          {delta ? (
                            <span className={cn("tabular w-16 text-right text-xs whitespace-nowrap", toneClass(delta.tone))}>
                              {delta.text}
                            </span>
                          ) : previousSpan ? (
                            <span className="w-16 text-right text-xs text-fg-3">New</span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          </div>

          <Section title="Every muscle trained" meta={`${detail.length} muscles`}>
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left">
                    <th className={cn(TH, "pr-3")}>Muscle</th>
                    <th className={cn(TH, "px-3 text-right")}>Direct sets</th>
                    <th className={cn(TH, "px-3 text-right")}>Weighted</th>
                    <th className={cn(TH, "px-3 text-right")}>Reps</th>
                    <th className={cn(TH, "px-3 text-right")}>Volume</th>
                    <th className={cn(TH, "pl-3 text-right")}>Exercises</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.map((tally: MuscleTally) => (
                    <tr key={tally.muscle} className="border-t border-line">
                      <td className="py-2 pr-3 text-fg">
                        {MUSCLE_GROUP_LABELS[tally.muscle]}
                        <span className="ml-2 text-xs text-fg-3">{BODY_PART_LABELS[tally.bodyPart]}</span>
                      </td>
                      <td className="tabular px-3 py-2 text-right font-medium text-fg">{integer(tally.directSets)}</td>
                      <td className="tabular px-3 py-2 text-right text-fg-2">{round1(tally.sets)}</td>
                      <td className="tabular px-3 py-2 text-right text-fg-2">{integer(tally.reps)}</td>
                      <td className="tabular px-3 py-2 text-right text-fg-2">{tally.volumeKg > 0 ? f.volume(tally.volumeKg) : <span className="text-fg-3">–</span>}</td>
                      <td className="tabular py-2 pl-3 text-right text-fg-2">{tally.exercises}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

        </>
      )}
    </>
  );
}

function VolumeAdvice({ gaps }: { gaps: ReturnType<typeof findVolumeGaps> }) {
  const short = gaps.filter((gap) => gap.shortfall > 0);
  const over = gaps.filter((gap) => gap.excess > 0);

  if (gaps.length === 0) {
    return (
      <p className="mb-6 flex items-center gap-2 text-sm text-fg-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
        Every muscle is between its minimum and what it can recover from.
      </p>
    );
  }

  const summary = [
    short.length ? `${short.length} ${short.length === 1 ? "muscle" : "muscles"} under the minimum` : null,
    over.length ? `${over.length} past the recoverable maximum` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mb-6 rounded-(--radius-card) border border-line px-5 py-4">
      <p className="flex items-center gap-2 text-sm font-medium text-fg">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
        {summary.charAt(0).toUpperCase() + summary.slice(1)}
      </p>
      <ul className="mt-2 grid gap-x-10 sm:grid-cols-2 xl:grid-cols-3">
        {gaps.slice(0, 9).map((gap) => (
          <li key={gap.muscle} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0 truncate text-fg-2">{MUSCLE_GROUP_LABELS[gap.muscle]}</span>
            <span className="tabular shrink-0 text-xs text-fg-3">
              {round1(gap.setsPerWeek)} sets/week, {gap.shortfall > 0 ? `MEV ${gap.landmarks.mev}` : `MRV ${gap.landmarks.mrv}`}
              <span className={cn("ml-2 font-medium", gap.shortfall > 0 ? "text-warn" : "text-alarm")}>
                {gap.shortfall > 0 ? `+${gap.shortfall}` : `−${gap.excess}`} sets
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LandmarkRow({
  muscle,
  value,
  landmarks,
  selected,
  onSelect,
}: {
  muscle: MuscleGroup;
  value: number;
  landmarks: VolumeLandmarks;
  selected: boolean;
  onSelect: () => void;
}) {
  const zone = volumeZone(value, landmarks);
  const scale = Math.max(landmarks.mrv * 1.25, value * 1.05, 1);
  const fraction = (sets: number) => Math.min(1, sets / scale);
  const at = (sets: number) => `${fraction(sets) * 100}%`;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="group -mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-surface-2/70"
        aria-pressed={selected}
      >
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span
            className={cn(
              "truncate text-sm transition-colors duration-150",
              selected ? "font-medium text-volt" : zone === "untrained" ? "text-fg-3 group-hover:text-fg-2" : "text-fg-2 group-hover:text-fg",
            )}
          >
            {MUSCLE_GROUP_LABELS[muscle]}
          </span>
          <span className="flex items-baseline gap-2.5">
            <span className="text-xs text-fg-3">{VOLUME_ZONE_LABELS[zone]}</span>
            <span className={cn("tabular w-8 text-right text-sm font-medium", zone === "untrained" ? "text-fg-3" : "text-fg")}>{round1(value)}</span>
          </span>
        </div>
        <div className="relative h-1.5">
          <div className="absolute inset-0 overflow-hidden rounded-full bg-surface-3">
            {/* The productive band, MEV to MRV, drawn faintly behind the fill. */}
            <div
              className="absolute inset-y-0 bg-volt/8"
              style={{ left: at(landmarks.mev), width: `calc(${at(landmarks.mrv)} - ${at(landmarks.mev)})` }}
            />
            {/* Scaled, not sized, so a change of range glides on the compositor. */}
            <div
              className="bar-fill absolute inset-0 rounded-full"
              style={{ transform: `scaleX(${fraction(value)})`, background: ZONE_COLORS[zone] }}
            />
          </div>
          {[landmarks.mev, landmarks.mav, landmarks.mrv].map((mark, index) => (
            <div
              key={index}
              className="absolute -top-0.5 h-2.5 w-px bg-fg-3/60"
              style={{ left: at(mark) }}
              title={["MEV", "MAV", "MRV"][index]}
            />
          ))}
        </div>
      </button>
    </li>
  );
}
