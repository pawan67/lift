import { fromDisplayWeight, toDisplayWeight, type WeightUnit } from '@lift/shared';
import { useEffect, type RefObject } from 'react';
import type { View } from 'react-native';

import type { WorkoutSet } from '@/db/schema';
import { useSettings, type SetEntryMode } from '@/store/settings';

import { useSetEntry, type EntryTarget } from './store';
import type { EntryField } from './values';

interface EntryRowParams {
  set: WorkoutSet;
  previous?: WorkoutSet;
  isNext: boolean;
  setName: string;
  hasWeight: boolean;
  hasReps: boolean;
  weightUnit: WeightUnit;
  rowRef: RefObject<View | null>;
  onChange: (patch: Partial<WorkoutSet>) => void;
  log: () => void;
  type: (field: EntryField) => void;
}

export interface EntryRow {
  mode: SetEntryMode;
  /** Which of this row's cells the docked panel is on, if any. */
  selectedField: EntryField | null;
  open: (field: EntryField) => void;
}

const display = (kg: number | null | undefined, unit: WeightUnit) =>
  kg == null ? null : Math.round(toDisplayWeight(kg, unit) * 100) / 100;

/**
 * Connects one set row to the docked entry panel.
 *
 * The row is the panel's only source: while it is the target it re-publishes
 * itself on every render, so the panel sees a copied previous, a unit change
 * or its own write's echo the moment the row does. When the panel has just
 * logged a set and is waiting to move on, the row `nextOpenSet` outlines
 * claims it, which is what walks the panel down the table with the work.
 */
export function useEntryRow(params: EntryRowParams): EntryRow {
  const mode = useSettings((state) => state.setEntryMode);
  const docked = mode !== 'scrub';
  const { set } = params;

  const selectedField = useSetEntry((state) =>
    docked && state.target?.setId === set.id ? state.target.field : null,
  );
  const claim = useSetEntry(
    (state) =>
      docked &&
      state.advancing &&
      params.isNext &&
      !set.isCompleted &&
      state.target?.setId !== set.id,
  );

  // Rebuilt every render on purpose: it closes over the row's newest props.
  const build = (field: EntryField): EntryTarget => ({
    setId: set.id,
    groupId: set.workoutExerciseId,
    field,
    setName: params.setName,
    hasWeight: params.hasWeight,
    hasReps: params.hasReps,
    weightUnit: params.weightUnit,
    weight: display(set.weightKg, params.weightUnit),
    reps: set.reps,
    ghostWeight: display(params.previous?.weightKg, params.weightUnit),
    ghostReps: params.previous?.reps ?? null,
    isCompleted: set.isCompleted,
    commit: (patch) => {
      const next: Partial<WorkoutSet> = {};
      if (patch.weight !== undefined) next.weightKg = fromDisplayWeight(patch.weight, params.weightUnit);
      if (patch.reps !== undefined) next.reps = Math.round(patch.reps);
      if (Object.keys(next).length > 0) params.onChange(next);
    },
    log: params.log,
    type: params.type,
    measure: (done) => params.rowRef.current?.measureInWindow((_x, y, _w, h) => done(y, h)),
  });

  useEffect(() => {
    const store = useSetEntry.getState();
    if (selectedField) store.refresh(build(selectedField));
    else if (claim) store.claim(build(store.target?.field ?? 'weight'));
  });

  // A row that goes away under the panel takes the panel with it, unless the
  // panel is mid-hand-off: finishing an exercise collapses its block, and the
  // next block's row is about to claim it.
  useEffect(
    () => () => {
      const store = useSetEntry.getState();
      if (store.target?.setId === set.id && !store.advancing) store.close();
    },
    [set.id],
  );

  return {
    mode,
    selectedField,
    open: (field) => useSetEntry.getState().open(build(field)),
  };
}
