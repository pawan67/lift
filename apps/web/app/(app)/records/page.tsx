"use client";

import { PR_KIND_LABELS, PR_KINDS, type PrKind } from "@lift/shared";
import { Search, Trophy } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState, type CSSProperties } from "react";

import { ExerciseThumb } from "@/components/exercises/exercise-thumb";
import { Button, Card, EmptyState, Input, PageHeader, Segmented } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { useModel, type ExerciseInfo } from "@/lib/data/model";
import type { PersonalRecordRow } from "@/lib/data/types";
import { formatDateShort, integer, useFormat } from "@/lib/format";

/** Rows per step; a few hundred exercises with records is ordinary after a few years. */
const PAGE = 50;
const RECENT_DAYS = 30;

/** Shorter names for the chips, where the full label would wrap. */
const SHORT_LABELS: Record<PrKind, string> = {
  heaviest_weight: "Heaviest",
  best_1rm: "Est. 1RM",
  best_set_volume: "Set volume",
  best_session_volume: "Session volume",
  most_reps: "Most reps",
  best_duration: "Duration",
  best_distance: "Distance",
};

interface Entry {
  exercise: ExerciseInfo;
  /** Best per kind, in PR_KINDS order. */
  bests: PersonalRecordRow[];
  latestAt: number;
}

type Sort = "recent" | "name" | "value";

