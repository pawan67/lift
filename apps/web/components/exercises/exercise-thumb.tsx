/**
 * An exercise's still frame, or its initials when the catalog has none (custom
 * exercises, ~6% of the catalog). Plain `<img>`, lazily loaded: the frames are
 * hosted upstream and a list can show hundreds.
 */

"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";
import type { ExerciseInfo } from "@/lib/data/model";

function initials(name: string): string {
  return name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

export function ExerciseThumb({
  exercise,
  size = 40,
  className,
}: {
  exercise: Pick<ExerciseInfo, "name" | "thumbnailUrl">;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };

  if (!exercise.thumbnailUrl || failed) {
    return (
      <div
        style={style}
        className={cn("flex shrink-0 items-center justify-center rounded-lg bg-surface-3 text-xs font-semibold text-fg-2", className)}
      >
        {initials(exercise.name) || "?"}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote catalog frames, hundreds per list
    <img
      src={exercise.thumbnailUrl}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={style}
      className={cn("shrink-0 rounded-lg bg-white object-cover", className)}
    />
  );
}
