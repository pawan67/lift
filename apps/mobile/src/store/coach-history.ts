/**
 * Hand-off between the coach's chat history panel and the chat under it.
 *
 * The panel is its own route, drawn over the chat, so it can cover the header
 * the way a drawer does and scroll natively. Picking a chat there has to reach
 * the chat screen that is still mounted underneath, and a route param cannot
 * do that reliably (see the note in `exercise-picker.ts` on `setParams` racing
 * `back()`). So the panel posts here and the chat, subscribed for as long as
 * it is mounted, acts on it.
 */

import { create } from 'zustand';

export type CoachHistoryEvent =
  /** Open a stored conversation in place. */
  | { kind: 'open'; threadId: string }
  /** A blank conversation. */
  | { kind: 'new' }
  /** These conversations are gone. If the chat is showing one, it starts over. */
  | { kind: 'deleted'; threadIds: string[] };

interface CoachHistoryState {
  /** The latest event, with a counter so the same event twice is still two. */
  last: { event: CoachHistoryEvent; seq: number } | null;
  post: (event: CoachHistoryEvent) => void;
}

export const useCoachHistory = create<CoachHistoryState>((set) => ({
  last: null,
  post: (event) => set((state) => ({ last: { event, seq: (state.last?.seq ?? 0) + 1 } })),
}));
