import { Ionicons } from '@expo/vector-icons';
import {
  DATE_LONG,
  formatDateTime,
  formatDurationShort,
  normalizeSupersets,
  reorder,
  TRACKING_FIELDS,
  type PositionedRow,
  type SetType,
  type SupersetAssignment,
} from '@lift/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Card,
  Divider,
  EmptyState,
  HeaderAction,
  ListRow,
  PromptModal,
  ReorderSheet,
  Screen,
  Text,
  useScrollEdge,
  type ReorderItem,
} from '@/components/ui';
import { db } from '@/db/client';
import {
  exercises as exercisesTable,
  workoutExercises,
  workoutSets,
  workouts,
  type WorkoutSet,
} from '@/db/schema';
import { setExerciseUnits } from '@/features/exercises/repository';
import { haptics } from '@/features/feedback/haptics';
import { ExerciseBlock } from '@/features/workouts/exercise-block';
import { ghostFill, pairedPreviousSet } from '@/features/workouts/previous';
import { RestDurationSheet } from '@/features/workouts/rest-duration-sheet';
import { SetEntryHost } from '@/features/workouts/set-entry/host';
import { useSetEntry } from '@/features/workouts/set-entry/store';
import { showSupersetMenu, supersetMap, SupersetTie } from '@/features/workouts/superset';
import {
  addExerciseToWorkout,
  addSet,
  applyExerciseOrder,
  applySupersetGroups,
  canLogSet,
  deleteSet,
  getPreviousPerformance,
  hasRestOverride,
  recalculateWorkout,
  removeExerciseFromWorkout,
  resolveRestSeconds,
  setExerciseRest,
  substituteExercise,
  updateSet,
  updateWorkoutFields,
  type PreviousPerformance,
  type SetInput,
  type WorkoutExerciseDetail,
} from '@/features/workouts/repository';
import { useWriteGuard } from '@/features/workouts/use-write-guard';
import { WorkoutDurationSheet } from '@/features/workouts/workout-duration-sheet';
import { showAlert } from '@/store/dialog';
import { useExercisePicker, usePickedExercises } from '@/store/exercise-picker';
import { useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

/**
 * Correcting a session that is already in the log.
 *
 * The logging screen is the only place in the app that can change a set, and it
 * only ever opens on the session in progress, so a weight typed into the wrong
 * row, a set that was logged twice, or an exercise recorded under the wrong
 * name was permanent the moment Save was pressed. The only remedy the app
 * offered was to delete the whole session and re-enter it from memory.
 *
 * This is that screen again, pointed at a finished workout. It is deliberately
 * the same components: `ExerciseBlock`, `SetRow`, the reorder sheet, the rest
 * editor, because the gesture for fixing a set has to be the gesture for
 * logging one; a second, read-only-ish editor with its own affordances would be
 * a second thing to learn for the rarer of the two jobs.
 *
 * What it is *not* is the logging screen: no rest timer, no keep-awake, no
 * notifications, no finish flow. Nothing here is happening now.
 *
 * The one thing it owes that the logging screen doesn't is arithmetic. A
 * finished session stores its own totals and its records, and every screen in
 * the app reads those stored figures rather than the sets, so an edit that
 * only wrote rows would leave the history card, the muscle split and the
 * trophy in the state they were in before. `recalculateWorkout` is what puts
 * them back in agreement, and it runs on the way out.
 */
export default function EditWorkoutScreen() {
  const scrollEdge = useScrollEdge();

  const colors = useColors();
  const insets = useSafeAreaInsets();
  // The docked set-entry panel covers the bottom of the list while it is up.
  const entryInset = useSetEntry((state) => (state.target ? state.dockHeight : 0));
  const { id } = useLocalSearchParams<{ id: string }>();

  // Addressed per workout rather than per screen: two edit screens for two
  // different sessions can sit on the stack at once (history → workout → edit,
  // then a tap through to an exercise and back into another session), and an
  // unaddressed delivery would add the picked exercises to both.
  const pickerAddress = `edit-workout:${id}`;
  const pendingExerciseIds = usePickedExercises(pickerAddress);
  const clearPendingExercises = useExercisePicker((state) => state.clear);
  const openPicker = useExercisePicker((state) => state.open);

  const defaultRestSeconds = useSettings((state) => state.defaultRestSeconds);
  const { guard, lostWrites } = useWriteGuard();

  const { data: workoutRows = [], updatedAt } = useLiveQuery(
    db
      .select()
      .from(workouts)
      .where(and(eq(workouts.id, id), isNull(workouts.deletedAt))),
    [id],
  );

  const workout = workoutRows[0];

  const { data: links = [] } = useLiveQuery(
    db
      .select()
      .from(workoutExercises)
      .where(and(eq(workoutExercises.workoutId, id), isNull(workoutExercises.deletedAt)))
      .orderBy(asc(workoutExercises.position)),
    [id],
  );

  const linkIds = links.map((link) => link.id);
  const linkKey = linkIds.join(',');

  const { data: sets = [] } = useLiveQuery(
    db
      .select()
      .from(workoutSets)
      // An empty IN () is invalid SQL, so fall back to a sentinel that matches nothing.
      .where(
        and(
          inArray(workoutSets.workoutExerciseId, linkIds.length > 0 ? linkIds : ['__none__']),
          isNull(workoutSets.deletedAt),
        ),
      )
      .orderBy(asc(workoutSets.position)),
    [linkKey],
  );

  // Only the exercises this session uses. The catalog is ~6,800 rows and the
  // screen needs a handful. Same query, same reasoning, as `active.tsx`.
  const exerciseIds = links.map((link) => link.exerciseId);
  const exerciseIdsKey = exerciseIds.join(',');

  const { data: workoutExerciseRows = [] } = useLiveQuery(
    db
      .select()
      .from(exercisesTable)
      .where(inArray(exercisesTable.id, exerciseIds.length > 0 ? exerciseIds : ['__none__'])),
    [exerciseIdsKey],
  );

  const details = useMemo<WorkoutExerciseDetail[]>(() => {
    const exerciseById = new Map(workoutExerciseRows.map((row) => [row.id, row]));
    const setsByParent = new Map<string, WorkoutSet[]>();

    for (const set of sets) {
      const bucket = setsByParent.get(set.workoutExerciseId);
      if (bucket) bucket.push(set);
      else setsByParent.set(set.workoutExerciseId, [set]);
    }

    return links.flatMap((link) => {
      const exercise = exerciseById.get(link.exerciseId);
      if (!exercise) return [];
      return [{ workoutExercise: link, exercise, sets: setsByParent.get(link.id) ?? [] }];
    });
  }, [links, sets, workoutExerciseRows]);

  /*
   * A recalculation is owed the moment anything is written.
   *
   * Done is the intended way out and awaits it, but Android's back gesture and
   * iOS's edge swipe do not route through a button, so the flag also drives the
   * unmount fallback below. Refs rather than state: nothing on screen reads
   * either of them, and `dirty` is set on every keystroke in a weight field:
   * as state that would be a full re-render per character typed.
   */
  const dirty = useRef(false);
  const recalculated = useRef(false);

  const write = useCallback(
    (promise: Promise<unknown>): Promise<boolean> => {
      dirty.current = true;
      return guard(promise);
    },
    [guard],
  );

  useEffect(
    () => () => {
      if (!dirty.current || recalculated.current) return;

      // Fire-and-forget, and read from the store rather than from a captured
      // render: this closure is created once and the settings it needs are the
      // ones in force when the screen is actually left.
      const { bodyweightKg, oneRepMaxFormula } = useSettings.getState();
      void recalculateWorkout(id, {
        bodyweightKg: bodyweightKg ?? undefined,
        formula: oneRepMaxFormula,
      }).catch(() => {});
    },
    [id],
  );

  /*
   * What was done the session *before* this one, for the Previous column.
   *
   * Bounded by this workout's start rather than merely excluding it. Editing a
   * session from March, the most recent other session is a later one, and a
   * column headed Previous would be offering numbers from the future of the
   * workout on screen: including as the placeholder a bare check-off commits.
   */
  const [previousByExercise, setPreviousByExercise] = useState<Record<string, PreviousPerformance>>(
    {},
  );

  const exerciseIdKey = details.map((detail) => detail.exercise.id).join(',');
  const startedAtMs = workout?.startedAt.getTime();

  useEffect(() => {
    if (startedAtMs === undefined) return;
    let cancelled = false;

    void (async () => {
      const entries = await Promise.all(
        exerciseIdKey
          .split(',')
          .filter(Boolean)
          .map(
            async (exerciseId) =>
              [
                exerciseId,
                await getPreviousPerformance(exerciseId, {
                  excludeWorkoutId: id,
                  before: startedAtMs,
                }),
              ] as const,
          ),
      );
      if (!cancelled) setPreviousByExercise(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [exerciseIdKey, id, startedAtMs]);

  // The slot a picker trip is meant to replace, when it is one. A ref rather
  // than state, for the reasons set out on the same field in `active.tsx`.
  const replacingLinkId = useRef<string | null>(null);

  useEffect(() => {
    if (pendingExerciseIds.length === 0) return;

    const replacing = replacingLinkId.current;
    replacingLinkId.current = null;

    write(
      (async () => {
        const ids = [...pendingExerciseIds];

        if (replacing) {
          const first = ids.shift();
          if (first) await substituteExercise(replacing, first);
        }

        for (const exerciseId of ids) {
          const created = await addExerciseToWorkout(id, exerciseId);
          await addSet(created.id);
        }
        clearPendingExercises(pickerAddress);
      })(),
    );
  }, [pendingExerciseIds, id, pickerAddress, clearPendingExercises, write]);

  /**
   * Set ids whose weight the user emptied by hand: see `ghostFill`. A cleared
   * field and one that was never touched are the same null in the row, and only
   * this handler can tell them apart.
   */
  const clearedWeights = useRef<Set<string>>(new Set());

  const handleUpdateSet = useCallback(
    (setId: string, patch: Partial<WorkoutSet>) => {
      if ('weightKg' in patch) {
        if (patch.weightKg === null) clearedWeights.current.add(setId);
        else clearedWeights.current.delete(setId);
      }
      write(updateSet(setId, patch));
    },
    [write],
  );

  /**
   * The check-off, minus everything about now.
   *
   * The logging screen's version also starts a rest timer, schedules a
   * notification and fires a milestone haptic when a block closes out. None of
   * that belongs to a session that finished on Tuesday. What is left is the
   * acceptance rule and the ghost, and both are shared with that screen rather
   * than restated: `canLogSet` decides whether the tap lands. The set row runs
   * the same call to decide whether to tint before the write returns, and the
   * two disagreeing is what leaves a green row over a set the database refused.
   */
  const handleToggleSet = useCallback(
    (set: WorkoutSet, detail: WorkoutExerciseDetail): Promise<boolean> => {
      if (set.isCompleted) {
        return write(updateSet(set.id, { isCompleted: false }));
      }

      const fields = TRACKING_FIELDS[detail.exercise.trackingType];
      const previous = pairedPreviousSet(
        detail.sets,
        previousByExercise[detail.exercise.id]?.sets,
        set,
      );

      if (!canLogSet(fields, set, previous)) {
        haptics.rejected();
        return Promise.resolve(false);
      }

      haptics.logged();

      const patch: SetInput = { isCompleted: true };
      const fill = ghostFill(
        detail.exercise.trackingType,
        previous,
        clearedWeights.current.has(set.id),
      );

      return write(updateSet(set.id, patch, fill));
    },
    [previousByExercise, write],
  );

  const [restEditorId, setRestEditorId] = useState<string | null>(null);
  const restEditorDetail = details.find((detail) => detail.workoutExercise.id === restEditorId);

  /*
   * The rows the superset logic reads: grouping and order, nothing else.
   *
   * A superset is part of what happened rather than part of the plan, so it is
   * editable here for the same reason the set list is: this screen exists to
   * correct a record of a session, and "these two were done back to back" is a
   * fact about that session which can have been recorded wrong.
   */
  const supersetRows = useMemo(
    () =>
      details.map((detail) => ({
        id: detail.workoutExercise.id,
        name: detail.exercise.name,
        supersetGroup: detail.workoutExercise.supersetGroup,
      })),
    [details],
  );

  const placements = useMemo(() => supersetMap(supersetRows), [supersetRows]);

  const applySupersets = useCallback(
    (writes: SupersetAssignment[]) => {
      if (writes.length === 0) return;
      write(applySupersetGroups(writes));
    },
    [write],
  );

  const [reordering, setReordering] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editingDuration, setEditingDuration] = useState(false);

  const reorderItems = useMemo<ReorderItem[]>(
    () =>
      details.map((detail) => ({
        id: detail.workoutExercise.id,
        label: detail.exercise.name,
        detail: `${detail.sets.length} ${detail.sets.length === 1 ? 'set' : 'sets'}`,
      })),
    [details],
  );

  /**
   * Writes the order the sheet came back with, one hop at a time.
   *
   * The arithmetic is `reorder()`'s: the sheet reports a final order, and
   * replaying it as a sequence of single moves is what keeps the common case to
   * one row written instead of renumbering the session. The working copy is
   * kept in step as it goes, so each hop is computed against the positions the
   * one before it produced.
   */
  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      setReordering(false);

      let rows: PositionedRow[] = details.map((detail) => ({
        id: detail.workoutExercise.id,
        position: detail.workoutExercise.position,
      }));

      const writes: PositionedRow[] = [];

      orderedIds.forEach((entryId, target) => {
        const from = rows.findIndex((row) => row.id === entryId);
        if (from === -1 || from === target) return;

        const moved = reorder(rows, from, target);
        if (moved.length === 0) return;

        const byId = new Map(moved.map((row) => [row.id, row.position]));
        rows = rows
          .map((row) => ({ ...row, position: byId.get(row.id) ?? row.position }))
          .sort((a, b) => a.position - b.position);

        writes.push(...moved);
      });

      if (writes.length === 0) return;

      haptics.selection();
      // Last write wins per row: a row nudged twice while replaying the hops
      // only needs the position it ended on.
      const final = new Map(writes.map((entry) => [entry.id, entry]));
      write(applyExerciseOrder([...final.values()]));

      // A drag through the middle of a superset dismantles it, and the drag
      // handle has no idea it did that. See the same sweep in `active.tsx`.
      const groups = new Map(
        details.map((detail) => [detail.workoutExercise.id, detail.workoutExercise.supersetGroup]),
      );

      applySupersets(
        normalizeSupersets(
          rows.map((row) => ({ id: row.id, supersetGroup: groups.get(row.id) ?? null })),
        ),
      );
    },
    [details, write, applySupersets],
  );

  const handleSaveRest = useCallback(
    (seconds: number | null) => {
      const detail = restEditorDetail;
      setRestEditorId(null);
      if (!detail) return;

      write(setExerciseRest(detail.workoutExercise.id, detail.exercise.id, seconds));
    },
    [restEditorDetail, write],
  );

  const completed = useMemo(
    () => details.reduce((total, d) => total + d.sets.filter((set) => set.isCompleted).length, 0),
    [details],
  );

  const unchecked = useMemo(
    () => details.reduce((total, d) => total + d.sets.filter((set) => !set.isCompleted).length, 0),
    [details],
  );

  /*
   * Leaving is latched the same way finishing is on the logging screen: the ref
   * closes the door because a second tap arrives before any state has
   * re-rendered, and the state exists so the header can dim.
   */
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  const handleDone = useCallback(() => {
    if (!workout || closingRef.current) return;

    /*
     * A session with nothing checked off is not an edit, it is a deletion, and
     * the recalculation would carry it out silently, because "an exercise with
     * nothing checked was never performed" is the rule that finishing has
     * always applied. Better to say so and leave the sets alone; Delete workout
     * is one screen back, where it says what it does.
     */
    if (completed === 0) {
      haptics.rejected();
      void showAlert(
        'Nothing logged',
        'Complete at least one set, or delete the workout from the session screen.',
      );
      return;
    }

    closingRef.current = true;
    setClosing(true);

    void (async () => {
      try {
        const { bodyweightKg, oneRepMaxFormula } = useSettings.getState();
        await recalculateWorkout(workout.id, {
          bodyweightKg: bodyweightKg ?? undefined,
          formula: oneRepMaxFormula,
        });

        // Only after the totals have landed: the unmount fallback exists for
        // the back gesture, and letting it run as well would recompute the same
        // session twice on the way out.
        recalculated.current = true;
        haptics.finished();
        router.back();
      } catch {
        closingRef.current = false;
        setClosing(false);
        haptics.rejected();
        void showAlert(
          'Could not save the changes',
          'Your sets are still here: try again in a moment.',
        );
      }
    })();
  }, [workout, completed]);

  // Declared once and rendered in every branch: a native-stack screen reads its
  // options as the push animation starts, so setting them only in the loaded
  // branch slides a differently titled header in and relabels it mid-transition.
  const header = (
    <Stack.Screen
      options={{
        title: 'Edit workout',
        headerRight:
          workout && workout.finishedAt
            ? () => (
                <HeaderAction
                  label="Save changes"
                  title="Done"
                  variant="filled"
                  disabled={closing}
                  onPress={handleDone}
                />
              )
            : undefined,
      }}
    />
  );

  if (!workout) {
    // `updatedAt` is undefined until the first read lands, so the mount frame
    // has no row yet. Announcing "not found" there would flash a failure over
    // a session that is right behind this screen.
    return (
      <Screen scrolled={scrollEdge.progress}>
        {header}
        {updatedAt !== undefined && (
          <EmptyState
            icon="alert-circle-outline"
            title="Workout not found"
            description="It was deleted somewhere else while this screen was open."
            action={<Button title="Go back" onPress={() => router.back()} />}
          />
        )}
      </Screen>
    );
  }

  if (!workout.finishedAt) {
    // The session is still running, and the logging screen is the one that owns
    // it. It has the clock, the rest timer and Finish. Editing it from here
    // would be two screens writing the same rows with different rules.
    return (
      <Screen scrolled={scrollEdge.progress}>
        {header}
        <EmptyState
          icon="barbell-outline"
          title="Still in progress"
          description="This session hasn't been saved yet. Finish it from the workout screen first."
          action={<Button title="Go to workout" onPress={() => router.replace('/workout/active')} />}
        />
      </Screen>
    );
  }

  return (
    <Screen scrolled={scrollEdge.progress}>
      {header}

      <ScrollView
        {...scrollEdge.list}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: spacing.huge + insets.bottom + entryInset },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // UIScrollView already scrolls the first responder into `bounds` minus
        // `contentInset`, so this single prop both creates the trailing slack
        // and lifts the focused row. Same arrangement as the logging screen.
        automaticallyAdjustKeyboardInsets
      >
        {/* The three facts about the session that live on the row rather than
            on its sets. Started is stated and not editable: it is when the app
            recorded the session beginning, and moving it would move the
            workout between days, months and every aggregate keyed on them:
            a different feature, wanting a date picker and a rule of its own. */}
        <Card padded={false} style={styles.meta}>
          <ListRow
            icon="text-outline"
            title={workout.name}
            subtitle="Name"
            onPress={() => setRenaming(true)}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="stopwatch-outline"
            title={formatDurationShort(workout.durationSeconds ?? 0)}
            subtitle="Duration"
            onPress={() => setEditingDuration(true)}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="calendar-outline"
            title={formatDateTime(workout.startedAt, DATE_LONG)}
            subtitle="Started"
            showChevron={false}
          />
        </Card>

        {lostWrites > 0 && (
          /* The one place the screen admits it is not writing: the same
             banner, and the same reasoning, as the logging screen. */
          <Pressable
            onPress={() => router.push('/export')}
            accessibilityRole="button"
            accessibilityLabel={`Not saving. ${lostWrites} ${
              lostWrites === 1 ? 'change' : 'changes'
            } lost`}
            accessibilityHint="Opens export, which still works"
            style={({ pressed }) => [styles.writeFailure, pressed && styles.pressed]}
          >
            <Text variant="label" color="danger">
              {`Not saving: ${lostWrites} ${lostWrites === 1 ? 'change' : 'changes'} lost`}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.danger} />
          </Pressable>
        )}

        {unchecked > 0 && (
          /* Said before the sets rather than at Done, while there is still time
             to check the box. `dropped`, not `discarded`: the repository's own
             word, and the save screen's. */
          <Text variant="caption" color="warning" style={styles.warning}>
            {`${unchecked} unchecked ${unchecked === 1 ? 'set' : 'sets'} will be dropped.`}
          </Text>
        )}

        {details.length === 0 ? (
          <EmptyState
            icon="add-circle-outline"
            title="No exercises left"
            description="Add one back, or delete this workout from the session screen."
          />
        ) : (
          details.map((detail, index) => (
            <View key={detail.workoutExercise.id}>
              {/* A member that is not the first of its run is tied to the block
                  above rather than separated from it. See `SupersetTie`. */}
              {index > 0 &&
                (placements.get(detail.workoutExercise.id)?.first === false ? (
                  <SupersetTie />
                ) : (
                  <Divider />
                ))}
              <ExerciseBlock
                detail={detail}
                superset={placements.get(detail.workoutExercise.id)}
                // Nothing to pair with in a session of one, so no control.
                onEditSuperset={
                  details.length > 1
                    ? () =>
                        showSupersetMenu(supersetRows, detail.workoutExercise.id, applySupersets)
                    : undefined
                }
                previousSets={previousByExercise[detail.exercise.id]?.sets ?? []}
                // No recalled note here. On the logging screen it puts a
                // standing cue back in front of someone about to lift; on a
                // session from three weeks ago it would be a suggestion to
                // annotate the past with something said afterwards.
                previousNote={null}
                // And no `progression`, for the same reason turned up one
                // notch. A target is for a set that has not been performed yet;
                // this screen is a record of sets that have. Offering to write
                // 82.5 kg into a session from March would be offering to
                // falsify it, so the prop is simply not passed and the block
                // renders no line at all.
                onAddSet={() => {
                  const last = detail.sets[detail.sets.length - 1];
                  haptics.added();
                  write(
                    addSet(detail.workoutExercise.id, {
                      weightKg: last?.weightKg ?? null,
                      reps: last?.reps ?? null,
                      setType: 'normal',
                    }),
                  );
                }}
                onUpdateSet={handleUpdateSet}
                onToggleSet={(set) => handleToggleSet(set, detail)}
                onDeleteSet={(setId) => {
                  haptics.destructive();
                  write(deleteSet(setId));
                }}
                onChangeSetType={(setId, setType: SetType) => {
                  haptics.selection();
                  write(updateSet(setId, { setType }));
                }}
                onRemoveExercise={() => {
                  haptics.destructive();
                  write(removeExerciseFromWorkout(detail.workoutExercise.id));
                }}
                onReplaceExercise={() => {
                  replacingLinkId.current = detail.workoutExercise.id;
                  openPicker(
                    pickerAddress,
                    details.map((entry) => entry.exercise.id),
                  );
                  router.push('/exercise/picker');
                }}
                onEditNotes={(seed) => {
                  router.push({
                    pathname: '/workout/notes/[id]',
                    params: { id: detail.workoutExercise.id, ...(seed ? { seed } : {}) },
                  });
                }}
                onReorder={() => setReordering(true)}
                onEditRest={() => setRestEditorId(detail.workoutExercise.id)}
                onChangeUnits={(units) => {
                  write(setExerciseUnits(detail.exercise.id, units));
                }}
                onOpenExercise={() => {
                  router.push({
                    pathname: '/exercise/[id]',
                    params: { id: detail.exercise.id },
                  });
                }}
              />
            </View>
          ))
        )}

        <View style={styles.actions}>
          <Button
            title="Add exercise"
            icon="add"
            fullWidth
            onPress={() => {
              // Backing out of the picker leaves the replacement request behind,
              // and the next trip would silently swap an exercise instead of
              // adding one. Opening the picker plainly cancels it.
              replacingLinkId.current = null;
              openPicker(
                pickerAddress,
                details.map((entry) => entry.exercise.id),
              );
              router.push('/exercise/picker');
            }}
          />
        </View>
      </ScrollView>

      <PromptModal
        visible={renaming}
        title="Rename workout"
        initialValue={workout.name}
        onCancel={() => setRenaming(false)}
        onConfirm={(value) => {
          setRenaming(false);
          write(updateWorkoutFields(id, { name: value }));
        }}
      />

      <WorkoutDurationSheet
        visible={editingDuration}
        workoutName={workout.name}
        value={workout.durationSeconds ?? 0}
        onCancel={() => setEditingDuration(false)}
        onSave={(seconds) => {
          setEditingDuration(false);
          haptics.selection();
          write(updateWorkoutFields(id, { durationSeconds: seconds }));
        }}
      />

      {restEditorDetail && (
        <RestDurationSheet
          visible
          exerciseName={restEditorDetail.exercise.name}
          value={resolveRestSeconds(restEditorDetail, defaultRestSeconds)}
          usingDefault={!hasRestOverride(restEditorDetail)}
          defaultSeconds={defaultRestSeconds}
          onCancel={() => setRestEditorId(null)}
          onSave={handleSaveRest}
        />
      )}

      <ReorderSheet
        visible={reordering}
        title="Reorder exercises"
        items={reorderItems}
        onClose={() => setReordering(false)}
        onCommit={handleReorder}
      />

      {/* The docked dial panel and the scrub bubble. See the active screen. */}
      <SetEntryHost />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // No horizontal padding: the exercise blocks carry the screen margin
  // themselves and their dividers run edge to edge, so everything else here
  // takes its own margin. Same contract as the logging screen.
  scroll: { paddingBottom: spacing.huge },
  meta: { margin: spacing.lg, marginBottom: spacing.md },
  writeFailure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  pressed: { opacity: 0.6 },
  warning: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  actions: { padding: spacing.lg, gap: spacing.sm },
});
