/** Read-side figures for routine cards and the editor's sidebar. */

import { isWorkingSet, MUSCLE_GROUP_LABELS, type MuscleGroup } from "@lift/shared";

import type { Model, RoutineView, SessionSet } from "@/lib/data/model";
import { relativeDay } from "@/lib/format";

/** Rest assumed between sets when an exercise has none of its own. */
const DEFAULT_REST_SECONDS = 90;
/** Time under the bar per set, roughly. */
const WORK_SECONDS = 40;

export interface RoutineFigures {
  exercises: number;
  sets: number;
  /** Rough session length in minutes, or null for an empty routine. */
  minutes: number | null;
}

export function routineFigures(routine: RoutineView): RoutineFigures {
  let sets = 0;
  let seconds = 0;

  routine.exercises.forEach((block, index) => {
    const count = block.sets.length;
    sets += count;
    // Inside a superset the rest comes once per round, after the last member.
    const next = routine.exercises[index + 1];
    const restsHere =
      block.row.supersetGroup !== null && next?.row.supersetGroup === block.row.supersetGroup ? 0 : count;
    seconds += count * WORK_SECONDS + restsHere * (block.row.restSeconds ?? DEFAULT_REST_SECONDS);
  });

  return {
    exercises: routine.exercises.length,
    sets,
    minutes: sets === 0 ? null : Math.max(5, Math.round(seconds / 60 / 5) * 5),
  };
}

/** Working sets per muscle: a full set for the primary, half for each secondary, as the phone counts. */
export function routineMuscles(routine: RoutineView): { muscle: MuscleGroup; label: string; sets: number }[] {
  const tally = new Map<MuscleGroup, number>();
  for (const block of routine.exercises) {
    if (!block.exercise) continue;
    const working = block.sets.filter((set) => isWorkingSet(set.setType)).length;
    if (working === 0) continue;
    tally.set(block.exercise.primaryMuscle, (tally.get(block.exercise.primaryMuscle) ?? 0) + working);
    for (const muscle of block.exercise.secondaryMuscles) {
      if (muscle === block.exercise.primaryMuscle) continue;
      tally.set(muscle, (tally.get(muscle) ?? 0) + working * 0.5);
    }
  }
  return [...tally.entries()]
    .map(([muscle, sets]) => ({ muscle, label: MUSCLE_GROUP_LABELS[muscle], sets }))
    .sort((a, b) => b.sets - a.sets);
}

export interface LastPerformance {
  at: number;
  sessionName: string;
  sets: SessionSet[];
}

/** The working sets of the most recent session that trained this exercise. */
export function lastPerformance(model: Model, exerciseId: string): LastPerformance | null {
  for (const session of model.sessionsByExercise.get(exerciseId) ?? []) {
    const sets = session.exercises
      .filter((block) => block.exercise.id === exerciseId)
      .flatMap((block) => block.sets.filter((set) => set.isCompleted && set.isWorking));
    if (sets.length > 0) return { at: session.startedAt, sessionName: session.name, sets };
  }
  return null;
}

/** "Last done today", "Last done 3 days ago", "Last done on 12 Oct", or "Not done yet". */
export function lastDoneLabel(at: number | null): string {
  if (!at) return "Not done yet";
  const text = relativeDay(at);
  if (text === "Today" || text === "Yesterday") return `Last done ${text.toLowerCase()}`;
  return text.endsWith("ago") ? `Last done ${text}` : `Last done on ${text}`;
}
