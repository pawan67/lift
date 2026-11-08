/**
 * Search and filter state shared by the library page and the selector.
 *
 * Ranking is the shared package's (`filterExercises`), the same one the phone
 * uses: text match first, then the lifts this person actually trains. The
 * query goes through `useDeferredValue` so typing stays immediate while a
 * 6,800-row filter catches up a frame later.
 */

"use client";

import {
  countExercisesPerMuscle,
  filterExercises,
} from "@lift/shared/exercises/search";
import type { Equipment, MuscleGroup } from "@lift/shared";
import { useDeferredValue, useMemo, useState } from "react";

import type { ExerciseInfo, Model } from "@/lib/data/model";

export type ExerciseScope = "all" | "trained" | "custom";

export interface ExerciseQuery {
  search: string;
  muscles: MuscleGroup[];
  equipment: Equipment[];
  scope: ExerciseScope;
}

export function useExerciseQuery(initial: Partial<ExerciseQuery> = {}) {
  const [search, setSearch] = useState(initial.search ?? "");
  const [muscles, setMuscles] = useState<MuscleGroup[]>(initial.muscles ?? []);
  const [equipment, setEquipment] = useState<Equipment[]>(initial.equipment ?? []);
  const [scope, setScope] = useState<ExerciseScope>(initial.scope ?? "all");

  return {
    search,
    setSearch,
    muscles,
    setMuscles,
    equipment,
    setEquipment,
    scope,
    setScope,
    /** True when anything narrows the list beyond the scope. */
    narrowed: search.trim().length > 0 || muscles.length > 0 || equipment.length > 0,
    clear: () => {
      setSearch("");
      setMuscles([]);
      setEquipment([]);
    },
  };
}

export function useFilteredExercises(model: Model, query: ExerciseQuery): ExerciseInfo[] {
  const search = useDeferredValue(query.search);
  const { muscles, equipment, scope } = query;

  return useMemo(() => {
    const usage = model.trainingIndex.usage;
    const base =
      scope === "trained" ? model.exerciseList.filter((exercise) => usage.has(exercise.id)) : model.exerciseList;

    return filterExercises(
      base,
      {
        search: search.trim() || undefined,
        muscles,
        equipment,
        customOnly: scope === "custom",
        // Archived exercises stay findable where someone would go looking to unarchive them.
        includeArchived: scope === "custom",
      },
      usage,
    );
  }, [model, search, muscles, equipment, scope]);
}

export function useMuscleCounts(model: Model): Partial<Record<MuscleGroup, number>> {
  return useMemo(() => countExercisesPerMuscle(model.exerciseList), [model]);
}

export function useEquipmentCounts(model: Model): Partial<Record<Equipment, number>> {
  return useMemo(() => {
    const counts: Partial<Record<Equipment, number>> = {};
    for (const exercise of model.exerciseList) {
      if (exercise.isArchived) continue;
      counts[exercise.equipment] = (counts[exercise.equipment] ?? 0) + 1;
    }
    return counts;
  }, [model]);
}
