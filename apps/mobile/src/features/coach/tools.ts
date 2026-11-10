/**
 * Answering the coach's lookups from the database on this phone.
 *
 * Every answer is text, and every figure in it carries its unit, for the same
 * reason the review document is built that way: a model reading "80 x 8" has
 * to guess which unit and is right about half the time. Where the document
 * already has a formatter for a thing (a session, a set, a routine, a record),
 * the answer uses it, so the same set reads the same way at the top of a
 * thread and in a lookup twenty turns down.
 *
 * Nothing here writes. A lookup that fails says why in words the model can act
 * on ("no exercise called that, try find_exercises") rather than throwing,
 * because both providers require every call to be answered and a thrown error
 * would end the whole reply.
 */

import {
  describeCoachExercise,
  describeCoachRecord,
  describeCoachRoutine,
  describeCoachSession,
  formatDurationShort,
  formatVolume,
  formatWeight,
  landmarksFor,
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUPS,
  VOLUME_ZONE_LABELS,
  volumeZone,
  type AiToolCall,
  type AiToolResult,
  type CoachToolName,
  type CoachUnits,
} from '@lift/shared';
import { and, desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { exercises, workoutExercises, workouts } from '@/db/schema';
import { getMuscleBoard } from '@/features/analytics/muscle-stats';
import { getExerciseProgress } from '@/features/analytics/repository';
import { addDays, startOfDay } from '@/features/analytics/windows';
import { useSettings } from '@/store/settings';

import { resolveExercise, searchExercises } from './exercise-lookup';
import { foodDay, foodSummary } from './food-tools';
import { loadCoachRecords, loadCoachRoutines, loadCoachSessions } from './report';

/**
 * The most a single answer may carry.
 *
 * A whole year of one lift is a few thousand characters; every routine at once
 * can be more. Past this the answer is cut with a note saying so, because a
 * lookup that silently returns half its rows reads as "that is all there is".
 */
const MAX_RESULT_CHARS = 12_000;

/** Far enough in the future that "until now" never excludes a session. */
const END_OF_TIME = new Date(8.64e15);

export async function runCoachTool(call: AiToolCall): Promise<AiToolResult> {
  const answer = (content: string, isError = false): AiToolResult => ({
    callId: call.id,
    name: call.name,
    content: clip(content),
    ...(isError ? { isError: true } : {}),
  });

  try {
    const units = currentUnits();
    switch (call.name as CoachToolName) {
      case 'exercise_history':
        return answer(...(await exerciseHistory(call.input, units)));
      case 'find_exercises':
        return answer(...(await findExercises(call.input)));
      case 'recent_workouts':
        return answer(await recentWorkouts(call.input, units));
      case 'workout_detail':
        return answer(...(await workoutDetail(call.input, units)));
      case 'personal_records':
        return answer(...(await personalRecords(call.input, units)));
      case 'muscle_volume':
        return answer(await muscleVolume(call.input));
      case 'routines':
        return answer(await routineList(units));
      case 'food_summary':
        return answer(...(await foodSummary(call.input)));
      case 'food_day':
        return answer(...(await foodDay(call.input)));
      default:
        return answer(`There is no lookup called ${call.name}.`, true);
    }
  } catch (cause) {
    return answer(
      `The lookup failed: ${cause instanceof Error ? cause.message : 'no reason given'}.`,
      true,
    );
  }
}

// ---------------------------------------------------------------------------
// The lookups
// ---------------------------------------------------------------------------

async function exerciseHistory(
  input: Record<string, unknown>,
  units: CoachUnits,
): Promise<[string, boolean?]> {
  const name = text(input.exercise);
  if (!name) return ['Say which exercise.', true];

  const exercise = await resolveExercise(name);
  if (!exercise) return [`No exercise matches "${name}". Call find_exercises to get its exact name.`, true];

  const wanted = int(input.sessions, 1, 30) ?? 10;

  const appearances = await db
    .selectDistinct({ workoutId: workouts.id, startedAt: workouts.startedAt })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(
      and(
        eq(workoutExercises.exerciseId, exercise.id),
        isNull(workoutExercises.deletedAt),
        isNull(workouts.deletedAt),
        isNotNull(workouts.finishedAt),
      ),
    )
    .orderBy(desc(workouts.startedAt));

  if (appearances.length === 0) {
    return [`${exercise.name} has never been logged in a finished workout.`];
  }

  const recent = appearances.slice(0, wanted).map((row) => row.workoutId);
  const settings = useSettings.getState();
  const [sessions, progress] = await Promise.all([
    loadCoachSessions(null, END_OF_TIME, recent),
    getExerciseProgress(exercise.id, {
      bodyweightKg: settings.bodyweightKg ?? undefined,
      formula: settings.oneRepMaxFormula,
    }),
  ]);

  const maxByTime = new Map(progress.map((point) => [point.performedAt, point.estimatedOneRepMaxKg]));
  const best = progress.reduce<{ kg: number; at: number } | null>(
    (top, point) =>
      point.estimatedOneRepMaxKg > (top?.kg ?? 0) ? { kg: point.estimatedOneRepMaxKg, at: point.performedAt } : top,
    null,
  );

  const lines = [
    `${exercise.name}: logged in ${appearances.length} finished workout${
      appearances.length === 1 ? '' : 's'
    }. The ${sessions.length} most recent, oldest first.`,
  ];
  if (best && best.kg > 0) {
    lines.push(`All-time best estimated one-rep max: ${formatWeight(best.kg, units.weightUnit)} on ${day(best.at)}.`);
  }

  for (const session of sessions) {
    const block = session.exercises.filter((entry) => entry.name === exercise.name);
    if (block.length === 0) continue;

    const estimate = maxByTime.get(session.startedAt);
    lines.push(
      '',
      `### ${day(session.startedAt)} · ${session.name}${
        estimate ? ` · best estimated max ${formatWeight(estimate, units.weightUnit)}` : ''
      }`,
      ...block.map((entry) => describeCoachExercise(entry, units)),
    );
  }

  return [lines.join('\n')];
}

async function findExercises(input: Record<string, unknown>): Promise<[string, boolean?]> {
  const query = text(input.query);
  if (!query) return ['Say what to search for.', true];

  const hits = await searchExercises(query);
  if (hits.length === 0) return [`Nothing in the library matches "${query}". Try fewer or plainer words.`];

  return [
    hits
      .map(({ row, usage }) => {
        const trained = usage
          ? `trained in ${usage.uses} workout${usage.uses === 1 ? '' : 's'}, last ${day(usage.lastUsedAt)}`
          : 'never trained';
        return `- ${row.name} (${row.equipment}, ${MUSCLE_GROUP_LABELS[row.primaryMuscle]}): ${trained}`;
      })
      .join('\n'),
  ];
}

async function recentWorkouts(input: Record<string, unknown>, units: CoachUnits): Promise<string> {
  const days = int(input.days, 1, 365) ?? 30;
  const from = addDays(startOfDay(new Date()), 1 - days);

  const rows = await db
    .select({
      id: workouts.id,
      name: workouts.name,
      startedAt: workouts.startedAt,
      durationSeconds: workouts.durationSeconds,
      totalSets: workouts.totalSets,
      totalVolumeKg: workouts.totalVolumeKg,
      prCount: workouts.prCount,
    })
    .from(workouts)
    .where(and(isNotNull(workouts.finishedAt), isNull(workouts.deletedAt), gte(workouts.startedAt, from)))
    .orderBy(desc(workouts.startedAt));

  if (rows.length === 0) return `No finished workouts in the last ${days} days.`;

  const names = await db
    .select({ workoutId: workoutExercises.workoutId, name: exercises.name })
    .from(workoutExercises)
    .innerJoin(exercises, eq(workoutExercises.exerciseId, exercises.id))
    .where(
      and(
        inArray(
          workoutExercises.workoutId,
          rows.map((row) => row.id),
        ),
        isNull(workoutExercises.deletedAt),
      ),
    )
    .orderBy(workoutExercises.position);

  const byWorkout = new Map<string, string[]>();
  for (const row of names) {
    const list = byWorkout.get(row.workoutId) ?? [];
    list.push(row.name);
    byWorkout.set(row.workoutId, list);
  }

  return [
    `${rows.length} finished workout${rows.length === 1 ? '' : 's'} in the last ${days} days, newest first.`,
    ...rows.map((row) => {
      const facts = [
        day(row.startedAt.getTime()),
        row.name,
        row.durationSeconds ? formatDurationShort(row.durationSeconds) : null,
        `${row.totalSets} working sets`,
        formatVolume(row.totalVolumeKg, units.weightUnit),
        row.prCount > 0 ? `${row.prCount} PR${row.prCount === 1 ? '' : 's'}` : null,
      ].filter((part): part is string => part !== null);
      return `- id ${row.id}: ${facts.join(' · ')}. ${(byWorkout.get(row.id) ?? []).join(', ')}`;
    }),
  ].join('\n');
}

async function workoutDetail(input: Record<string, unknown>, units: CoachUnits): Promise<[string, boolean?]> {
  const id = text(input.workout_id);
  if (!id) return ['Give a workout id from recent_workouts.', true];

  const [session] = await loadCoachSessions(null, END_OF_TIME, [id]);
  if (!session) return [`No finished workout has the id ${id}. Call recent_workouts for current ids.`, true];

  return [describeCoachSession(session, units)];
}

async function personalRecords(input: Record<string, unknown>, units: CoachUnits): Promise<[string, boolean?]> {
  const name = text(input.exercise);
  let ids: string[] | null = null;

  if (name) {
    const exercise = await resolveExercise(name);
    if (!exercise) return [`No exercise matches "${name}". Call find_exercises to get its exact name.`, true];
    ids = [exercise.id];
  }

  const records = await loadCoachRecords(ids);
  if (records.length === 0) return [name ? `No records for ${name} yet.` : 'No records yet.'];

  return [records.map((record) => `- ${describeCoachRecord(record, units)}`).join('\n')];
}

async function muscleVolume(input: Record<string, unknown>): Promise<string> {
  const weeks = int(input.weeks, 1, 12) ?? 4;
  const to = addDays(startOfDay(new Date()), 1);
  const from = addDays(to, -weeks * 7);

  const board = await getMuscleBoard(from, to);
  const level = useSettings.getState().trainingLevel;

  const lines = [
    `Working sets per week over the last ${weeks} week${weeks === 1 ? '' : 's'} (${board.workouts} workouts). A set counts whole for the target muscle and half for each assisting one. MEV is where growth starts, MAV the top of the fastest-growing band, MRV the most that recovers.`,
  ];

  for (const muscle of MUSCLE_GROUPS) {
    const landmarks = landmarksFor(muscle, level);
    if (landmarks.mrv <= 0) continue;

    const sets = board.setsPerWeek[muscle] ?? 0;
    lines.push(
      `- ${MUSCLE_GROUP_LABELS[muscle]}: ${oneDecimal(sets)} sets/week (MEV ${landmarks.mev}, MAV ${
        landmarks.mav
      }, MRV ${landmarks.mrv}): ${VOLUME_ZONE_LABELS[volumeZone(sets, landmarks)]}`,
    );
  }

  return lines.join('\n');
}

async function routineList(units: CoachUnits): Promise<string> {
  const routines = await loadCoachRoutines();
  if (routines.length === 0) return 'No routines saved.';
  return routines.map((routine) => describeCoachRoutine(routine, units)).join('\n\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentUnits(): CoachUnits {
  const settings = useSettings.getState();
  return {
    weightUnit: settings.weightUnit,
    distanceUnit: settings.distanceUnit,
    measurementUnit: settings.measurementUnit,
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function int(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** A local calendar date, which is what a lifter means by "the 3rd". */
function day(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function clip(content: string): string {
  if (content.length <= MAX_RESULT_CHARS) return content;
  return `${content.slice(0, MAX_RESULT_CHARS)}\n\n[Cut here for length. Ask for fewer sessions or a shorter window to see the rest.]`;
}
