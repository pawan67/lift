"use client";

import {
  BODY_PART_LABELS,
  MUSCLE_GROUP_LABELS,
  PR_KIND_LABELS,
  SET_TYPE_BADGE,
  SET_TYPE_LABELS,
  type TrackingType,
} from "@lift/shared";
import { ListChecks, Trophy } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";

import { bodyPartColor } from "@/components/overview/body-parts";
import { ExerciseThumb } from "@/components/exercises/exercise-thumb";
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { PersonalRecordRow } from "@/lib/data/types";
import { useModel, type SessionExercise, type SessionSet } from "@/lib/data/model";
import { formatDateTime, formatTime, integer, type Formatter, useFormat } from "@/lib/format";
import { sessionMuscleSplit } from "@/lib/overview/totals";

/** Adjacent blocks sharing a superset group are drawn as one unit, lettered like the phone does. */
function groupBlocks(blocks: readonly SessionExercise[]): { letter: string | null; blocks: SessionExercise[] }[] {
  const out: { letter: string | null; group: number | null; blocks: SessionExercise[] }[] = [];
  let letters = 0;
  for (const block of blocks) {
    const group = block.row.supersetGroup;
    const last = out.at(-1);
    if (group !== null && last && last.group === group) {
      last.blocks.push(block);
      continue;
    }
    out.push({ letter: null, group, blocks: [block] });
  }
  for (const entry of out) {
    if (entry.group !== null && entry.blocks.length > 1) entry.letter = String.fromCharCode(65 + letters++);
  }
  return out;
}

function describeSet(set: SessionSet, tracking: TrackingType, f: Formatter): string {
  const reps = set.reps ?? 0;
  const weight = set.weightKg ?? 0;
  switch (tracking) {
    case "weight_reps":
      return `${f.weight(weight)} × ${reps}`;
    case "bodyweight_reps":
      return `Bodyweight × ${reps}`;
    case "weighted_bodyweight":
      return weight > 0 ? `+${f.weight(weight)} × ${reps}` : `Bodyweight × ${reps}`;
    case "assisted_bodyweight":
      return weight > 0 ? `−${f.weight(weight)} assist × ${reps}` : `Bodyweight × ${reps}`;
    case "duration":
      return set.durationSeconds ? f.duration(set.durationSeconds) : "–";
    case "distance_duration": {
      const parts = [set.distanceKm ? f.distance(set.distanceKm) : null, set.durationSeconds ? f.duration(set.durationSeconds) : null];
      return parts.filter(Boolean).join(" in ") || "–";
    }
    case "weight_distance": {
      const parts = [weight ? f.weight(weight) : null, set.distanceKm ? f.distance(set.distanceKm) : null];
      return parts.filter(Boolean).join(" · ") || "–";
    }
    case "reps_only":
      return `${reps} reps`;
  }
}

const SHOWS_ONE_REP_MAX: ReadonlySet<TrackingType> = new Set(["weight_reps", "weighted_bodyweight", "assisted_bodyweight"]);