export default function RecordsPage() {
  const model = useModel();
  const f = useFormat();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<PrKind | "">("");
  const [sort, setSort] = useState<Sort>("recent");
  const [limit, setLimit] = useState(PAGE);
  const [now] = useState(() => Date.now());
  const search = useDeferredValue(query.trim().toLowerCase());

  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const [exerciseId, records] of model.recordsByExercise) {
      const exercise = model.exercises.get(exerciseId);
      if (!exercise) continue;
      // Records are rows per achievement; the current best is the highest value of each kind.
      const best = new Map<PrKind, PersonalRecordRow>();
      for (const record of records) {
        const current = best.get(record.kind);
        if (!current || record.value > current.value || (record.value === current.value && record.achievedAt < current.achievedAt)) {
          best.set(record.kind, record);
        }
      }
      const bests = PR_KINDS.map((k) => best.get(k)).filter((record): record is PersonalRecordRow => record !== undefined);
      if (bests.length === 0) continue;
      out.push({ exercise, bests, latestAt: Math.max(...bests.map((record) => record.achievedAt)) });
    }
    return out;
  }, [model.recordsByExercise, model.exercises]);

  const kindsPresent = useMemo(() => PR_KINDS.filter((k) => entries.some((entry) => entry.bests.some((record) => record.kind === k))), [entries]);

  const visible = useMemo(() => {
    const filtered = entries.filter((entry) => {
      if (kind && !entry.bests.some((record) => record.kind === kind)) return false;
      return !search || entry.exercise.name.toLowerCase().includes(search);
    });
    const valueOf = (entry: Entry) => entry.bests.find((record) => record.kind === kind)?.value ?? 0;
    return filtered.sort((a, b) => {
      if (sort === "name") return a.exercise.name.localeCompare(b.exercise.name);
      if (sort === "value" && kind) return valueOf(b) - valueOf(a);
      return b.latestAt - a.latestAt;
    });
  }, [entries, kind, search, sort]);

  // The columns on screen: one per record type, estimated 1RM last as the headline, or only the type filtered to.
  const headlineKind: PrKind = kind || (kindsPresent.includes("best_1rm") ? "best_1rm" : (kindsPresent[0] ?? "best_1rm"));
  const columns: PrKind[] = kind ? [kind] : [...kindsPresent.filter((k) => k !== headlineKind), headlineKind];

  const recentCount = useMemo(() => entries.filter((entry) => entry.latestAt >= now - RECENT_DAYS * 86_400_000).length, [entries, now]);

  if (entries.length === 0) {
    return (
      <>
        <PageHeader title="Personal records" />
        <Card>
          <EmptyState
            icon={<Trophy size={28} />}
            title="No records yet"
            body="Records are set when you beat a previous best in a session logged on your phone: heaviest weight, best estimated 1RM, most reps and more."
          />
        </Card>
      </>
    );
  }

  const sortOptions: { value: Sort; label: string }[] = [
    { value: "recent", label: "Recent" },
    { value: "name", label: "A to Z" },
    ...(kind ? [{ value: "value" as const, label: "Best" }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Personal records"
        subtitle={`${integer(entries.length)} exercises with records, ${recentCount} improved in the last ${RECENT_DAYS} days`}
      />

      <div className="mb-6">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_13rem_auto]">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE);
              }}
              placeholder="Search exercises"
              className="pl-9"
            />
          </div>
          <Select<PrKind | "">
            value={kind}
            onValueChange={(next) => {
              setKind(next);
              setSort(next ? "value" : "recent");
              setLimit(PAGE);
            }}
            aria-label="Record type"
            options={[{ value: "", label: "All record types" }, ...kindsPresent.map((k) => ({ value: k, label: PR_KIND_LABELS[k] }))]}
          />
          <Segmented value={sort} options={sortOptions} onChange={setSort} className="self-center justify-self-start" />
        </div>
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState title="No records match" body="Try another search or record type." />
        </Card>
      ) : (
        <Card className="overflow-hidden" style={{ "--record-cols": `repeat(${columns.length}, 6.5rem)` } as CSSProperties}>
          {/* Column headers only where the figures line up in columns; on a phone each figure carries its own label. */}
          <div className="hidden gap-x-4 border-b border-line px-5 py-2 text-xs text-fg-3 sm:grid sm:grid-cols-[minmax(0,1fr)_var(--record-cols)]">
            <span>Exercise</span>
            {columns.map((k) => (
              <span key={k} className={cn("text-right", k === headlineKind && "text-fg-2")}>
                {SHORT_LABELS[k]}
              </span>
            ))}
          </div>
          {visible.slice(0, limit).map((entry) => {
            const fresh = entry.latestAt >= now - RECENT_DAYS * 86_400_000;
            return (
              <div
                key={entry.exercise.id}
                className="flex flex-col gap-2 border-t border-line px-5 py-2.5 sm:grid sm:grid-cols-[minmax(0,1fr)_var(--record-cols)] sm:items-center sm:gap-x-4 [&:nth-child(2)]:border-t-0"
              >
                <Link href={`/exercises/${encodeURIComponent(entry.exercise.id)}`} className="group flex min-w-0 items-center gap-3">
                  <ExerciseThumb exercise={entry.exercise} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-fg transition-colors duration-150 group-hover:text-volt">{entry.exercise.name}</div>
                    <div className="tabular text-xs text-fg-3">
                      Latest <span className={fresh ? "text-fg-2" : undefined}>{formatDateShort(entry.latestAt)}</span>
                      {fresh ? <span className="sr-only">, improved in the last {RECENT_DAYS} days</span> : null}
                    </div>
                  </div>
                </Link>
                <div className="grid grid-cols-4 gap-x-3 gap-y-2 sm:contents">
                  {columns.map((k) => {
                    const record = entry.bests.find((best) => best.kind === k);
                    return record ? (
                      <RecordFigure key={k} record={record} label={SHORT_LABELS[k]} value={f.record(k, record.value)} headline={k === headlineKind} />
                    ) : (
                      <span key={k} className="hidden text-right text-sm text-fg-3/50 sm:block" aria-hidden>
                        –
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {visible.length > limit ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => setLimit((current) => current + PAGE * 2)}>
            Show more ({integer(visible.length - limit)} left)
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** One best: how much, when, and a link to the session it was set in. The label only shows on a phone, where there are no column headers. */
function RecordFigure({ record, label, value, headline }: { record: PersonalRecordRow; label: string; value: string; headline: boolean }) {
  const body = (
    <>
      <span className="text-[11px] text-fg-3 sm:hidden">{label}</span>
      <span className={cn("tabular text-sm transition-colors duration-150 group-hover:text-volt", headline ? "font-semibold text-fg" : "text-fg-2")}>{value}</span>
      <span className="tabular text-[11px] text-fg-3">{formatDateShort(record.achievedAt)}</span>
    </>
  );
  const className = "flex flex-col leading-tight sm:items-end";
  return record.workoutId ? (
    <Link
      href={`/history/${record.workoutId}`}
      className={cn(className, "group")}
      title={`${PR_KIND_LABELS[record.kind]}: open the session`}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
