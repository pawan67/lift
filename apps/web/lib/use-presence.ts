"use client";

import { useEffect, useState } from "react";

/**
 * Keeps an element mounted long enough to play its exit transition.
 *
 * `mounted` turns true as soon as `open` does, so the entry transition can run
 * from `@starting-style`. When `open` turns false, `closing` turns true for
 * `exitMs` (the element sets `data-closing` and transitions out), then the
 * element unmounts. Reopening during the exit cancels it and the transition
 * reverses from wherever it had got to.
 */
export function usePresence(open: boolean, exitMs = 200): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mounting follows `open` immediately
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, exitMs]);

  return { mounted: mounted || open, closing: mounted && !open };
}