function ExerciseBlock({
  block,
  recordsBySet,
  f,
}: {
  block: SessionExercise;
  recordsBySet: Map<string, PersonalRecordRow[]>;
  f: Formatter;
}) {
  const tracking = block.exercise.trackingType;
  const showOneRm = SHOWS_ONE_REP_MAX.has(tracking) && block.sets.some((set) => set.oneRepMaxKg > 0);
  const showRpe = block.sets.some((set) => set.rpe !== null);
  const working = block.sets.filter((set) => set.isWorking);
  const volume = working.reduce((sum, set) => sum + set.volumeKg, 0);
  const best = working.reduce((top, set) => Math.max(top, set.oneRepMaxKg), 0);
  // Warm-ups wear a W; everything else is numbered among the working sets.
  const labels = block.sets.reduce<string[]>((out, set) => {
    const badge = SET_TYPE_BADGE[set.setType];
    const count = out.filter((label) => /^\d+$/.test(label)).length;
    out.push(set.setType === "warmup" ? (badge ?? "W") : badge ?? String(count + 1));
    return out;
  }, []);

  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-3">
        <ExerciseThumb exercise={block.exercise} size={40} />
        <div className="min-w-0 flex-1">
          <Link href={`/exercises/${encodeURIComponent(block.exercise.id)}`} className="block truncate text-sm font-medium text-fg hover:text-volt">
            {block.exercise.name}
          </Link>
          <div className="tabular text-xs text-fg-3">
            {MUSCLE_GROUP_LABELS[block.exercise.primaryMuscle]} · {working.length} set{working.length === 1 ? "" : "s"}
            {volume > 0 ? ` · ${f.volume(volume)}` : ""}
            {best > 0 ? ` · best est. 1RM ${f.weight(best)}` : ""}
          </div>
        </div>
      </div>
      {block.row.notes ? <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">{block.row.notes}</p> : null}

      {block.sets.length > 0 ? (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="font-mono text-[10px] tracking-wider text-fg-3 uppercase">
              <th className="w-12 pb-1.5 text-left font-normal">Set</th>
              <th className="pb-1.5 text-left font-normal">Performed</th>
              {showRpe ? <th className="w-14 pb-1.5 text-right font-normal">RPE</th> : null}
              {showOneRm ? <th className="w-24 pb-1.5 text-right font-normal">Est. 1RM</th> : null}
            </tr>
          </thead>
          <tbody>
            {block.sets.map((set, index) => {
              const records = recordsBySet.get(set.id) ?? [];
              return (
                <tr key={set.id} className={cn("border-t border-line", !set.isCompleted && "opacity-45")}>
                  <td className="py-2">
                    <span
                      title={SET_TYPE_LABELS[set.setType]}
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-md font-mono text-xs",
                        set.setType === "warmup" && "bg-warn/15 text-warn",
                        set.setType === "drop" && "bg-info/15 text-info",
                        set.setType === "failure" && "bg-alarm/15 text-alarm",
                        set.setType === "normal" && "bg-surface-3 text-fg-2",
                      )}
                    >
                      {labels[index]}
                    </span>
                  </td>
                  <td className="tabular py-2 text-fg">
                    <span>{describeSet(set, tracking, f)}</span>
                    {records.length > 0 ? (
                      <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                        {records.map((record) => (
                          <Badge key={record.id} tone="record">
                            <Trophy size={10} /> {PR_KIND_LABELS[record.kind]}
                          </Badge>
                        ))}
                      </span>
                    ) : null}
                    {!set.isCompleted ? <span className="ml-2 text-xs text-fg-3">not completed</span> : null}
                  </td>
                  {showRpe ? <td className="tabular py-2 text-right text-fg-2">{set.rpe ?? ""}</td> : null}
                  {showOneRm ? (
                    <td className="tabular py-2 text-right text-fg-2">{set.oneRepMaxKg > 0 ? f.weight(set.oneRepMaxKg) : ""}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="mt-3 text-sm text-fg-3">No sets recorded.</p>
      )}
    </div>
  );
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const model = useModel();
  const f = useFormat();
  const session = model.sessionById.get(id);

  const recordsBySet = useMemo(() => {
    const map = new Map<string, PersonalRecordRow[]>();
    for (const record of session?.records ?? []) {
      if (!record.setId) continue;
      const list = map.get(record.setId);
      if (list) list.push(record);
      else map.set(record.setId, [record]);
    }
    return map;
  }, [session]);

  const split = useMemo(() => (session ? sessionMuscleSplit(session.exercises) : []), [session]);
  const groups = useMemo(() => (session ? groupBlocks(session.exercises) : []), [session]);

  if (!session) {
    return (
      <>
        <PageHeader title="Session" back={{ href: "/history", label: "History" }} />
        <Card>
          <EmptyState title="Session not found" body="It may have been deleted on another device, or it has not synced to this browser yet." />
        </Card>
      </>
    );
  }

  const routine = session.row.routineId ? model.routineById.get(session.row.routineId) : undefined;

  return (
    <>
      <PageHeader
        title={session.name || "Workout"}
        subtitle={`${formatDateTime(session.startedAt)} to ${formatTime(session.finishedAt)}`}
        back={{ href: "/history", label: "History" }}
        actions={
          routine ? (
            <ButtonLink href={`/routines/${routine.id}`} variant="outline" size="sm">
              <ListChecks size={14} /> {routine.name}
            </ButtonLink>
          ) : null
        }
      />

      <Card className="mb-4">
        <CardBody className="grid grid-cols-2 gap-x-4 gap-y-5 pt-5 sm:grid-cols-5">
          <Stat label="Duration" value={f.durationShort(session.durationSeconds)} />
          <Stat label="Volume" value={f.volumeValue(session.volumeKg)} unit={f.weightUnit} />
          <Stat label="Sets" value={integer(session.workingSets)} />
          <Stat label="Reps" value={integer(session.reps)} />
          <Stat label="Records" value={integer(session.records.length)} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {session.row.notes ? (
            <Card>
              <CardHeader title="Notes" />
              <CardBody>
                <p className="text-sm whitespace-pre-wrap text-fg-2">{session.row.notes}</p>
              </CardBody>
            </Card>
          ) : null}

          {groups.length === 0 ? (
            <Card>
              <EmptyState title="No exercises in this session" />
            </Card>
          ) : (
            groups.map((group) => (
              <Card key={group.blocks[0]!.row.id} className={cn("overflow-hidden", group.letter && "border-l-2 border-l-volt")}>
                {group.letter ? (
                  <div className="flex items-center gap-2 px-5 pt-4">
                    <Badge tone="volt">Superset {group.letter}</Badge>
                    <span className="text-xs text-fg-3">Performed back to back</span>
                  </div>
                ) : null}
                <div className="divide-y divide-line">
                  {group.blocks.map((block) => (
                    <ExerciseBlock key={block.row.id} block={block} recordsBySet={recordsBySet} f={f} />
                  ))}
                </div>
              </Card>
            ))
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Muscle split" subtitle="Working sets by primary muscle" />
            <CardBody>
              {split.length > 0 ? (
                <>
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-3">
                    {split.map((slice) => (
                      <div key={slice.part} style={{ width: `${slice.share * 100}%`, background: bodyPartColor(slice.part) }} />
                    ))}
                  </div>
                  <ul className="mt-4 space-y-2">
                    {split.map((slice) => (
                      <li key={slice.part} className="flex items-center gap-2 text-sm">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: bodyPartColor(slice.part) }} />
                        <span className="text-fg-2">{BODY_PART_LABELS[slice.part]}</span>
                        <span className="tabular ml-auto text-fg">
                          {slice.sets} set{slice.sets === 1 ? "" : "s"}
                        </span>
                        <span className="tabular w-10 text-right text-xs text-fg-3">{Math.round(slice.share * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-fg-3">No working sets.</p>
              )}
            </CardBody>
          </Card>

          {session.records.length > 0 ? (
            <Card>
              <CardHeader title="Records set" subtitle={`${session.records.length} personal best${session.records.length === 1 ? "" : "s"}`} />
              <ul className="mt-3 border-t border-line">
                {session.records.map((record) => (
                  <li key={record.id} className="flex items-center gap-3 border-t border-line px-5 py-2.5 first:border-t-0">
                    <Trophy size={15} className="shrink-0 text-record" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-fg">{model.exercises.get(record.exerciseId)?.name ?? "Unknown exercise"}</div>
                      <div className="text-xs text-fg-3">{PR_KIND_LABELS[record.kind]}</div>
                    </div>
                    <span className="tabular text-sm font-medium">{f.record(record.kind, record.value)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
