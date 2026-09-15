/**
 * When something happened, printed the way the log reads it.
 *
 * A training log is a list of events, and the hour is part of the event: two
 * sessions on the same square of the calendar are told apart by it, "was that
 * the morning session or the evening one?" is answered by it, and a record set
 * at 6am reads differently from one set after work. The app used to print the
 * date alone nearly everywhere and the clock only inside the calendar's day
 * panel, so the one screen that showed the time was the one screen where the
 * date was already known.
 *
 * The shapes below are the date halves. They are constants rather than inline
 * literals so that "a row in a list" looks the same in the history list, on the
 * dashboard and in a monthly report, instead of each screen choosing its own
 * arrangement of weekday, month and year.
 */

/** The clock, in the device's own convention: "6:30 pm" here, "18:30" elsewhere. */
const TIME_OF_DAY: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

/** "Sat, 12 Apr": a row under a heading that already names the month. */
export const DATE_SHORT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
};

/** "12 Apr 2026". A date that has to stand on its own, outside any grouping. */
export const DATE_MEDIUM: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

/** "Saturday, 12 April 2026": the heading of a screen about one session. */
export const DATE_LONG: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

/** Just the clock: "6:30 pm". */
export function formatTimeOfDay(date: Date): string {
  return date.toLocaleTimeString(undefined, TIME_OF_DAY);
}

/**
 * A time of day with no date attached.
 *
 * Stored as `"HH:mm"` on a 24-hour clock, which is the one form that is
 * unambiguous, sorts as text, and does not carry a timezone the user never
 * chose. What the *user* sees is `formatClockTime`, which is the device's own
 * convention: the two are deliberately not the same string.
 */
export interface ClockTime {
  hour: number;
  minute: number;
}

/**
 * `"17:30"` to its parts, or `null` if it is not a time.
 *
 * Every field is range-checked rather than merely parsed. The one consumer that
 * matters is a daily notification trigger, and `expo-notifications` throws a
 * `RangeError` from inside `scheduleNotificationAsync` for an hour of 24 or a
 * minute of 60. A returned `null` is a value the caller can decline to use; an
 * exception raised three layers down inside a fire-and-forget call is not.
 */
export function parseClockTime(value: string): ClockTime | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute };
}

/** The parts back to `"HH:mm"`. Always two digits, so the strings sort. */
export function toClockTime({ hour, minute }: ClockTime): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * `"17:30"` as the device would write it: "5:30 pm" here, "17:30" elsewhere.
 *
 * Goes through the same `TIME_OF_DAY` shape as every other clock in the app, so
 * a reminder time in Settings and the time on a logged workout read alike.
 * Anchored to an arbitrary date because only the hour and minute are printed.
 *
 * Unparseable input is returned as it came. This formats a stored preference,
 * and a settings row showing a raw value is a better failure than one showing
 * "Invalid Date".
 */
export function formatClockTime(value: string): string {
  const time = parseClockTime(value);
  if (!time) return value;

  return formatTimeOfDay(new Date(2000, 0, 1, time.hour, time.minute));
}

/**
 * Whether the device writes 1 pm or 13:00.
 *
 * Needed by anything that has to *offer* hours rather than print them: a picker
 * showing 0–23 to someone whose phone says "5:30 pm" everywhere else is asking
 * them to convert. Formatting alone cannot answer it, because the answer has to
 * be known before the choices exist.
 *
 * Three attempts, narrowest first. `hourCycle` is the direct answer and is only
 * populated when `hour` is among the requested options, which is why it is
 * asked for. `hour12` is what older engines resolve instead. The printed-digit
 * fallback exists because Hermes' Intl is backed by the platform's own
 * formatter and neither field is guaranteed; it is last because a locale using
 * Arabic-Indic digits prints neither "13" nor "1" in ASCII, and would fall
 * through it to the wrong answer.
 */
export function prefersTwelveHourClock(): boolean {
  try {
    const resolved = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    if (resolved.hourCycle) return resolved.hourCycle === 'h11' || resolved.hourCycle === 'h12';
    if (typeof resolved.hour12 === 'boolean') return resolved.hour12;
  } catch {
    // Fall through to the printed form.
  }

  return !new Date(2000, 0, 1, 13, 0).toLocaleTimeString(undefined, { hour: 'numeric' }).includes('13');
}

/**
 * A date and the clock, joined by the app's separator: "Sat, 12 Apr · 6:30 pm".
 *
 * The date half is whatever shape the caller asks for; omitting it gives the
 * locale's own numeric date, which is what the compact list rows use.
 *
 * The middle dot is the same one every other secondary line in the app joins
 * its parts with, so a caption that already reads "date · duration · volume"
 * gains a segment rather than a second punctuation style.
 */
export function formatDateTime(date: Date, dateOptions?: Intl.DateTimeFormatOptions): string {
  return `${date.toLocaleDateString(undefined, dateOptions)} · ${formatTimeOfDay(date)}`;
}

// ---------------------------------------------------------------------------
// Elapsed time
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** "1 hour ago", "3 days ago": the count with its unit agreeing with it. */
function elapsedIn(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/**
 * How long ago something happened, in the coarsest unit that still answers the
 * question: "Just now", "40 min ago", "5 hours ago", "3 days ago".
 *
 * The unit is the point. A date tells you *when* a routine was last performed
 * and leaves the subtraction to the reader; standing in the gym deciding what
 * to train, the fact wanted is the gap, not the date, and below a day that gap
 * is measured in hours. "12 Sep" and "18 hours ago" are the same instant and
 * only one of them says "you already trained today".
 *
 * Measured in elapsed time rather than in calendar days, so it never claims
 * "1 day ago" for something two hours old that happened either side of
 * midnight. The tiers above a day match `describeRecency` in the app, so a
 * routine's recency and a measurement's read the same way.
 *
 * `now` is passed rather than read, because this runs inside render: a function
 * that reads the clock itself cannot be tested and cannot be held still for the
 * length of a list, where two rows stamped a millisecond apart should not end
 * up on different sides of a boundary.
 */
export function describeElapsed(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);

  if (elapsed < MINUTE_MS) return 'Just now';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return elapsedIn(Math.floor(elapsed / HOUR_MS), 'hour');

  const days = Math.floor(elapsed / DAY_MS);
  if (days < 14) return elapsedIn(days, 'day');
  if (days < 60) return elapsedIn(Math.round(days / 7), 'week');
  return elapsedIn(Math.round(days / 30), 'month');
}
