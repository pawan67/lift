"use client";

import { useEffect, useState } from "react";

/**
 * The current time, read once on mount and refreshed every few minutes.
 *
 * Render must be pure, so "how long ago" labels and "not in the future" checks
 * read the clock through this instead of calling `Date.now()` inline. Minute
 * precision is all any of them need.
 */
export function useNow(refreshMs = 5 * 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs]);
  return now;
}
