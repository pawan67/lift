"use client";

import { EQUIPMENT_LABELS, MUSCLE_GROUP_LABELS } from "@lift/shared";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ExerciseThumb } from "@/components/exercises/exercise-thumb";
import { quietChange, toneClass } from "@/components/stats/delta";
import { ProgressChart, seriesColor } from "@/components/stats/progress-chart";
import { RangePicker } from "@/components/stats/range-picker";
import { Section, TH } from "@/components/stats/section";
import { StatsNav } from "@/components/stats/stats-nav";
import { Button, Card, CardBody, CardHeader, Chip, EmptyState, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useModel } from "@/lib/data/model";
import { formatDateShort, integer, useFormat } from "@/lib/format";
import {
  LEADERBOARD_MIN_SESSIONS,
  leaderboard,
  oneRepMaxSeries,
  summarizeExercises,
  type ExerciseSummary,
} from "@/lib/stats/aggregate";
import { statWindow, type StatRange } from "@/lib/stats/windows";

const TABLE_PREVIEW = 12;
const MAX_SERIES = 5;

export default function LiftsPage() {
  const model = useModel();
  const f = useFormat();
  const [range, setRange] = useState<StatRange>("3m");
  const [showAll, setShowAll] = useState(false);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [showPending, setShowPending] = useState(false);

  const window = useMemo(() => statWindow(range), [range]);
  const span = useMemo(() => ({ from: window.from?.getTime() ?? null, to: window.to.getTime() }), [window]);

  const lifts = useMemo(() => summarizeExercises(model, span), [model, span]);
  const previousBest = useMemo(() => {
    if (!window.previous) return null;
    const before = summarizeExercises(model, { from: window.previous.from.getTime(), to: window.previous.to.getTime() });
    return new Map(before.map((entry) => [entry.exercise.id, entry.bestOneRepMaxKg]));
  }, [model, window]);

  // Lifts measured by load, the only ones an e1RM line means anything for.
  const loaded = useMemo(() => lifts.filter((lift) => lift.bestOneRepMaxKg > 0), [lifts]);
  const selected = chosen ?? loaded.slice(0, 3).map((lift) => lift.exercise.id);

  const series = useMemo(
    () =>
      selected
        .map((id) => ({
          id,
          name: model.exercises.get(id)?.name ?? "Exercise",
          points: oneRepMaxSeries(model, id, span).map((point) => ({ t: point.t, value: f.toWeight(point.value) })),
        }))
        .filter((entry) => entry.points.length > 0),
    [selected, model, span, f],
  );

  const board = useMemo(() => leaderboard(model), [model]);

  const toggle = (id: string) => {
    const current = selected;
    if (current.includes(id)) setChosen(current.filter((entry) => entry !== id));
    else setChosen([...current, id].slice(-MAX_SERIES));
  };

  const visible = showAll ? lifts : lifts.slice(0, TABLE_PREVIEW);

  return (
    <>
      <PageHeader title="Lifts" subtitle={window.label} actions={<RangePicker value={range} onChange={setRange} />} />
      <StatsNav />

      {lifts.length === 0 ? (
        <Card className="mb-6">
          <EmptyState title="No lifts in this range" body="Pick a longer range, or log a session on your phone." />
        </Card>
      ) : (
        <>
          <Card className="mb-10">
            <CardHeader
              title="Estimated 1RM"
              subtitle={`Best set per session, ${f.weightUnit}. Up to ${MAX_SERIES} lifts.`}
            />
            <CardBody>
              <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
                {loaded.slice(0, 16).map((lift) => {
                  const index = selected.indexOf(lift.exercise.id);
                  return (
                    <Chip key={lift.exercise.id} selected={index >= 0} onClick={() => toggle(lift.exercise.id)}>
                      {index >= 0 ? <span className="h-2 w-2 rounded-full" style={{ background: seriesColor(index) }} /> : null}
                      {lift.exercise.name}
                    </Chip>
                  );
                })}
              </div>
              {series.length === 0 ? (
                <EmptyState title="Pick a lift to chart" className="py-10" />
              ) : (
                <ProgressChart series={series} format={(value) => integer(value)} />
              )}
            </CardBody>
          </Card>

          <Section className="mb-12" title="Main exercises" meta="most trained first">
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full text-sm sm:min-w-[720px]">
                <thead>
                  <tr className="text-left">
                    <th className={cn(TH, "pr-3")}>Exercise</th>
                    <th className={cn(TH, "px-2 text-right sm:px-3")}><span className="sm:hidden">Sess.</span><span className="hidden sm:inline">Sessions</span></th>
                    <th className={cn(TH, "hidden px-3 text-right sm:table-cell")}>Sets</th>
                    <th className={cn(TH, "px-2 text-right whitespace-nowrap sm:px-3")}><span className="sm:hidden">1RM</span><span className="hidden sm:inline">Est. 1RM</span></th>
                    <th className={cn(TH, "hidden px-3 text-right sm:table-cell")}>Heaviest</th>
                    <th className={cn(TH, "hidden px-3 text-right sm:table-cell")}>Volume</th>
                    <th className={cn(TH, "pl-2 text-right whitespace-nowrap sm:pl-3")} title="Best est. 1RM against the previous period">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((lift) => (
                    <LiftRow key={lift.exercise.id} lift={lift} previous={previousBest?.get(lift.exercise.id) ?? null} hasPrevious={previousBest !== null} />
                  ))}
                </tbody>
              </table>
            </div>
            {lifts.length > TABLE_PREVIEW ? (
              <div className="border-t border-line pt-2">
                <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setShowAll((value) => !value)}>
                  {showAll ? "Show fewer" : `Show all ${lifts.length}`}
                </Button>
              </div>
            ) : null}
          </Section>
        </>
      )}

      <Section
        title="Leaderboard"
        meta={
          model.latestBodyweightKg
            ? `free weights, all time, multiples of ${f.weight(model.latestBodyweightKg)}`
            : "free weights, all time"
        }
      >
        {board.qualified.length === 0 ? (
          <EmptyState
            title="Nothing qualifies yet"
            body={`A lift joins the board after ${LEADERBOARD_MIN_SESSIONS} sessions with a barbell, dumbbell, kettlebell, Smith machine or weighted bodyweight.`}
          />
        ) : (
          <>
            <div className={cn(TH, "flex gap-3")}>
              <span className="flex-1 pl-20">Lift</span>
              <span className="hidden w-16 text-right sm:inline">{model.latestBodyweightKg ? "× BW" : null}</span>
              <span className="w-20 text-right">Est. 1RM</span>
            </div>
            <ol>
              {board.qualified.map((entry, index) => (
                <li key={entry.exercise.id}>
                  <Link
                    href={`/exercises/${entry.exercise.id}`}
                    className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-surface-2"
                  >
                    <span className={cn("tabular w-6 shrink-0 text-right text-sm", index < 3 ? "font-medium text-fg" : "text-fg-3")}>
                      {index + 1}
                    </span>
                    <ExerciseThumb exercise={entry.exercise} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-fg">{entry.exercise.name}</div>
                      <div className="tabular truncate text-xs text-fg-3">
                        {f.weight(entry.bestSetWeightKg)} × {entry.bestSetReps} on {formatDateShort(entry.achievedAt)}, {entry.sessions} sessions
                      </div>
                    </div>
                    <span className="tabular hidden w-16 text-right text-sm text-fg-2 sm:inline">
                      {entry.bodyweightMultiple !== null ? `${entry.bodyweightMultiple.toFixed(2)}×` : ""}
                    </span>
                    <span className={cn("tabular w-20 text-right text-sm font-semibold", index === 0 ? "text-volt" : "text-fg")}>
                      {f.weight(entry.bestOneRepMaxKg)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </>
        )}
        {board.pending.length > 0 ? (
          <div className="mt-1 border-t border-line pt-2">
            <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setShowPending((value) => !value)} aria-expanded={showPending}>
              {showPending ? "Hide" : "Show"} {board.pending.length} not yet on the board
            </Button>
            {showPending ? (
              <ul className="mt-1 grid gap-x-10 transition-[opacity,transform] duration-200 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:transform-none sm:grid-cols-2">
                {board.pending.map((entry) => (
                  <li key={entry.exercise.id} className="flex items-center justify-between gap-3 border-t border-line py-2 text-sm">
                    <Link href={`/exercises/${entry.exercise.id}`} className="truncate text-fg-2 transition-colors duration-150 hover:text-fg">
                      {entry.exercise.name}
                    </Link>
                    <span className="tabular shrink-0 text-xs text-fg-3">
                      {entry.sessions} of {LEADERBOARD_MIN_SESSIONS} sessions
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Section>
    </>
  );
}

function LiftRow({ lift, previous, hasPrevious }: { lift: ExerciseSummary; previous: number | null; hasPrevious: boolean }) {
  const f = useFormat();
  const delta = previous !== null && lift.bestOneRepMaxKg > 0 ? quietChange(lift.bestOneRepMaxKg, previous) : null;

  return (
    <tr className="border-t border-line transition-colors duration-150 hover:bg-surface-2/60">
      <td className="w-full max-w-0 py-2 pr-2 sm:w-auto sm:max-w-none sm:pr-3">
        <Link href={`/exercises/${lift.exercise.id}`} className="flex items-center gap-3">
          <ExerciseThumb exercise={lift.exercise} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-fg">{lift.exercise.name}</span>
            <span className="block truncate text-xs text-fg-3">
              {MUSCLE_GROUP_LABELS[lift.exercise.primaryMuscle]}, {EQUIPMENT_LABELS[lift.exercise.equipment].toLowerCase()}
            </span>
          </span>
        </Link>
      </td>
      <td className="tabular px-2 py-2 text-right whitespace-nowrap text-fg sm:px-3">{lift.times}</td>
      <td className="tabular hidden px-3 py-2 text-right text-fg-2 sm:table-cell">{lift.sets}</td>
      <td className="tabular px-2 py-2 text-right font-medium whitespace-nowrap text-fg sm:px-3">{lift.bestOneRepMaxKg > 0 ? f.weight(lift.bestOneRepMaxKg) : <span className="font-normal text-fg-3">–</span>}</td>
      <td className="tabular hidden px-3 py-2 text-right text-fg-2 sm:table-cell">{lift.heaviestKg > 0 ? f.weight(lift.heaviestKg) : <span className="text-fg-3">–</span>}</td>
      <td className="tabular hidden px-3 py-2 text-right text-fg-2 sm:table-cell">{lift.volumeKg > 0 ? f.volume(lift.volumeKg) : <span className="text-fg-3">–</span>}</td>
      <td className={cn("tabular py-2 pl-3 text-right text-xs whitespace-nowrap", toneClass(delta?.tone))}>
        {delta ? delta.text : hasPrevious && previous === null && lift.bestOneRepMaxKg > 0 ? "New" : ""}
      </td>
    </tr>
  );
}
