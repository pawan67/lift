"use client";

import { EQUIPMENT_LABELS, MUSCLE_GROUP_LABELS } from "@lift/shared";
import { Medal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ExerciseThumb } from "@/components/exercises/exercise-thumb";
import { ProgressChart, seriesColor } from "@/components/stats/progress-chart";
import { RangePicker } from "@/components/stats/range-picker";
import { StatsNav } from "@/components/stats/stats-nav";
import { Button, Card, CardBody, CardHeader, Chip, EmptyState, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useModel } from "@/lib/data/model";
import { changeLabel, formatDateShort, integer, useFormat } from "@/lib/format";
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
          <Card className="mb-6">
            <CardHeader
              title="Estimated 1RM"
              subtitle={`Best set per session, ${f.weightUnit}. Pick up to ${MAX_SERIES} lifts.`}
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

          <Card className="mb-6">
            <CardHeader title="Main exercises" subtitle="Most trained first. Change compares best est. 1RM with the previous period." />
            <div className="overflow-x-auto pt-3">
              <table className="w-full text-sm sm:min-w-[720px]">
                <thead>
                  <tr className="text-left font-mono text-[11px] tracking-wider text-fg-3 uppercase">
                    <th className="py-2 pr-3 pl-5 font-normal">Exercise</th>
                    <th className="px-2 py-2 text-right font-normal sm:px-3"><span className="sm:hidden">Sess.</span><span className="hidden sm:inline">Sessions</span></th>
                    <th className="hidden px-3 py-2 text-right font-normal sm:table-cell">Sets</th>
                    <th className="px-2 py-2 text-right font-normal whitespace-nowrap sm:px-3"><span className="sm:hidden">1RM</span><span className="hidden sm:inline">Est. 1RM</span></th>
                    <th className="hidden px-3 py-2 text-right font-normal sm:table-cell">Heaviest</th>
                    <th className="hidden px-3 py-2 text-right font-normal sm:table-cell">Volume</th>
                    <th className="py-2 pr-5 pl-2 text-right font-normal sm:pl-3">Change</th>
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
              <div className="border-t border-line px-5 py-3">
                <Button variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>
                  {showAll ? "Show fewer" : `Show all ${lifts.length}`}
                </Button>
              </div>
            ) : (
              <div className="h-3" />
            )}
          </Card>
        </>
      )}

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Medal size={16} className="text-record" /> Leaderboard
            </span>
          }
          subtitle={
            model.latestBodyweightKg
              ? `Free-weight lifts by best est. 1RM, all time. Multiples use your latest bodyweight, ${f.weight(model.latestBodyweightKg)}.`
              : "Free-weight lifts by best est. 1RM, all time. Log a bodyweight to see multiples."
          }
        />
        {board.qualified.length === 0 ? (
          <EmptyState
            title="Nothing qualifies yet"
            body={`A lift joins the board after ${LEADERBOARD_MIN_SESSIONS} sessions with a barbell, dumbbell, kettlebell, Smith machine or weighted bodyweight.`}
          />
        ) : (
          <ol className="pt-3 pb-2">
            {board.qualified.map((entry, index) => (
              <li key={entry.exercise.id}>
                <Link
                  href={`/exercises/${entry.exercise.id}`}
                  className="flex items-center gap-3 border-t border-line px-5 py-3 transition-colors first:border-t-0 hover:bg-surface-2"
                >
                  <span
                    className={cn(
                      "tabular w-6 shrink-0 text-center font-mono text-sm",
                      index === 0 ? "text-record" : index < 3 ? "text-fg" : "text-fg-3",
                    )}
                  >
                    {index + 1}
                  </span>
                  <ExerciseThumb exercise={entry.exercise} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-fg">{entry.exercise.name}</div>
                    <div className="truncate text-xs text-fg-3">
                      {f.weight(entry.bestSetWeightKg)} × {entry.bestSetReps} on {formatDateShort(entry.achievedAt)} · {entry.sessions} sessions
                    </div>
                  </div>
                  {entry.bodyweightMultiple !== null ? (
                    <span className="tabular hidden rounded-md bg-surface-3 px-2 py-0.5 text-xs text-fg-2 sm:inline">
                      {entry.bodyweightMultiple.toFixed(2)}× BW
                    </span>
                  ) : null}
                  <div className="w-20 text-right">
                    <div className="tabular text-sm font-semibold text-fg">{f.weight(entry.bestOneRepMaxKg)}</div>
                    <div className="text-[11px] text-fg-3">est. 1RM</div>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}
        {board.pending.length > 0 ? (
          <div className="border-t border-line px-5 py-3">
            <Button variant="ghost" size="sm" onClick={() => setShowPending((value) => !value)}>
              {showPending ? "Hide" : "Show"} {board.pending.length} not yet on the board
            </Button>
            {showPending ? (
              <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
                {board.pending.map((entry) => (
                  <li key={entry.exercise.id} className="flex items-center justify-between gap-3 border-t border-line py-2 text-sm">
                    <Link href={`/exercises/${entry.exercise.id}`} className="truncate text-fg-2 hover:text-fg">
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
      </Card>
    </>
  );
}

function LiftRow({ lift, previous, hasPrevious }: { lift: ExerciseSummary; previous: number | null; hasPrevious: boolean }) {
  const f = useFormat();
  const delta = previous !== null && lift.bestOneRepMaxKg > 0 ? changeLabel(lift.bestOneRepMaxKg, previous) : null;

  return (
    <tr className="border-t border-line transition-colors hover:bg-surface-2">
      <td className="w-full max-w-0 py-2.5 pr-2 pl-5 sm:w-auto sm:max-w-none sm:pr-3">
        <Link href={`/exercises/${lift.exercise.id}`} className="flex items-center gap-3">
          <ExerciseThumb exercise={lift.exercise} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-fg">{lift.exercise.name}</span>
            <span className="block truncate text-xs text-fg-3">
              {MUSCLE_GROUP_LABELS[lift.exercise.primaryMuscle]} · {EQUIPMENT_LABELS[lift.exercise.equipment]}
            </span>
          </span>
        </Link>
      </td>
      <td className="tabular px-2 py-2.5 text-right whitespace-nowrap text-fg sm:px-3">{lift.times}</td>
      <td className="tabular hidden px-3 py-2.5 text-right text-fg-2 sm:table-cell">{lift.sets}</td>
      <td className="tabular px-2 py-2.5 text-right font-medium whitespace-nowrap text-fg sm:px-3">{lift.bestOneRepMaxKg > 0 ? f.weight(lift.bestOneRepMaxKg) : "–"}</td>
      <td className="tabular hidden px-3 py-2.5 text-right text-fg-2 sm:table-cell">{lift.heaviestKg > 0 ? f.weight(lift.heaviestKg) : "–"}</td>
      <td className="tabular hidden px-3 py-2.5 text-right text-fg-2 sm:table-cell">{lift.volumeKg > 0 ? f.volume(lift.volumeKg) : "–"}</td>
      <td
        className={cn(
          "tabular py-2.5 pr-5 pl-3 text-right text-xs whitespace-nowrap",
          delta?.tone === "up" ? "text-signal" : delta?.tone === "down" ? "text-alarm" : "text-fg-3",
        )}
      >
        {delta ? delta.text : hasPrevious && previous === null && lift.bestOneRepMaxKg > 0 ? "New" : ""}
      </td>
    </tr>
  );
}
