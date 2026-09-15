/**
 * Which routine to train next, read out of the log rather than out of a plan.
 *
 * The app has no notion of a programme: nothing anywhere says "this is a
 * push/pull/legs split and today is pull". But the log knows anyway, because a
 * split is a habit and a habit is a pattern in the order sessions were
 * performed in. If Pull has followed Push the last four times Push was trained,
 * the routine to open now is Pull, and the app can say so without ever being
 * told what a split is.
 *
 * Two readings, in order of how much they know:
 *
 * - **Rotation**: of the sessions that came after the one just performed, which
 *   routine came next most often. This is the answer worth giving, because it
 *   is the user's own order played back to them.
 * - **Rest**: the routine left alone longest. The fallback, for a log with no
 *   repeated order in it yet, and the tie-break inside the first reading.
 *
 * A suggestion is advisory and the app is a tracker, so every rule here is
 * biased towards saying nothing. Silence costs a hint; a confident wrong answer
 * costs trust in every other number on the screen.
 */

/** A routine as this reads it: enough to rank it and to name it back. */
export interface RotationRoutine {
  id: string;
  name: string;
  lastPerformedAt: number | null;
}

/** One performed session. `routineId` is null for an ad-hoc workout. */
export interface RotationSession {
  routineId: string | null;
  startedAt: number;
}

/**
 * The suggestion, with what it was read from.
 *
 * A union rather than a reason string, because the copy belongs to the screen
 * showing it and the two cases carry different facts: the rotation case names
 * the routine it follows, the rest case carries an instant to age.
 */
export type RoutineSuggestion =
  | { routineId: string; basis: 'rotation'; after: string }
  | { routineId: string; basis: 'rest'; lastPerformedAt: number };

export interface RotationInput {
  routines: readonly RotationRoutine[];
  /** Performed sessions, in any order. Only the finished ones belong here. */
  sessions: readonly RotationSession[];
  now: number;
}

/**
 * How far back the rotation is read.
 *
 * A split gets replaced, and the sessions from the one before it are evidence
 * for an order the user has already abandoned. Twenty is several cycles of any
 * split anybody runs, and short enough that a change of programme washes out of
 * it within a month.
 */
const HISTORY_LIMIT = 20;

/** Below two, "what follows what" is a coincidence rather than a rotation. */
const MIN_OBSERVATIONS = 2;

/**
 * Nothing trained this recently is suggested back.
 *
 * Both readings can land on a routine that was performed a few hours ago: the
 * rest reading when it is the only one with any history, the rotation reading
 * when a session was logged out of order. Suggesting it is the one failure that
 * makes the whole hint look broken, because the user knows perfectly well what
 * they trained this morning.
 */
const JUST_TRAINED_MS = 12 * 3_600_000;

export function suggestNextRoutine({
  routines,
  sessions,
  now,
}: RotationInput): RoutineSuggestion | null {
  // With one routine there is no choice to suggest, and the list already shows
  // it. This is also every brand-new account, which is the case where an
  // opinion is least earned.
  if (routines.length < 2) return null;

  const byId = new Map(routines.map((routine) => [routine.id, routine]));

  const eligible = (id: string): RotationRoutine | null => {
    const routine = byId.get(id);
    if (!routine) return null;
    if (routine.lastPerformedAt !== null && now - routine.lastPerformedAt < JUST_TRAINED_MS) {
      return null;
    }
    return routine;
  };

  /*
   * Oldest first, and only the sessions a routine was behind. An ad-hoc workout
   * says nothing about which routine follows which, and dropping it rather than
   * breaking the chain on it is deliberate: a one-off session squeezed into a
   * split does not stop Pull from being what follows Push.
   */
  const performed = [...sessions]
    .filter((session) => session.routineId !== null && byId.has(session.routineId))
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-HISTORY_LIMIT)
    .map((session) => session.routineId as string);

  const last = performed[performed.length - 1];

  if (last !== undefined) {
    const followers = new Map<string, number>();
    for (let i = 0; i < performed.length - 1; i += 1) {
      if (performed[i] !== last) continue;
      const next = performed[i + 1]!;
      followers.set(next, (followers.get(next) ?? 0) + 1);
    }

    let best: RotationRoutine | null = null;
    let bestCount = 0;

    for (const [id, count] of followers) {
      if (count < MIN_OBSERVATIONS || count < bestCount) continue;

      const routine = eligible(id);
      if (!routine) continue;

      // A tie goes to the one rested longest, which is the second reading
      // applied inside the first rather than a coin toss. Never-performed sorts
      // ahead of everything, because no rest is the longest rest there is.
      if (best && count === bestCount && rested(routine) >= rested(best)) continue;

      best = routine;
      bestCount = count;
    }

    if (best) return { routineId: best.id, basis: 'rotation', after: byId.get(last)!.name };
  }

  /*
   * The fallback is restricted to routines with history, where the rotation
   * reading above is not. "You have not tried this one" is a fact about the
   * routine list, not something read out of previous workouts, and offering it
   * here would make a hint that is supposed to reflect training into a nag
   * about every routine ever created and abandoned.
   */
  const rest = routines
    .filter((routine) => routine.lastPerformedAt !== null && eligible(routine.id))
    .sort((a, b) => a.lastPerformedAt! - b.lastPerformedAt!)[0];

  if (!rest) return null;

  return { routineId: rest.id, basis: 'rest', lastPerformedAt: rest.lastPerformedAt! };
}

/** Sort key for "rested longest": never performed outranks any date. */
function rested(routine: RotationRoutine): number {
  return routine.lastPerformedAt ?? -Infinity;
}
