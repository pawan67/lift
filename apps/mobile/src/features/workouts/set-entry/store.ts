/**
 * Which set the docked entry panel is pointed at, and the scrub bubble.
 *
 * The panel lives once per screen (`SetEntryHost`) while the numbers live in
 * the rows, so the row being edited publishes everything the panel needs into
 * this store and keeps it fresh on every render. The panel never reads the
 * database itself: the row already has the set, its previous session, its
 * units and the callbacks that write and log it, and a second source for any
 * of those is a second answer to disagree with.
 */

import type { WeightUnit } from '@lift/shared';
import { create } from 'zustand';

import type { EntryField } from './values';

export interface EntryTarget {
  setId: string;
  /** The exercise-in-session the set belongs to. */
  groupId: string;
  field: EntryField;
  /** "Set 2", "Warm-up". */
  setName: string;
  hasWeight: boolean;
  hasReps: boolean;
  weightUnit: WeightUnit;
  /** What the set holds, in the display unit. Null when the box is empty. */
  weight: number | null;
  reps: number | null;
  /** Last session's numbers, which an empty box shows and logs. */
  ghostWeight: number | null;
  ghostReps: number | null;
  isCompleted: boolean;
  /** Writes display-unit numbers back to the set. */
  commit: (patch: { weight?: number; reps?: number }) => void;
  /** The row's own check-off, so its plate animates exactly as a tap would. */
  log: () => void;
  /** Swaps the cell for a focused text field. */
  type: (field: EntryField) => void;
  /** The row's frame in window coordinates. */
  measure: (done: (y: number, height: number) => void) => void;
}

export interface ScrubBubble {
  /** Centre-x and top of the cell being scrubbed, in window coordinates. */
  x: number;
  y: number;
  text: string;
  detail: string;
}

/** The set just logged from the panel, which the next set in its exercise starts from. */
export interface Carry {
  groupId: string;
  weight: number;
  reps: number;
}

/** The scrub in progress. One at a time: there is one finger on the table. */
export interface ScrubSession {
  /** Which field instance owns it. */
  key: string;
  start: number;
  value: number;
}

interface SetEntryStore {
  target: EntryTarget | null;
  /**
   * A set was just logged from the panel and the panel is waiting for the
   * next open set to claim it. That row is the one `nextOpenSet` outlines, and
   * it only knows it is next once the write has echoed back.
   */
  advancing: boolean;
  carry: Carry | null;
  dockHeight: number;
  bubble: ScrubBubble | null;
  scrub: ScrubSession | null;
  /** Registered by the screen that owns the scroll view. */
  scrollBy: ((dy: number) => void) | null;

  /** A tap on a cell: starts fresh. */
  open: (target: EntryTarget) => void;
  /** The next open set taking the panel after a log: keeps the carry. */
  claim: (target: EntryTarget) => void;
  /** Refreshes the live target. Ignored unless it is still the same set. */
  refresh: (target: EntryTarget) => void;
  setField: (field: EntryField) => void;
  close: () => void;
  beginAdvance: (carry: Carry) => void;
  setDockHeight: (height: number) => void;
  setBubble: (bubble: ScrubBubble | null) => void;
  setScrub: (scrub: ScrubSession | null) => void;
  setScroller: (scrollBy: ((dy: number) => void) | null) => void;
}

let advanceTimer: ReturnType<typeof setTimeout> | undefined;

export const useSetEntry = create<SetEntryStore>((set, get) => ({
  target: null,
  advancing: false,
  carry: null,
  dockHeight: 0,
  bubble: null,
  scrub: null,
  scrollBy: null,

  open: (target) => {
    clearTimeout(advanceTimer);
    set({ target, advancing: false, carry: null });
  },
  claim: (target) => {
    clearTimeout(advanceTimer);
    set({ target, advancing: false });
  },
  refresh: (target) => {
    const current = get().target;
    if (!current || current.setId !== target.setId) return;
    set({ target: { ...target, field: current.field } });
  },
  setField: (field) => {
    const current = get().target;
    if (current && current.field !== field) set({ target: { ...current, field } });
  },
  close: () => {
    clearTimeout(advanceTimer);
    set({ target: null, advancing: false, carry: null });
  },
  beginAdvance: (carry) => {
    set({ advancing: true, carry });
    // Nothing left to claim it: the last set of the session was just logged.
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => {
      if (get().advancing) get().close();
    }, 1200);
  },
  setDockHeight: (dockHeight) => {
    if (get().dockHeight !== dockHeight) set({ dockHeight });
  },
  setBubble: (bubble) => set({ bubble }),
  setScrub: (scrub) => set({ scrub }),
  setScroller: (scrollBy) => set({ scrollBy }),
}));
