"use client";

import {
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
  PR_KIND_LABELS,
  estimateOneRepMax,
  repMaxTable,
  TRACKING_FIELDS,
  USES_BODYWEIGHT,
} from "@lift/shared";
import { Archive, ArchiveRestore, Pencil, PlayCircle, Trash2, Trophy } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { TimeChart, type TimePoint } from "@/components/charts/charts";
import { ExerciseThumb } from "@/components/exercises/exercise-thumb";
import { confirm, toast } from "@/components/ui/dialog";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ListRow,
  PageHeader,
  Segmented,
  Stat,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useModel } from "@/lib/data/model";
import { TRACKING_LABELS } from "@/lib/exercises/labels";
import { deleteCustomExercise, setExerciseArchived } from "@/lib/exercises/mutations";
import {
  bestRecords,
  exerciseTotals,
  METRIC_LABELS,
  metricsFor,
  metricValue,
  sessionPoints,
  type ProgressMetric,
} from "@/lib/exercises/progress";
import { describeSet, setLabels } from "@/lib/exercises/sets";
import { formatDate, formatDateShort, relativeDay, useFormat, type Formatter } from "@/lib/format";
import { useSettings } from "@/lib/settings";

type Range = "3m" | "6m" | "1y" | "all";

const RANGES: { value: Range; label: string; days: number | null }[] = [
  { value: "3m", label: "3M", days: 91 },
  { value: "6m", label: "6M", days: 182 },
  { value: "1y", label: "1Y", days: 365 },
  { value: "all", label: "All", days: null },
];

const HISTORY_PAGE = 10;

function metricFormatter(metric: ProgressMetric, f: Formatter): (value: number) => string {
  switch (metric) {
    // Unitless: the unit is in the series label, and "102.5 kg" does not fit an axis.
    case "e1rm":
    case "heaviest":
      return (value) => f.weightValue(value);
    case "volume":
      return (value) => f.compactVolume(value);
    case "reps":
    case "totalReps":
      return (value) => `${Math.round(value)}`;
    case "duration":
      return (value) => f.durationShort(value);
    case "distance":
      return (value) => f.distance(value);
  }
}

