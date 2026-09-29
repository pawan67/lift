/**
 * The wiring between one exercise on the logging screen and the two engines
 * that have an opinion about it, both of which are deliberately ignorant of
 * both.
 *
 * `suggestProgression` and `autoregulateRemaining` are pure, unit-agnostic and
 * take fully resolved config: a rep range, a load step, a tracking type, a
 * target effort. Neither knows what a barbell is, that this session was started
 * from a routine, or that anything on the other side of it is stored in SQLite.
 * Somebody has to answer those questions before either can be called, and this
 * is that somebody: the whole of the app's policy about progression lives in
 * the forty lines below, where it can be read at once, rather than being spread
 * through the engines or restated by every screen that wants a suggestion.
 *
 * What it emphatically does not do is *write* anything. A suggestion is a
 * proposal about a set that has not happened yet; it reaches a row only when
 * the user taps the line that states it (`ExerciseBlock`). Nothing here touches
 * the Previous column, the field placeholders or `ghostFill`, which between
 * them decide what a bare check-off commits. Those are a record of what was
 * lifted, and a proposal quietly filed among them would be a lift that never
 * happened. See the header of `previous.ts`.
 */

import {
  autoregulateRemaining,
  defaultIncrementKg,
  inferRepRange,
  suggestProgression,
  type ExerciseSession,
  type Suggestion,
} from '@lift/shared';

import type { WorkoutExerciseDetail } from './repository';

export interface ProgressionInput {
  /**
   * This exercise's last few sessions, newest first: `PreviousPerformance.sessions`.
   *
   * May be empty, and an empty list is no longer the end of the matter. It used
   * to be: with no history there was nothing for double progression to read.
   * Mid-session autoregulation reads the session you are in, so an exercise
   * being performed for the first time still has something to say the moment a
   * set in it is rated.
   */
  sessions: readonly ExerciseSession[];
  /**
   * The reps this session's routine prescribes for the exercise, when it was
   * started from one and the routine says.
   *
   * A prescription outranks anything inferred from history: a routine asking
   * for sets of five is not asking to be walked up to twelve because the last
   * three sessions happened to be a back-off block. Absent, the range comes
   * from what the user has actually been doing.
   */
  targetReps?: number | null;
  /**
   * The effort the user trains their working sets to, from Settings, on the
   * 1-10 RPE scale. Both engines measure a rating against it.
   */
  targetRpe?: number | null;
  /**
   * Bodyweight, for the tracking types whose real load is a function of it.
   * Only the mid-session engine reads it, and only to keep a weighted pull-up
   * from being read as a 10 kg exercise.
   */
  bodyweightKg?: number | null;
}

/**
 * What to put in front of this exercise next, or nothing.
 *
 * Null covers every reason there is nothing to say: no history and no rated set
 * yet, a tracking type the engines have no opinion about, or both of them
 * declining to move, and they are deliberately one answer rather than several,
 * because the screen does the same thing with all of them: renders no line.
 */
export function suggestForExercise(
  detail: WorkoutExerciseDetail,
  { sessions, targetReps, targetRpe, bodyweightKg }: ProgressionInput,
): Suggestion | null {
  /*
   * The engines run inside a render, so a throw from either takes the logging
   * screen down mid-session rather than degrading a hint.
   *
   * That guard is not there for a transitional reason. It is there because this
   * is the one opinionated corner of an app whose whole job is to still be
   * holding your sets when something goes wrong, and a bad rounding on an
   * exercise with one strange session in its history is not worth the screen. A
   * suggestion that cannot be computed is a suggestion that is not offered.
   */
  try {
    // A prescription is a single number, and it becomes a band of one: clear it
    // on every set and the load goes up, which is what a routine that says "3×5"
    // means. `inferRepRange` is the fallback and reads the real range back out
    // of what was performed.
    const range =
      targetReps != null && targetReps > 0
        ? { minReps: targetReps, maxReps: targetReps }
        : inferRepRange(sessions);

    // The smallest step this equipment has. A default about equipment, not a
    // claim about the user's gym, and the number stays theirs to overwrite by
    // typing, because a suggestion only ever lands in a field they tap it into.
    const incrementKg = defaultIncrementKg(detail.exercise.equipment);

    /*
     * The set that just ended outranks the month behind it.
     *
     * Not a tie-break between two equals. They are answering different
     * questions and only one of them is about the sets still open: double
     * progression is reasoning about next Tuesday from four weeks of history,
     * and mid-session autoregulation is reasoning about the next four minutes
     * from a set performed under today's sleep, today's food and today's
     * warm-up. When there is a rating from four minutes ago, deferring to the
     * history would be preferring the average of a lifter to the lifter.
     *
     * It also says nothing far more often than it says something: it wants a
     * rated set, an open set after it, and a disagreement between the rating
     * and the target big enough to change a number the equipment can make. All
     * three fail on most exercises most of the time, and the line then falls
     * back to what it has always shown.
     */
    const live = autoregulateRemaining(detail.sets, {
      trackingType: detail.exercise.trackingType,
      ...range,
      incrementKg,
      targetRpe: targetRpe ?? undefined,
      bodyweightKg,
    });
    if (live) return live;

    // Nothing rated yet, so the question is the one about next time, and it
    // needs a last time to answer from.
    if (sessions.length === 0) return null;

    return suggestProgression(sessions, {
      trackingType: detail.exercise.trackingType,
      ...range,
      incrementKg,
      targetRpe: targetRpe ?? undefined,
    });
  } catch {
    return null;
  }
}
