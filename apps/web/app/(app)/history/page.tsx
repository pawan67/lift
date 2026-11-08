"use client";

import { History as HistoryIcon, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useMemo, useState } from "react";

import { SessionRow } from "@/components/overview/session-row";
import { Button, Card, EmptyState, Input, PageHeader, Segmented, Select, Stat } from "@/components/ui/primitives";
import { useModel, type Session } from "@/lib/data/model";
import { integer, useFormat } from "@/lib/format";
import { STAT_RANGES, type StatRange } from "@/lib/stats/windows";

/** Rows rendered per step. A year of four-day weeks is ~200; a decade is 2,000. */
const PAGE = 60;
const DAY_MS = 86_400_000;

const RANGE_OPTIONS = STAT_RANGES.filter((range) => range.value !== "7d").map((range) => ({
  value: range.value,
  label: range.value === "all" ? "All" : range.value.toUpperCase(),
}));

interface MonthGroup {
  key: string;
  label: string;
  sessions: Session[];
  volumeKg: number;
}

function HistoryScreen() {
  const model = useModel();
  const f = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [query, setQuery] = useState("");
  const [range, setRange] = useState<StatRange>("all");
  const [limit, setLimit] = useState(PAGE);
  const [now] = useState(() => Date.now());
  const routineId = params.get("routine") ?? "";
  const exerciseId = params.get("exercise") ?? "";
  const search = useDeferredValue(query.trim().toLowerCase());

  // Filters that other screens link to live in the URL, so "this exercise's sessions" is a link.
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    setLimit(PAGE);
    router.replace(`${pathname}${next.size > 0 ? `?${next.toString()}` : ""}`, { scroll: false });
  };

  const routineOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const routine of model.routines) names.set(routine.id, routine.name);
    // Sessions started from a routine that has since been deleted still deserve a filter.
    for (const session of model.sessions) {
      const id = session.row.routineId;
      if (id && !names.has(id)) names.set(id, session.name);
    }
    return [...names].sort((a, b) => a[1].localeCompare(b[1]));
  }, [model.routines, model.sessions]);

  const exerciseOptions = useMemo(
    () =>
      [...model.sessionsByExercise.keys()]
        .map((id) => model.exercises.get(id))
        .filter((exercise) => exercise !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [model.sessionsByExercise, model.exercises],
  );

  const filtered = useMemo(() => {
    const window = STAT_RANGES.find((entry) => entry.value === range)?.days ?? null;
    const since = window === null ? -Infinity : now - window * DAY_MS;
    const pool = exerciseId ? (model.sessionsByExercise.get(exerciseId) ?? []) : model.sessions;

    return pool.filter((session) => {
      if (session.startedAt < since) return false;
      if (routineId && session.row.routineId !== routineId) return false;
      if (!search) return true;
      if (session.name.toLowerCase().includes(search)) return true;
      if (session.row.notes?.toLowerCase().includes(search)) return true;
      return session.exercises.some((block) => block.exercise.name.toLowerCase().includes(search));
    });
  }, [model.sessions, model.sessionsByExercise, exerciseId, routineId, range, search, now]);

  const totals = useMemo(() => {
    let volumeKg = 0;
    let seconds = 0;
    let sets = 0;
    for (const session of filtered) {
      volumeKg += session.volumeKg;
      seconds += session.durationSeconds;
      sets += session.workingSets;
    }
    return { volumeKg, seconds, sets };
  }, [filtered]);

  const groups = useMemo(() => {
    const out: MonthGroup[] = [];
    for (const session of filtered.slice(0, limit)) {
      const date = new Date(session.startedAt);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      let group = out.at(-1);
      if (!group || group.key !== key) {
        group = { key, label: date.toLocaleDateString(undefined, { month: "long", year: "numeric" }), sessions: [], volumeKg: 0 };
        out.push(group);
      }
      group.sessions.push(session);
    }
    // Month totals cover the whole month, not just the rows shown so far.
    const byKey = new Map(out.map((group) => [group.key, group]));
    for (const session of filtered) {
      const date = new Date(session.startedAt);
      const group = byKey.get(`${date.getFullYear()}-${date.getMonth()}`);
      if (group) group.volumeKg += session.volumeKg;
    }
    return out;
  }, [filtered, limit]);

  const monthCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of filtered) {
      const date = new Date(session.startedAt);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [filtered]);

  const filtering = Boolean(search || routineId || exerciseId || range !== "all");

  if (model.sessions.length === 0) {
    return (
      <>
        <PageHeader title="History" />
        <Card>
          <EmptyState
            icon={<HistoryIcon size={28} />}
            title="No sessions yet"
            body="Sessions you finish in the Lift app on your phone appear here after it syncs."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="History" subtitle={`${integer(model.sessions.length)} sessions since ${new Date(model.firstSessionAt!).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`} />

      <div className="mb-8">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_13rem_13rem_auto]">
          <div className="relative sm:col-span-2 xl:col-span-1">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE);
              }}
              placeholder="Search sessions, exercises or notes"
              className="pl-9"
            />
          </div>
          <Select value={routineId} onChange={(event) => setParam("routine", event.target.value)} aria-label="Routine">
            <option value="">All routines</option>
            {routineOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          <Select value={exerciseId} onChange={(event) => setParam("exercise", event.target.value)} aria-label="Exercise">
            <option value="">All exercises</option>
            {exerciseOptions.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>
                {exercise.name}
              </option>
            ))}
          </Select>
          <Segmented
            value={range}
            options={RANGE_OPTIONS}
            onChange={(value) => {
              setRange(value);
              setLimit(PAGE);
            }}
            className="self-center justify-self-start sm:col-span-2 xl:col-span-1"
          />
        </div>
        {filtering ? (
          // Fades in when the first filter is set, so the totals read as a result of it rather than a jump in the layout.
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-5 transition-[opacity,transform] duration-200 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0">
            <div className="flex flex-wrap gap-x-10 gap-y-3">
              <Stat label="Sessions" value={integer(filtered.length)} />
              <Stat label="Volume" value={f.volumeValue(totals.volumeKg)} unit={f.weightUnit} />
              <Stat label="Sets" value={integer(totals.sets)} />
              <Stat label="Time" value={f.durationShort(totals.seconds)} />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                setRange("all");
                setLimit(PAGE);
                router.replace(pathname, { scroll: false });
              }}
            >
              <X size={14} /> Clear filters
            </Button>
          </div>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState title="No sessions match" body="Try a wider range or a different search." />
        </Card>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold tracking-tight text-fg">{group.label}</h2>
                <span className="tabular text-xs text-fg-3">
                  {monthCounts.get(group.key)} session{monthCounts.get(group.key) === 1 ? "" : "s"} · {f.volume(group.volumeKg)}
                </span>
              </div>
              <Card className="overflow-hidden">
                {group.sessions.map((session) => (
                  <SessionRow key={session.id} session={session} f={f} />
                ))}
              </Card>
            </section>
          ))}
          {filtered.length > limit ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setLimit((current) => current + PAGE * 2)}>
                Show more ({integer(filtered.length - limit)} left)
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

export default function HistoryPage() {
  return (
    <Suspense>
      <HistoryScreen />
    </Suspense>
  );
}
