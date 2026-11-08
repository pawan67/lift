/**
 * Sessions by calendar day, for the calendar, the contribution graph and the
 * day strip. Ported from the phone's `features/analytics/calendar.ts` and
 * `day-shading.ts`, minus the database: the model already holds every session.
 */

import type { Session } from "@/lib/data/model";

export interface CalendarDay {
  key: string;
  date: Date;
  sessions: Session[];
  volumeKg: number;
  durationSeconds: number;
  sets: number;
  prCount: number;
}

export interface DayIndex {
  days: Map<string, CalendarDay>;
  /** Median volume of a trained day. Shading is relative to this, not to the month on screen. */
  typicalVolumeKg: number;
  first: Date | null;
}

/** Local-time "YYYY-MM-DD". */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function buildDayIndex(sessions: readonly Session[]): DayIndex {
  const days = new Map<string, CalendarDay>();
  let first: Date | null = null;

  for (const session of sessions) {
    const start = new Date(session.startedAt);
    const key = dayKey(start);
    let day = days.get(key);
    if (!day) {
      day = { key, date: startOfDay(start), sessions: [], volumeKg: 0, durationSeconds: 0, sets: 0, prCount: 0 };
      days.set(key, day);
    }
    day.sessions.push(session);
    day.volumeKg += session.volumeKg;
    day.durationSeconds += session.durationSeconds;
    day.sets += session.workingSets;
    day.prCount += session.records.length;
    if (!first || day.date < first) first = day.date;
  }

  // Sessions arrive newest first; a day reads in the order it was trained.
  for (const day of days.values()) day.sessions.sort((a, b) => a.startedAt - b.startedAt);

  const volumes = [...days.values()].map((day) => day.volumeKg).filter((volume) => volume > 0);
  return { days, typicalVolumeKg: median(volumes), first };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/**
 * Which of four shades a day gets, against the typical trained day. Steps
 * rather than a gradient: 8,000 kg and 8,400 kg are the same day, and a visible
 * difference between them would invite a comparison that means nothing.
 */
export function intensityStep(volumeKg: number, typicalVolumeKg: number): number {
  if (volumeKg <= 0 || typicalVolumeKg <= 0) return 0;
  const ratio = volumeKg / typicalVolumeKg;
  if (ratio < 0.6) return 0;
  if (ratio < 1) return 1;
  if (ratio < 1.5) return 2;
  return 3;
}

/** Volt at rising strength. The first step still has to read as trained. */
export const DAY_SHADES = ["rgba(210, 243, 75, 0.28)", "rgba(210, 243, 75, 0.5)", "rgba(210, 243, 75, 0.74)", "#d2f34b"];

/** Text on each shade: the top two are light enough to need dark figures. */
export const DAY_SHADE_TEXT = ["#f5f5f7", "#f5f5f7", "#12180a", "#12180a"];

export function monthCells(monthStart: Date, firstDayOfWeek: 0 | 1): (Date | null)[] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const lead = (new Date(year, month, 1).getDay() - firstDayOfWeek + 7) % 7;
  const length = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let day = 1; day <= length; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function weekdayHeadings(firstDayOfWeek: 0 | 1): { narrow: string; short: string }[] {
  return Array.from({ length: 7 }, (_, index) => {
    // 4 Jan 1970 was a Sunday.
    const date = new Date(1970, 0, 4 + ((firstDayOfWeek + index) % 7));
    return {
      narrow: date.toLocaleDateString(undefined, { weekday: "narrow" }),
      short: date.toLocaleDateString(undefined, { weekday: "short" }),
    };
  });
}

/** `weeks` columns of seven days, the last column holding today. */
export function contributionColumns(today: Date, weeks: number, firstDayOfWeek: 0 | 1): Date[][] {
  const start = startOfDay(today);
  const offsetIntoWeek = (start.getDay() - firstDayOfWeek + 7) % 7;
  const gridEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (6 - offsetIntoWeek));
  const totalDays = weeks * 7;

  const columns: Date[][] = [];
  for (let week = 0; week < weeks; week++) {
    const column: Date[] = [];
    for (let day = 0; day < 7; day++) {
      const daysBeforeEnd = totalDays - 1 - (week * 7 + day);
      column.push(new Date(gridEnd.getFullYear(), gridEnd.getMonth(), gridEnd.getDate() - daysBeforeEnd));
    }
    columns.push(column);
  }
  return columns;
}

export interface MonthSummary {
  sessions: number;
  volumeKg: number;
  durationSeconds: number;
  sets: number;
  prCount: number;
  activeDays: number;
  daysInMonth: number;
}

export function summariseMonth(days: Map<string, CalendarDay>, monthStart: Date): MonthSummary {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const summary: MonthSummary = { sessions: 0, volumeKg: 0, durationSeconds: 0, sets: 0, prCount: 0, activeDays: 0, daysInMonth };

  for (let day = 1; day <= daysInMonth; day++) {
    const entry = days.get(dayKey(new Date(year, month, day)));
    if (!entry) continue;
    summary.activeDays += 1;
    summary.sessions += entry.sessions.length;
    summary.volumeKg += entry.volumeKg;
    summary.durationSeconds += entry.durationSeconds;
    summary.sets += entry.sets;
    summary.prCount += entry.prCount;
  }
  return summary;
}
