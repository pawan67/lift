/**
 * An exercise's still frame, or its initials when the catalog has none (custom
 * exercises, ~6% of the catalog). Plain `<img>`, lazily loaded: the frames are
 * hosted upstream and a list can show hundreds.
 *
 * The frame sits on a dark placeholder and fades in once it has decoded, so a
 * list scrolled fast shows quiet dark squares, not white ones. Frames already
 * seen this session skip the fade: the virtualised lists remount rows on every
 * scroll, and a cached image flickering in again reads as a glitch.
 */

"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";
import type { ExerciseInfo } from "@/lib/data/model";

const seen = new Set<string>();

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
  const box = cn("relative shrink-0 overflow-hidden rounded-lg bg-surface-3", className);

  if (!exercise.thumbnailUrl || failed) {
    return (
      <div style={style} className={cn(box, "flex items-center justify-center text-xs font-semibold text-fg-3")}>
        {initials(exercise.name) || "?"}
      </div>
    );
  }

  return (
    <div style={style} className={box}>
      <Frame key={exercise.thumbnailUrl} src={exercise.thumbnailUrl} onError={() => setFailed(true)} />
    </div>
  );
}

function Frame({ src, onError }: { src: string; onError: () => void }) {
  const [cached] = useState(() => seen.has(src));
  const [loaded, setLoaded] = useState(cached);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote catalog frames, hundreds per list
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      ref={(node) => {
        // A frame the browser already has can finish before React attaches onLoad.
        if (node?.complete && node.naturalWidth > 0 && !loaded) {
          seen.add(src);
          setLoaded(true);
        }
      }}
      onLoad={() => {
        seen.add(src);
        setLoaded(true);
      }}
      onError={onError}
      className={cn(
        "absolute inset-0 h-full w-full bg-white object-cover",
        loaded ? "opacity-100" : "opacity-0",
        !cached && "transition-opacity duration-200 ease-out",
      )}
    />
  );
}
