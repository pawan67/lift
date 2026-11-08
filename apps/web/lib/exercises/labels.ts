import {
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
  type MuscleGroup,
  type TrackingType,
} from "@lift/shared";

import type { ExerciseInfo } from "@/lib/data/model";

export const TRACKING_LABELS: Record<TrackingType, string> = {
  weight_reps: "Weight & reps",
  bodyweight_reps: "Bodyweight reps",
  weighted_bodyweight: "Weighted bodyweight",
  assisted_bodyweight: "Assisted bodyweight",
  duration: "Duration",
  distance_duration: "Distance & duration",
  weight_distance: "Weight & distance",
  reps_only: "Reps only",
};

export const TRACKING_HINTS: Record<TrackingType, string> = {
  weight_reps: "Bench press, squat, curls",
  bodyweight_reps: "Push-ups, pull-ups",
  weighted_bodyweight: "Weighted dips, weighted pull-ups",
  assisted_bodyweight: "Assisted pull-up machine",
  duration: "Plank, dead hang",
  distance_duration: "Running, rowing, cycling",
  weight_distance: "Farmer's walk, sled push",
  reps_only: "Jumping jacks, box jumps",
};

export function muscleLabel(muscle: MuscleGroup): string {
  return MUSCLE_GROUP_LABELS[muscle];
}

/** "Chest · Barbell" */
export function exerciseSubtitle(exercise: Pick<ExerciseInfo, "primaryMuscle" | "equipment">): string {
  return `${MUSCLE_GROUP_LABELS[exercise.primaryMuscle]} · ${EQUIPMENT_LABELS[exercise.equipment]}`;
}
