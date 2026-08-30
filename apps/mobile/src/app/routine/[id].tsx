import { Ionicons } from '@expo/vector-icons';
import {
  normalizeSupersets,
  reorder,
  type PositionedRow,
  type SupersetAssignment,
} from '@lift/shared';
import { and, asc, desc, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  EmptyState,
  FilterSheet,
  HeaderAction,
  ListRow,
  OptionList,
  PromptModal,
  ReorderSheet,
  Screen,
  SectionHeader,
  Text,
  useScrollEdge,
  type ReorderItem,
} from '@/components/ui';
import { db } from '@/db/client';
import { routineFolders, workouts } from '@/db/schema';
import { useRows } from '@/db/use-rows';
import { RoutineExerciseBlock } from '@/features/routines/exercise-block';
import {
  addExerciseToRoutine,
  applyRoutineExerciseOrder,
  applyRoutineSupersetGroups,
  deleteRoutine,
  getRoutineDetail,
  updateRoutine,
  updateRoutineExercise,
  type RoutineDetail,
  type RoutineExerciseDetail,
} from '@/features/routines/repository';
import { startWorkout } from '@/features/workouts/repository';
import { startSession } from '@/features/workouts/start-session';
import { showSupersetMenu, supersetMap, supersetColor } from '@/features/workouts/superset';
import { haptics } from '@/features/feedback/haptics';
import { buildRoutineShare } from '@/features/share';
import { useShare } from '@/features/share/use-share';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useLaunchAction } from '@/hooks/use-launch-action';
import { showConfirm } from '@/store/dialog';
import { useExercisePicker, usePickedExercises } from '@/store/exercise-picker';
import { HIT_SLOP, spacing, useColors } from '@/theme';

