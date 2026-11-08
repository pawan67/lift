"use client";

import { ChevronRight, Trophy } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/primitives";
import type { Session } from "@/lib/data/model";
import { formatDateShort, formatTime, type Formatter } from "@/lib/format";
import { exerciseSummary } from "@/lib/overview/totals";

/** One session in a list: name, when, the headline numbers and what was trained. */
export function SessionRow({ session, f, showDate = true }: { session: Session; f: Formatter; showDate?: boolean }) {
  const prs = session.records.length;
  return (
    <Link
      href={`/history/${session.id}`}
      className="group flex items-center gap-4 border-t border-line px-5 py-3.5 transition-colors first:border-t-0 hover:bg-surface-2"
    >
      <div className="hidden w-12 shrink-0 flex-col items-center rounded-lg bg-surface-2 py-1.5 sm:flex">
        <span className="font-mono text-[10px] text-fg-3 uppercase">
          {new Date(session.startedAt).toLocaleDateString(undefined, { month: "short" })}
        </span>
        <span className="tabular text-lg leading-tight font-semibold text-fg">{new Date(session.startedAt).getDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-fg">{session.name || "Workout"}</span>
          {prs > 0 ? (
            <Badge tone="record">
              <Trophy size={11} /> {prs}
            </Badge>
          ) : null}
        </div>
        <div className="tabular mt-0.5 text-xs text-fg-3">
          {showDate ? `${formatDateShort(session.startedAt)}, ` : ""}
          {formatTime(session.startedAt)} · {f.durationShort(session.durationSeconds)} · {f.volume(session.volumeKg)} ·{" "}
          {session.workingSets} sets
        </div>
        <div className="mt-1 truncate text-xs text-fg-2">{exerciseSummary(session)}</div>
      </div>
      <ChevronRight size={16} className="shrink-0 text-fg-3 transition-colors group-hover:text-fg" />
    </Link>
  );
}
