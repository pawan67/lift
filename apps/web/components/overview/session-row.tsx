"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import type { Session } from "@/lib/data/model";
import { formatDateShort, formatTime, type Formatter } from "@/lib/format";
import { exerciseSummary } from "@/lib/overview/totals";

/** One session in a list: name, when, the headline numbers and what was trained. */
export function SessionRow({ session, f, showDate = true }: { session: Session; f: Formatter; showDate?: boolean }) {
  const prs = session.records.length;
  const date = new Date(session.startedAt);
  return (
    <Link
      href={`/history/${session.id}`}
      className="group flex items-center gap-4 border-t border-line px-5 py-3 transition-colors duration-150 first:border-t-0 hover:bg-surface-2/70 active:bg-surface-2"
    >
      {showDate ? (
        <div className="hidden w-9 shrink-0 flex-col items-start sm:flex">
          <span className="text-xs leading-4 text-fg-3">{date.toLocaleDateString(undefined, { weekday: "short" })}</span>
          <span className="tabular text-lg leading-6 font-semibold tracking-[-0.02em] text-fg">{date.getDate()}</span>
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-fg">{session.name || "Workout"}</span>
          {prs > 0 ? (
            <span className="tabular shrink-0 text-xs text-record">
              {prs} record{prs === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <div className="tabular mt-0.5 text-xs text-fg-3">
          {/* On a wide screen the date column already says which day. */}
          {showDate ? <span className="sm:hidden">{formatDateShort(session.startedAt)}, </span> : null}
          {formatTime(session.startedAt)} · {f.durationShort(session.durationSeconds)} · {f.volume(session.volumeKg)} · {session.workingSets} sets
        </div>
        <div className="mt-1 truncate text-xs text-fg-2">{exerciseSummary(session)}</div>
      </div>
      <ChevronRight size={16} className="shrink-0 text-fg-3/60 transition-colors duration-150 group-hover:text-fg" />
    </Link>
  );
}