export default function ExerciseDetailPage() {
  const id = decodeURIComponent(useParams<{ id: string }>().id);
  const router = useRouter();
  const model = useModel();
  const f = useFormat();
  const formula = useSettings((s) => s.oneRepMaxFormula);

  const exercise = model.exercises.get(id);
  const trackingType = exercise?.trackingType ?? "weight_reps";

  const points = useMemo(() => sessionPoints(model, id), [model, id]);
  const totals = useMemo(() => exerciseTotals(model, id, points), [model, id, points]);
  const records = useMemo(() => bestRecords(model, id), [model, id]);
  const metrics = useMemo(() => metricsFor(trackingType), [trackingType]);

  const [chosenMetric, setMetric] = useState<ProgressMetric | null>(null);
  const metric = chosenMetric && metrics.includes(chosenMetric) ? chosenMetric : metrics[0]!;
  const [range, setRange] = useState<Range>("1y");
  // Ranges are measured back from when the page opened, not re-read every render.
  const [now] = useState(() => Date.now());
  const [historyShown, setHistoryShown] = useState(HISTORY_PAGE);

  const chart = useMemo<TimePoint[]>(() => {
    const days = RANGES.find((entry) => entry.value === range)!.days;
    const from = days === null ? 0 : now - days * 86_400_000;
    return points
      .filter((point) => point.t >= from)
      .map((point) => ({ t: point.t, value: metricValue(point, metric) }))
      .filter((point) => point.value > 0);
  }, [points, range, metric, now]);

  const repMaxes = useMemo(() => {
    if (!exercise || !TRACKING_FIELDS[trackingType].reps) return [];
    const loaded = TRACKING_FIELDS[trackingType].weight || USES_BODYWEIGHT.has(trackingType);
    if (!loaded) return [];
    const facts = (model.factsByExercise.get(id) ?? []).map((fact) => ({ ...fact, isCompleted: true }));
    const table = repMaxTable(facts, { trackingType, bodyweightKg: model.latestBodyweightKg ?? 0, formula });
    return [...table.entries()].sort((a, b) => a[0] - b[0]);
  }, [exercise, model, id, trackingType, formula]);

  if (!exercise) {
    return (
      <EmptyState
        title="Exercise not found"
        body="It may have been deleted on another device."
        action={
          <ButtonLink href="/exercises" variant="secondary">
            All exercises
          </ButtonLink>
        }
      />
    );
  }

  const custom = exercise.isCustom && exercise.row !== null && !exercise.isDeleted;
  const loaded = TRACKING_FIELDS[trackingType].weight || USES_BODYWEIGHT.has(trackingType);
  const fields = TRACKING_FIELDS[trackingType];
  const recentSessions = [...points].reverse();
  const recordSets = new Set(records.map((record) => record.setId).filter(Boolean));
  const allRecordSets = new Set((model.recordsByExercise.get(id) ?? []).map((record) => record.setId).filter(Boolean));

  async function onDelete() {
    if (!exercise) return;
    const ok = await confirm({
      title: `Delete ${exercise.name}?`,
      body: "It is removed from the library and your routines on every device. Past sessions keep their sets.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await deleteCustomExercise(exercise);
    toast(`${exercise.name} deleted`);
    router.replace("/exercises");
  }

  async function onArchive() {
    if (!exercise) return;
    await setExerciseArchived(exercise, !exercise.isArchived);
    toast(exercise.isArchived ? "Exercise restored" : "Exercise archived. It stays out of search until restored.");
  }

  const muscles = [exercise.primaryMuscle, ...exercise.secondaryMuscles.filter((muscle) => muscle !== exercise.primaryMuscle)];

  return (
    <>
      <PageHeader
        back={{ href: "/exercises", label: "Exercises" }}
        title={
          <span className="flex items-center gap-4">
            <ExerciseThumb exercise={exercise} size={56} className="rounded-xl" />
            <span className="min-w-0">
              <span className="block truncate">{exercise.name}</span>
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm font-normal tracking-normal">
                {exercise.isCustom ? <Badge>Custom</Badge> : null}
                {exercise.isDeleted ? <Badge tone="alarm">Deleted</Badge> : exercise.isArchived ? <Badge tone="warn">Archived</Badge> : null}
                <Badge tone="volt">{MUSCLE_GROUP_LABELS[exercise.primaryMuscle]}</Badge>
                {muscles.slice(1).map((muscle) => (
                  <Badge key={muscle}>{MUSCLE_GROUP_LABELS[muscle]}</Badge>
                ))}
                <span className="text-xs text-fg-3">
                  {EQUIPMENT_LABELS[exercise.equipment]} · {TRACKING_LABELS[trackingType]}
                </span>
              </span>
            </span>
          </span>
        }
        actions={
          <>
            {exercise.videoUrl ? (
              <a href={exercise.videoUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-surface-3 px-4 text-sm font-medium text-fg hover:bg-surface-4">
                <PlayCircle size={16} /> Watch demo
              </a>
            ) : null}
            {custom ? (
              <>
                <ButtonLink href={`/exercises/${encodeURIComponent(id)}/edit`}>
                  <Pencil size={15} /> Edit
                </ButtonLink>
                <Button variant="ghost" onClick={() => void onArchive()} title={exercise.isArchived ? "Unarchive" : "Archive"}>
                  {exercise.isArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                  {exercise.isArchived ? "Unarchive" : "Archive"}
                </Button>
                <Button variant="danger" onClick={() => void onDelete()}>
                  <Trash2 size={15} /> Delete
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {exercise.notes ? <p className="-mt-2 mb-6 max-w-2xl text-sm whitespace-pre-line text-fg-2">{exercise.notes}</p> : null}

      {points.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Trophy size={28} />}
            title="Not trained yet"
            body="Log it in a session on your phone and its progress, records and history show up here."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardBody className="grid grid-cols-2 gap-x-6 gap-y-5 pt-5 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Sessions" value={totals.sessions} hint={`${totals.workingSets} working sets`} />
              {loaded && fields.reps ? (
                <>
                  <Stat label="Best est. 1RM" value={f.weightValue(totals.bestOneRepMaxKg)} unit={f.weightUnit} />
                  <Stat label="Heaviest" value={f.weightValue(totals.heaviestKg)} unit={f.weightUnit} />
                  <Stat label="Best set volume" value={f.volumeValue(totals.bestSetVolumeKg)} unit={f.weightUnit} />
                  <Stat label="Total volume" value={f.compactVolume(totals.volumeKg)} unit={f.weightUnit} />
                </>
              ) : null}
              {fields.reps && !loaded ? (
                <>
                  <Stat label="Best set" value={totals.bestReps} unit="reps" />
                  <Stat label="Total reps" value={totals.totalReps.toLocaleString()} />
                </>
              ) : null}
              {fields.weight && !fields.reps ? <Stat label="Heaviest" value={f.weightValue(totals.heaviestKg)} unit={f.weightUnit} /> : null}
              {fields.distance ? (
                <>
                  <Stat label="Farthest" value={f.distance(totals.farthestKm)} />
                  <Stat label="Total distance" value={f.distance(totals.totalKm)} />
                </>
              ) : null}
              {fields.duration ? (
                <>
                  <Stat label="Longest" value={f.durationShort(totals.longestSeconds)} />
                  <Stat label="Total time" value={f.durationShort(totals.totalSeconds)} />
                </>
              ) : null}
              <Stat label="Last trained" value={totals.lastAt ? relativeDay(totals.lastAt) : "Never"} hint={totals.firstAt ? `Since ${formatDate(totals.firstAt, { month: "short", year: "numeric" })}` : undefined} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Progress"
              subtitle={`${METRIC_LABELS[metric]} per session`}
              action={<Segmented size="sm" value={range} onChange={setRange} options={RANGES} />}
            />
            <CardBody>
              {metrics.length > 1 ? (
                <Segmented
                  size="sm"
                  className="mb-4 max-w-full overflow-x-auto"
                  value={metric}
                  onChange={setMetric}
                  options={metrics.map((value) => ({ value, label: METRIC_LABELS[value] }))}
                />
              ) : null}
              {chart.length >= 2 ? (
                <TimeChart
                  data={chart}
                  format={metricFormatter(metric, f)}
                  valueLabel={metric === "e1rm" || metric === "heaviest" || metric === "volume" ? `${METRIC_LABELS[metric]} (${f.weightUnit})` : METRIC_LABELS[metric]}
                  height={260}
                />
              ) : (
                <EmptyState
                  className="py-10"
                  title={chart.length === 1 ? "One session in this range" : "No sessions in this range"}
                  body="Pick a longer range to see a trend."
                />
              )}
            </CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Personal records" subtitle="Best of each kind" />
              <div className="mt-3">
                {records.length === 0 ? (
                  <EmptyState className="py-8" title="No records yet" />
                ) : (
                  records.map((record) => (
                    <ListRow key={record.id} href={record.workoutId ? `/history/${record.workoutId}` : undefined}>
                      <Trophy size={16} className="shrink-0 text-record" />
                      <span className="flex-1 text-sm text-fg-2">{PR_KIND_LABELS[record.kind]}</span>
                      <span className="text-right">
                        <span className="tabular block text-sm font-medium text-fg">
                          {f.record(record.kind, record.value)}
                          {record.reps && (record.kind === "heaviest_weight" || record.kind === "best_set_volume") ? (
                            <span className="text-fg-3"> × {record.reps}</span>
                          ) : null}
                        </span>
                        <span className="block text-xs text-fg-3">{formatDateShort(record.achievedAt)}</span>
                      </span>
                    </ListRow>
                  ))
                )}
              </div>
            </Card>

            {repMaxes.length > 0 ? (
              <Card>
                <CardHeader title="Rep maxes" subtitle="Heaviest load lifted for at least this many reps" />
                <div className="mt-3 px-5 pb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="font-mono text-[10px] tracking-wider text-fg-3 uppercase">
                        <th className="pb-2 text-left font-normal">Reps</th>
                        <th className="pb-2 text-right font-normal">Best</th>
                        <th className="pb-2 text-right font-normal">Est. 1RM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repMaxes.map(([reps, kg]) => (
                        <tr key={reps} className="border-t border-line">
                          <td className="tabular py-2 text-fg-2">{reps}</td>
                          <td className="tabular py-2 text-right font-medium text-fg">{f.weight(kg)}</td>
                          <td className="tabular py-2 text-right text-fg-3">{f.weight(estimateOneRepMax(kg, reps, formula))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}
          </div>

          <Card>
            <CardHeader title="History" subtitle={`${points.length} session${points.length === 1 ? "" : "s"}, newest first`} />
            <div className="mt-3">
              {recentSessions.slice(0, historyShown).map((point) => {
                const labels = setLabels(point.sets);
                return (
                  <div key={point.session.id} className="border-t border-line px-5 py-4 first:border-t-0">
                    <Link href={`/history/${point.session.id}`} className="group mb-2 flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium text-fg group-hover:text-volt">{point.session.name}</span>
                      <span className="shrink-0 text-xs text-fg-3">{formatDate(point.t, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
                    </Link>
                    {/* Column-major, so the sets read down the first column and then the second. */}
                    <ol
                      className="grid gap-x-6 gap-y-1 sm:grid-flow-col sm:grid-cols-2"
                      style={{ gridTemplateRows: `repeat(${Math.ceil(point.sets.length / 2)}, auto)` }}
                    >
                      {point.sets.map((set, index) => (
                        <li key={set.id} className={cn("flex items-center gap-3 text-sm", !set.isCompleted && "opacity-40")}>
                          <span
                            className={cn(
                              "w-5 shrink-0 text-center font-mono text-xs",
                              set.setType === "warmup" ? "text-warn" : set.setType === "normal" ? "text-fg-3" : "text-info",
                            )}
                          >
                            {labels[index]}
                          </span>
                          <span className="tabular text-fg">{describeSet(set, trackingType, f)}</span>
                          {set.oneRepMaxKg > 0 ? <span className="tabular text-xs text-fg-3">1RM {f.weight(set.oneRepMaxKg)}</span> : null}
                          {allRecordSets.has(set.id) ? (
                            <Trophy size={13} className={recordSets.has(set.id) ? "text-record" : "text-record/50"} aria-label="Personal record" />
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
              {historyShown < recentSessions.length ? (
                <div className="border-t border-line px-5 py-3">
                  <Button variant="ghost" size="sm" onClick={() => setHistoryShown((shown) => shown + HISTORY_PAGE * 2)}>
                    Show more ({recentSessions.length - historyShown} left)
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