export default function RoutineEditorScreen() {
  const scrollEdge = useScrollEdge();
  const { sharing, share } = useShare();

  const { id, start } = useLocalSearchParams<{ id: string; start?: string }>();

  // Addressed per routine, not per screen: this editor has one instance per
  // routine id, and returning to a *different* routine must not collect a
  // delivery meant for the one that was left.
  const pickerAddress = `routine:${id}`;
  const pendingExerciseIds = usePickedExercises(pickerAddress);
  const clearPendingExercises = useExercisePicker((state) => state.clear);
  const openPicker = useExercisePicker((state) => state.open);

  const colors = useColors();

  const [detail, setDetail] = useState<RoutineDetail | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [editingRoutineNotes, setEditingRoutineNotes] = useState(false);
  const [editingExerciseNotesFor, setEditingExerciseNotesFor] = useState<string | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [starting, setStarting] = useState(false);
  const inFlight = useRef(false);

  // Whether the session that is already running came from this routine, so the
  // action can say what the tap will really do.
  const { data: openRows = [] } = useLiveQuery(
    db
      .select({ routineId: workouts.routineId })
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt))
      .limit(1),
    [id],
  );

  const { rows: folders = [] } = useRows(
    db
      .select()
      .from(routineFolders)
      .where(isNull(routineFolders.deletedAt))
      .orderBy(asc(routineFolders.position)),
  );

  const resuming = openRows[0]?.routineId === id;

  const reload = useCallback(async () => {
    setDetail((await getRoutineDetail(id)) ?? null);
  }, [id]);

  /*
   * The rows the superset logic reads: grouping and order, nothing else.
   *
   * Keyed by `routineExercise.id` rather than by the exercise's, because a
   * routine may prescribe the same lift twice and only one of the two may be in
   * the superset.
   */
  const supersetRows = useMemo(
    () =>
      (detail?.exercises ?? []).map((entry) => ({
        id: entry.routineExercise.id,
        name: entry.exercise.name,
        supersetGroup: entry.routineExercise.supersetGroup,
      })),
    [detail],
  );

  const placements = useMemo(() => supersetMap(supersetRows), [supersetRows]);

  const clusters = useMemo(() => {
    const exercises = detail?.exercises ?? [];
    const result: { label: string | null; entries: RoutineExerciseDetail[] }[] = [];

    for (const entry of exercises) {
      const placement = placements.get(entry.routineExercise.id);
      const last = result[result.length - 1];
      if (placement && placement.first === false && last) {
        last.entries.push(entry);
        continue;
      }
      result.push({
        label: placement?.first ? placement.label : null,
        entries: [entry],
      });
    }

    return result;
  }, [detail, placements]);

  // A reload rather than an optimistic edit, for the same reason `handleReorder`
  // reloads: nothing on this screen is a live query, so storage is the only
  // thing that knows what the grouping is now.
  const applySupersets = useCallback(
    (writes: SupersetAssignment[]) => {
      if (writes.length === 0) return;
      void applyRoutineSupersetGroups(writes).then(reload);
    },
    [reload],
  );

  const [reordering, setReordering] = useState(false);

  // Names and set counts. A routine's blocks are told apart by what they are
  // and how much of them there is. The target weights are the screen behind
  // the sheet, not the thing being ordered.
  const reorderItems = useMemo<ReorderItem[]>(
    () =>
      (detail?.exercises ?? []).map((entry) => ({
        id: entry.routineExercise.id,
        label: entry.exercise.name,
        detail: `${entry.sets.length} ${entry.sets.length === 1 ? 'set' : 'sets'}`,
      })),
    [detail],
  );

  /**
   * Writes the order the sheet came back with, then re-reads.
   *
   * Replayed as single moves rather than written as a block, which is what
   * keeps the usual drag to one row: `reorder()` takes a midpoint where it can
   * and only renumbers when the gap between two neighbours is spent. The
   * working copy is advanced with each hop so the next one is computed against
   * the positions the last one produced.
   *
   * A reload rather than an optimistic reorder of `detail`: this screen has no
   * live query, so storage is the only thing that knows the new order, and the
   * write is fast enough that the list does not visibly wait for it.
   */
  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      setReordering(false);

      void (async () => {
        let rows: PositionedRow[] = (detail?.exercises ?? []).map((entry) => ({
          id: entry.routineExercise.id,
          position: entry.routineExercise.position,
        }));

        const writes = new Map<string, PositionedRow>();

        orderedIds.forEach((rowId, target) => {
          const from = rows.findIndex((row) => row.id === rowId);
          if (from === -1 || from === target) return;

          const moved = reorder(rows, from, target);
          if (moved.length === 0) return;

          const byId = new Map(moved.map((row) => [row.id, row.position]));
          rows = rows
            .map((row) => ({ ...row, position: byId.get(row.id) ?? row.position }))
            .sort((a, b) => a.position - b.position);

          // Last write wins: a row nudged twice while replaying the hops only
          // needs the position it ended on.
          for (const row of moved) writes.set(row.id, row);
        });

        if (writes.size === 0) return;

        haptics.selection();
        await applyRoutineExerciseOrder([...writes.values()]);

        /*
         * A drag is a superset control whether or not it meant to be: dropping
         * an exercise between two halves of a pair leaves two lifts carrying a
         * group id with something standing between them, which is no longer a
         * superset. `rows` is already in the order the sheet produced, so the
         * grouping is read back off it and whatever no longer holds is cleared.
         *
         * Usually this writes nothing and returns without a statement.
         */
        const groups = new Map(
          (detail?.exercises ?? []).map((entry) => [
            entry.routineExercise.id,
            entry.routineExercise.supersetGroup,
          ]),
        );

        await applyRoutineSupersetGroups(
          normalizeSupersets(
            rows.map((row) => ({ id: row.id, supersetGroup: groups.get(row.id) ?? null })),
          ),
        );

        await reload();
      })();
    },
    [detail, reload],
  );

  // Read on focus rather than in a mount effect. Nothing on this screen is a
  // live query, so a mount-only read would go on showing whatever storage held
  // when the editor was first opened; running it on focus also keeps the
  // setState off the render path, where it forces a second pass before the
  // first frame.
  useDeferredFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // Exercises picked in the modal arrive through the hand-off store.
  useEffect(() => {
    if (pendingExerciseIds.length === 0) return;

    void (async () => {
      for (const exerciseId of pendingExerciseIds) {
        await addExerciseToRoutine(id, exerciseId);
      }
      clearPendingExercises(pickerAddress);
      await reload();
    })();
  }, [pendingExerciseIds, id, reload, clearPendingExercises, pickerAddress]);

  // Replace rather than push: once the session is running, backing out of it
  // should land on the workout tab, not on the editor for the routine that is
  // already open on screen behind it.
  const goToActive = () => router.replace('/workout/active');

  const begin = async () => {
    // The latch is the ref, not the state that drives the spinner: two taps
    // inside one frame would both read the pre-render state and get through.
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(true);

    try {
      const outcome = await startSession({
        create: () => startWorkout({ routineId: id }),
        resumes: (open) => open.routineId === id,
        openExisting: goToActive,
      });

      if (outcome === 'started' || outcome === 'resumed') goToActive();
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  };

  /*
   * `?start=<token>` starts the session on arrival.
   *
   * How the routines widget on the home screen begins a workout: the row's link
   * lands here and this runs the same `begin` the Start button runs. It is
   * deliberately not a separate path — the one-session rule, the resume case and
   * the "a workout is in progress" dialog are all decisions `startSession` makes
   * once, and a widget that re-made any of them would be a second opinion about
   * the most destructive question this app asks.
   *
   * The token, and why a flag would not do, are in `use-launch-action.ts`.
   */
  useLaunchAction(start, () => {
    void begin();
  });

  const confirmDelete = () => {
    void (async () => {
      const confirmed = await showConfirm({
        title: 'Delete routine',
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
      });
      if (!confirmed) return;

      await deleteRoutine(id);
      router.back();
    })();
  };

  if (!detail) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        <Stack.Screen options={{ title: 'Routine' }} />
      </Screen>
    );
  }

  const folderName =
    folders.find((folder) => folder.id === detail.routine.folderId)?.name ?? 'No folder';
  const canPinNotes = Boolean(detail.routine.notes || detail.routine.isNotesPinned);

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: detail.routine.name,
          headerRight: () => (
            <View style={styles.headerActions}>
              {/* Only once there is an order to change. A reorder control above
                  a one-exercise routine is a button that cannot do anything,
                  and this is the screen where a routine is built up from
                  nothing, so it would spend its first minutes dead. */}
              {detail.exercises.length > 1 && (
                <HeaderAction
                  label="Reorder exercises"
                  icon="swap-vertical-outline"
                  onPress={() => setReordering(true)}
                />
              )}
              {/* Between reorder and delete, which is where it belongs by
                  consequence: the two either side of it change this routine and
                  this one only copies it out. */}
              <HeaderAction
                label="Share routine"
                icon="share-outline"
                disabled={sharing}
                onPress={() => share(() => buildRoutineShare(id))}
              />
              <HeaderAction
                label="Delete routine"
                icon="trash-outline"
                tone="danger"
                onPress={confirmDelete}
              />
            </View>
          ),
        }}
      />

      <ScrollView
        {...scrollEdge.list}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {/* The facts about the routine that live on the row rather than on its
            sets. Same card the session editor uses for name / duration / started,
            so the two editors open on the same kind of object. */}
        <Card padded={false} style={styles.meta}>
          <ListRow
            icon="text-outline"
            title={detail.routine.name}
            subtitle="Name"
            onPress={() => setRenaming(true)}
          />
          {folders.length > 0 && (
            <>
              <Divider inset={spacing.lg} />
              <ListRow
                icon="folder-outline"
                title={folderName}
                subtitle="Folder"
                onPress={() => setPickingFolder(true)}
              />
            </>
          )}
          <Divider inset={spacing.lg} />
          <ListRow
            icon="document-text-outline"
            title={detail.routine.notes || 'Add a note'}
            subtitle="Notes"
            onPress={() => setEditingRoutineNotes(true)}
            accessory={
              canPinNotes ? (
                <Pressable
                  onPress={() => {
                    haptics.selection();
                    void updateRoutine(id, {
                      isNotesPinned: !detail.routine.isNotesPinned,
                    }).then(reload);
                  }}
                  hitSlop={HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel={
                    detail.routine.isNotesPinned ? 'Unpin notes' : 'Pin notes'
                  }
                >
                  <Ionicons
                    name={detail.routine.isNotesPinned ? 'pin' : 'pin-outline'}
                    size={18}
                    color={detail.routine.isNotesPinned ? colors.accent : colors.textTertiary}
                  />
                </Pressable>
              ) : undefined
            }
            accessibilityActions={
              canPinNotes
                ? [
                    {
                      name: 'pin',
                      label: detail.routine.isNotesPinned ? 'Unpin notes' : 'Pin notes',
                    },
                  ]
                : undefined
            }
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName !== 'pin') return;
              haptics.selection();
              void updateRoutine(id, {
                isNotesPinned: !detail.routine.isNotesPinned,
              }).then(reload);
            }}
          />
        </Card>

        {detail.exercises.length === 0 ? (
          <EmptyState
            icon="barbell-outline"
            title="No exercises"
            description="Add exercises and prescribe their target sets."
          />
        ) : (
          <>
            <SectionHeader title="Exercises" />
            {clusters.map((cluster, clusterIndex) => {
              const blocks = cluster.entries.map((entry) => (
                <RoutineExerciseBlock
                  key={entry.routineExercise.id}
                  entry={entry}
                  superset={placements.get(entry.routineExercise.id)}
                  onEditSuperset={
                    detail.exercises.length > 1
                      ? () =>
                          showSupersetMenu(
                            supersetRows,
                            entry.routineExercise.id,
                            applySupersets,
                          )
                      : undefined
                  }
                  onReorder={
                    detail.exercises.length > 1 ? () => setReordering(true) : undefined
                  }
                  onEditNotes={() => setEditingExerciseNotesFor(entry.routineExercise.id)}
                  onReload={reload}
                />
              ));

              if (cluster.label) {
                const tone = supersetColor(colors, cluster.label);
                return (
                  <View key={cluster.entries[0]!.routineExercise.id} style={styles.supersetRun}>
                    <View style={[styles.supersetRail, { backgroundColor: tone }]} />
                    <View style={styles.supersetBody}>
                      <Text variant="overline" style={{ color: tone, paddingHorizontal: spacing.lg }}>
                        {`Superset ${cluster.label}`}
                      </Text>
                      {blocks}
                    </View>
                  </View>
                );
              }

              return (
                <View key={cluster.entries[0]!.routineExercise.id}>
                  {clusterIndex > 0 && <Divider />}
                  {blocks}
                </View>
              );
            })}
          </>
        )}

        <View style={styles.actions}>
          <Button
            title="Add exercise"
            icon="add"
            fullWidth
            onPress={() => {
              // The routine's current exercises travel with the request, so the
              // picker suggests what usually trains alongside them.
              openPicker(
                pickerAddress,
                detail.exercises.map((entry) => entry.exercise.id),
              );
              router.push('/exercise/picker');
            }}
          />
          <Button
            // With this routine's own session already open, going through is a
            // resume; the old label promised a fresh session it never created.
            title={resuming ? 'Resume routine' : 'Start routine'}
            variant="success"
            fullWidth
            loading={starting}
            disabled={detail.exercises.length === 0}
            onPress={() => void begin()}
          />
        </View>
      </ScrollView>

      <PromptModal
        visible={renaming}
        title="Rename routine"
        initialValue={detail.routine.name}
        placeholder="Routine name"
        maxLength={60}
        onCancel={() => setRenaming(false)}
        onConfirm={(value) => {
          setRenaming(false);
          void updateRoutine(id, { name: value }).then(reload);
        }}
      />

      <PromptModal
        visible={editingRoutineNotes}
        title="Routine notes"
        initialValue={detail.routine.notes ?? ''}
        placeholder="Add a note..."
        maxLength={500}
        multiline
        onCancel={() => setEditingRoutineNotes(false)}
        onConfirm={(value) => {
          setEditingRoutineNotes(false);
          void updateRoutine(id, { notes: value || null }).then(reload);
        }}
      />

      <PromptModal
        visible={!!editingExerciseNotesFor}
        title="Exercise notes"
        initialValue={
          detail.exercises.find((e) => e.routineExercise.id === editingExerciseNotesFor)
            ?.routineExercise.notes ?? ''
        }
        placeholder="Add a note..."
        maxLength={500}
        multiline
        onCancel={() => setEditingExerciseNotesFor(null)}
        onConfirm={(value) => {
          if (editingExerciseNotesFor) {
            const notesId = editingExerciseNotesFor;
            setEditingExerciseNotesFor(null);
            void updateRoutineExercise(notesId, { notes: value || null }).then(reload);
          } else {
            setEditingExerciseNotesFor(null);
          }
        }}
      />

      {pickingFolder ? (
        <FilterSheet visible label="Folder" onClose={() => setPickingFolder(false)}>
          <OptionList
            options={[
              { value: 'none', label: 'No folder' },
              ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
            ]}
            value={detail.routine.folderId ?? 'none'}
            onChange={(value) => {
              setPickingFolder(false);
              void updateRoutine(id, { folderId: value === 'none' ? null : value }).then(reload);
            }}
          />
        </FilterSheet>
      ) : null}

      <ReorderSheet
        visible={reordering}
        title="Reorder exercises"
        items={reorderItems}
        onClose={() => setReordering(false)}
        onCommit={handleReorder}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  scroll: { flex: 1 },
  // No horizontal padding: the exercise blocks carry the screen margin
  // themselves and their dividers run edge to edge, so everything else here
  // takes its own margin. Same contract as the logging screen.
  content: { paddingBottom: spacing.huge },
  meta: { margin: spacing.lg, marginBottom: spacing.md },
  supersetRun: {
    flexDirection: 'row',
    marginVertical: spacing.sm,
    paddingRight: 0,
  },
  supersetRail: {
    width: 3,
    borderRadius: 2,
    marginLeft: spacing.lg,
    marginVertical: spacing.xs,
  },
  supersetBody: { flex: 1, minWidth: 0 },
  actions: { padding: spacing.lg, gap: spacing.sm, marginTop: spacing.lg },
});
