"use client";

import { PR_KIND_LABELS, PR_KINDS, type PrKind } from "@lift/shared";
import { Search, Trophy } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import { ExerciseThumb } from "@/components/exercises/exercise-thumb";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Segmented, Select } from "@/components/ui/primitives";
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

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
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
          <Select
            value={kind}
            onChange={(event) => {
              const next = event.target.value as PrKind | "";
              setKind(next);
              setSort(next ? "value" : "recent");
              setLimit(PAGE);
            }}
            aria-label="Record type"
          >
            <option value="">All record types</option>
            {kindsPresent.map((k) => (
              <option key={k} value={k}>
                {PR_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <Segmented value={sort} options={sortOptions} onChange={setSort} className="justify-self-start" />
        </div>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <EmptyState title="No records match" body="Try another search or record type." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {visible.slice(0, limit).map((entry) => {
            const headline = (kind ? entry.bests.find((record) => record.kind === kind) : undefined) ??
              entry.bests.find((record) => record.kind === "best_1rm") ??
              entry.bests[0]!;
            const others = kind ? [] : entry.bests.filter((record) => record !== headline);
            const fresh = entry.latestAt >= now - RECENT_DAYS * 86_400_000;
            return (
              <div key={entry.exercise.id} className="flex flex-col gap-3 border-t border-line px-5 py-4 first:border-t-0 sm:flex-row sm:items-center">
                <Link href={`/exercises/${encodeURIComponent(entry.exercise.id)}`} className="group flex min-w-0 flex-1 items-center gap-3">
                  <ExerciseThumb exercise={entry.exercise} size={44} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg group-hover:text-volt">{entry.exercise.name}</span>
                      {fresh ? <Badge tone="record">New</Badge> : null}
                    </div>
                    <div className="mt-0.5 text-xs text-fg-3">Latest {formatDateShort(entry.latestAt)}</div>
                  </div>
                </Link>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {/* The headline leads on a phone, where the row wraps, and closes the row on a wide screen. */}
                  <RecordChip record={headline} label={SHORT_LABELS[headline.kind]} value={f.record(headline.kind, headline.value)} headline />
                  {others.map((record) => (
                    <RecordChip key={record.kind} record={record} label={SHORT_LABELS[record.kind]} value={f.record(record.kind, record.value)} />
                  ))}
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

/** One best: what it is, how much, and a link to the session it was set in. */
function RecordChip({ record, label, value, headline = false }: { record: PersonalRecordRow; label: string; value: string; headline?: boolean }) {
  const body = (
    <>
      <span className={cn("font-mono text-[10px] tracking-wide uppercase", headline ? "text-record/80" : "text-fg-3")}>{label}</span>
      <span className={cn("tabular font-semibold", headline ? "text-base text-record" : "text-sm text-fg")}>{value}</span>
      <span className="text-[10px] text-fg-3">{formatDateShort(record.achievedAt)}</span>
    </>
  );
  const className = cn(
    "flex min-w-[92px] flex-col rounded-xl border px-3 py-1.5 transition-colors",
    headline ? "border-record/30 bg-record/10 sm:order-last" : "border-line bg-surface-2",
  );
  return record.workoutId ? (
    <Link href={`/history/${record.workoutId}`} className={cn(className, "hover:border-line-strong")} title={`${PR_KIND_LABELS[record.kind]}: open the session`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
