/**
 * The line under a routine's name: when it was last trained.
 *
 * This used to be the date alone, "12 Sep 2026 · 6:30 pm", which is the one
 * thing about a routine the user cannot act on without doing arithmetic first.
 * Standing in the gym choosing what to open, the question is "how long has it
 * been", so the gap leads and the stamp follows it.
 *
 * The stamp changes shape at a day, because below one the date is a thing
 * everybody already knows. "5 hours ago · 7:30 am" says which session it was;
 * "5 hours ago · Mon, 15 Sep" says it twice and then says today's date.
 *
 * One line, which is all `ListRow` gives a subtitle: on a routine row the Start
 * button is taking the right-hand third of it, so anything longer than this
 * truncates on a narrow phone.
 */

import { DATE_SHORT, describeElapsed, formatTimeOfDay } from '@lift/shared';

const DAY_MS = 86_400_000;

export function describeLastPerformed(at: Date | null, now: number): string {
  if (!at) return 'Not performed yet';

  const stamp =
    now - at.getTime() < DAY_MS
      ? formatTimeOfDay(at)
      : at.toLocaleDateString(undefined, DATE_SHORT);

  return `${describeElapsed(at.getTime(), now)} · ${stamp}`;
}
