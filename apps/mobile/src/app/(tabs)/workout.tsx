import { Ionicons } from '@expo/vector-icons';
import { DATE_MEDIUM, formatDateTime, formatDuration, reorder, type PositionedRow } from '@lift/shared';
import { and, asc, desc, isNull } from 'drizzle-orm';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  EmptyState,
  ListRow,
  PressableScale,
  PromptModal,
  ReorderSheet,
  Screen,
  SectionHeader,
  Sheet,
  SheetScrollView,
  Text,
  useScrollEdge,
  type ReorderItem,
} from '@/components/ui';
import { db } from '@/db/client';
import { routines as routinesTable, routineFolders, workouts, type Routine, type RoutineFolder } from '@/db/schema';
import { useRows } from '@/db/use-rows';
import {
  assignRoutinesToFolder,
  createRoutineFolder,
  updateRoutineFolder,
  deleteRoutineFolder,
  applyRoutineOrder,
  applyFolderOrder,
  updateRoutine,
} from '@/features/routines/repository';
import { startWorkout } from '@/features/workouts/repository';
import { startSession } from '@/features/workouts/start-session';
import { haptics } from '@/features/feedback/haptics';
import { useLaunchAction } from '@/hooks/use-launch-action';
import { useTicker } from '@/hooks/use-ticker';
import { showDialog } from '@/store/dialog';
import {
  controlHeight,
  HIT_SLOP,
  PRESS_SCALE_SMALL,
  radius,
  spacing,
  useColors,
} from '@/theme';

/** Latch key for the ad-hoc Start, which has no routine id to be keyed by. */
const EMPTY_START = 'empty';

/** Sentinel id for the locked "Other routines" row in the outline reorder. */
const UNFILED = '__unfiled__';

export default function WorkoutScreen() {
  const scrollEdge = useScrollEdge();

  const { start } = useLocalSearchParams<{ start?: string }>();

  const colors = useColors();

  // Newest first and capped at one: two open sessions should be impossible, but
  // an unordered query made "the active workout" whichever row SQLite handed
  // back first, which is not a promise SQLite makes.
  const { rows: activeRows, loaded: activeLoaded } = useRows(
    db
      .select()
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt))
      .limit(1),
  );

  const { rows: routines, loaded: routinesLoaded } = useRows(
    db
      .select()
      .from(routinesTable)
      .where(isNull(routinesTable.deletedAt))
      .orderBy(asc(routinesTable.position)),
  );

  const { rows: folders, loaded: foldersLoaded } = useRows(
    db
      .select()
      .from(routineFolders)
      .where(isNull(routineFolders.deletedAt))
      .orderBy(asc(routineFolders.position)),
  );

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState<{id: string, name: string} | null>(null);
  const [assigningToFolder, setAssigningToFolder] = useState<{ id: string; name: string } | null>(null);
  const [reordering, setReordering] = useState(false);

  const active = activeRows[0];
  const now = useTicker(1000, Boolean(active));

  // Which Start control is mid-flight, or null. Session creation is a round
  // trip to disk, so an unlatched second tap would ask for a second session and
  // the loser of that race would fail silently. Held as an id rather than a
  // boolean so only the control that was pressed shows the spinner.
  const [starting, setStarting] = useState<string | null>(null);
  // The latch itself is a ref, not the state above: two taps inside one frame
  // would both read the pre-render state and both get through.
  const inFlight = useRef(false);

  const openActive = () => router.push('/workout/active');

  const newRoutineIn = (folderId: string) =>
    router.push({ pathname: '/routine/new', params: { folderId } });

  const openFolderMenu = (
    folder: (typeof folders)[0],
    options: { empty: boolean; canAddExisting: boolean },
  ) => {
    const addActions = options.empty
      ? []
      : [
          {
            label: 'Add new routine',
            onPress: () => newRoutineIn(folder.id),
          },
          ...(options.canAddExisting
            ? [
                {
                  label: 'Add existing routine',
                  onPress: () => setAssigningToFolder({ id: folder.id, name: folder.name }),
                },
              ]
            : []),
        ];

    void showDialog({
      title: folder.name,
      actions: [
        ...addActions,
        {
          label: 'Rename folder',
          onPress: () => setEditingFolder({ id: folder.id, name: folder.name }),
        },
        {
          label: 'Delete folder',
          style: 'destructive',
          onPress: () => {
            void showDialog({
              title: 'Delete folder?',
              message: 'The routines inside will not be deleted.',
              actions: [
                {
                  label: 'Delete',
                  style: 'destructive',
                  onPress: () => void deleteRoutineFolder(folder.id).then(() => {}),
                },
                { label: 'Cancel', style: 'cancel' },
              ],
            });
          },
        },
        { label: 'Cancel', style: 'cancel' },
      ],
    });
  };

  const begin = async (routineId?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(routineId ?? EMPTY_START);

    try {
      const outcome = await startSession({
        create: () => startWorkout(routineId ? { routineId } : {}),
        // An open session started from the same routine, or an open ad-hoc
        // session when the tap was "start empty". Is the thing being asked
        // for. Going through is a resume, not a second session.
        resumes: (open) => open.routineId === (routineId ?? null),
        openExisting: openActive,
      });

      if (outcome === 'started' || outcome === 'resumed') openActive();
    } finally {
      inFlight.current = false;
      setStarting(null);
    }
  };

  const folderNameById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders],
  );

  const outlineItems = useMemo<ReorderItem[]>(() => {
    const items: ReorderItem[] = [];
    for (const folder of folders) {
      const kids = routines.filter((routine) => routine.folderId === folder.id);
      items.push({
        id: folder.id,
        label: folder.name,
        detail: folderCountLabel(kids.length),
        group: true,
        icon: 'folder',
      });
      for (const routine of kids) {
        items.push({
          id: routine.id,
          label: routine.name,
        });
      }
    }
    const unfiled = routines.filter((routine) => !routine.folderId);
    if (folders.length > 0) {
      items.push({ id: UNFILED, label: 'Other routines', locked: true });
    }
    for (const routine of unfiled) {
      items.push({
        id: routine.id,
        label: routine.name,
      });
    }
    return items;
  }, [folders, routines]);

  const assignItems = useMemo(
    () =>
      assigningToFolder
        ? routines
            .filter((routine) => routine.folderId !== assigningToFolder.id)
            .map((routine) => ({
              id: routine.id,
              label: routine.name,
              detail: routine.folderId
                ? (folderNameById.get(routine.folderId) ?? undefined)
                : undefined,
            }))
        : [],
    [assigningToFolder, routines, folderNameById],
  );

  const handleAssign = useCallback(
    (ids: string[]) => {
      const folderId = assigningToFolder?.id;
      setAssigningToFolder(null);
      if (!folderId || ids.length === 0) return;
      void assignRoutinesToFolder(folderId, ids);
    },
    [assigningToFolder],
  );

  /**
   * Writes the outline the sheet came back with: folder order, which routines
   * sit in which folder, and sibling order inside each pile.
   *
   * Replayed as single moves per list, the same way the rest of the app does:
   * `reorder()` takes a midpoint where it can. A routine that changed folder
   * is a membership write first, then a position write in its new pile.
   */
  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      setReordering(false);

      const folderIds = new Set(folders.map((folder) => folder.id));
      const { folderOrder, groups } = parseOutline(orderedIds, folderIds);

      const folderWrites = replayPositions(
        folders.map((folder) => ({ id: folder.id, position: folder.position })),
        folderOrder,
      );

      const membership: { id: string; folderId: string | null }[] = [];
      const positionWrites: PositionedRow[] = [];

      for (const [folderId, ids] of groups) {
        const rows = ids
          .flatMap((id) => {
            const routine = routines.find((row) => row.id === id);
            return routine ? [{ id: routine.id, position: routine.position }] : [];
          })
          .sort((a, b) => a.position - b.position);
        positionWrites.push(...replayPositions(rows, ids));

        for (const id of ids) {
          const routine = routines.find((row) => row.id === id);
          if (routine && routine.folderId !== folderId) {
            membership.push({ id, folderId });
          }
        }
      }

      if (folderWrites.length === 0 && membership.length === 0 && positionWrites.length === 0) {
        return;
      }

      haptics.selection();
      void (async () => {
        for (const { id, folderId } of membership) {
          await updateRoutine(id, { folderId });
        }
        await applyFolderOrder(folderWrites);
        await applyRoutineOrder(positionWrites);
      })();
    },
    [folders, routines],
  );

  /*
   * `?start=<token>` starts an ad-hoc session on arrival.
   *
   * The last row of the routines widget on the home screen. A routine's row
   * carries the same parameter to `/routine/[id]`; this is the same instruction
   * with no routine behind it, so it runs the same `begin` the Start button on
   * this screen runs and inherits every decision `startSession` makes.
   *
   * Placed above the loading gate on purpose: hooks cannot be conditional, and
   * `begin` reads the database itself rather than the rows this screen is
   * waiting on.
   */
  useLaunchAction(start, () => {
    void begin();
  });

  /*
   * Both queries seed `[]` and answer a tick later, and this tab is where a
   * cold start lands. Without the gate the routine list opens on "No routines
   * yet" for a user who has routines, and `active` is briefly undefined, so
   * the resume card is missing, the button offers to start a second session,
   * and a tap inside that window reaches `begin` with `resumes` false, which
   * silently discards the open workout.
   */
  if (!activeLoaded || !routinesLoaded) {
    return <Screen scrolled={scrollEdge.progress}>{null}</Screen>;
  }

  return (
    <Screen scrolled={scrollEdge.progress}>
      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        {active && (
          <PressableScale
            onPress={openActive}
            accessibilityRole="button"
            // The label replaces the merged child text, which is the point: the
            // clock inside this card reads a second later on every frame, so an
            // announcement built from the children would never settle.
            accessibilityLabel={`Resume ${active.name}`}
            accessibilityHint="Opens the workout in progress"
            /*
             * The one card on this screen that is a card, so it presses like
             * one. It was dimming to 0.85 on the frame the finger landed and
             * back on the frame it lifted, with nothing in between: the fastest
             * possible way to say nothing. The scale is the standard object
             * press, and the tint holds, because a card that both shrinks and
             * fades is doing the same job twice.
             */
            style={[styles.resume, { backgroundColor: colors.accentSurface }]}
          >
            <View style={styles.resumeBody}>
              {/* The tint and the running clock are one accent object; the
                  kicker and the chevron are reinforcements that only spread
                  the accent thinner. */}
              <Text variant="overline" color="textSecondary">
                In progress
              </Text>
              <Text variant="bodyMedium" numberOfLines={1}>
                {active.name}
              </Text>
              <Text variant="numericLarge" color="accent">
                {formatDuration(Math.floor((now - active.startedAt.getTime()) / 1000))}
              </Text>
            </View>
            {/*
             * A play glyph rather than the chevron it was.
             *
             * The chevron said "this opens something", which is all it needed
             * to say while a labelled Resume button sat underneath naming the
             * action. Now that this card is the only way back into the
             * session, the glyph is carrying the verb and has to be the verb.
             *
             * Still `textTertiary`. The accent budget on this card is spent on
             * the tint and the running clock, which are one object, and a third
             * accented mark would only spread it thinner.
             */}
            <Ionicons name="play" size={22} color={colors.textTertiary} />
          </PressableScale>
        )}

        {/*
         * The empty start, and only when there is nothing to return to.
         *
         * This button used to relabel itself to "Resume workout" while a
         * session was live, which put two controls with one destination
         * against each other in the same viewport: the card above it and a
         * full-width button an `lg` below, both opening the same screen. Two
         * ways to do one thing is not twice as easy to do, it is one question
         * about whether they differ.
         *
         * The card wins the pairing because it is the one that can answer
         * that question: it names the session and prints its running clock, so
         * it says what resuming would resume. A button can only say the verb.
         * Nothing is lost by dropping it here either, because a second empty
         * session cannot exist while this one is open: `startSession` resolves
         * that into a resume, which is what the card already offers.
         */}
        {!active && (
          <View style={styles.quickStart}>
            <Button
              title="Start empty workout"
              icon="add"
              size="lg"
              fullWidth
              loading={starting === EMPTY_START}
              onPress={() => void begin()}
            />
          </View>
        )}

        <SectionHeader
          title="Routines"
          action={
            <View style={styles.headerActions}>
              {/*
               * Two accent labels, not two filled controls.
               *
               * These were one 36pt pill split down the middle by a hairline:
               * a `surfaceMuted` container, an internal rule, and two halves
               * inside it. Three pieces of chrome to hold two words, in the
               * one place on the screen that is already a heading. It also
               * made this the only `SectionHeader` in the app carrying a
               * filled control, so the section that opens the Routines list
               * announced itself louder than the routines under it.
               *
               * The colour is the affordance. An accent word beside a
               * `textSecondary` heading is unambiguously a thing to tap, which
               * is the same bargain the rest of the app already makes for its
               * header actions, and it is one element instead of four.
               *
               * The glyphs stay because they are what distinguishes the pair
               * without a rule between them: a plus and a folder read as two
               * actions where "Routine Folder" in one accent would read as one
               * phrase. `HIT_SLOP` is what a 16pt label needs to be a target
               * once the pill that used to give it 36pt of height is gone.
               */}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="New routine"
                onPress={() => router.push('/routine/new')}
                hitSlop={HIT_SLOP}
                // Dim, not scale: a `label` at 0.97 is a change nobody can
                // see. The reorder glyph beside it can take a scale because it
                // is a glyph; these two cannot because they are type.
                dimTo={0.5}
                scaleTo={1}
                style={styles.createAction}
              >
                <Ionicons name="add" size={16} color={colors.accent} />
                <Text variant="label" color="accent">
                  Routine
                </Text>
              </PressableScale>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="New folder"
                onPress={() => setCreatingFolder(true)}
                hitSlop={HIT_SLOP}
                dimTo={0.5}
                scaleTo={1}
                style={styles.createAction}
              >
                <Ionicons name="folder-outline" size={16} color={colors.accent} />
                <Text variant="label" color="accent">
                  Folder
                </Text>
              </PressableScale>
              {folders.length + routines.length > 1 && (
                <PressableScale
                  onPress={() => setReordering(true)}
                  hitSlop={HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel="Reorder"
                  // A bare glyph, so it takes the deeper press: the standard 3%
                  // on a 20pt icon is not a state anyone can see.
                  scaleTo={PRESS_SCALE_SMALL}
                  dimTo={0.6}
                  // The same box the two labels carry, so all three sit on one
                  // row rather than three different heights centred against
                  // each other. See `createAction`.
                  style={styles.headerGlyph}
                >
                  <Ionicons name="swap-vertical-outline" size={20} color={colors.textSecondary} />
                </PressableScale>
              )}
            </View>
          }
        />

        {routines.length === 0 && folders.length === 0 ? (
          <EmptyState
            icon="list-outline"
            title="No routines yet"
            description="Create one from scratch, or import your workouts and routines from another app."
            action={
              <View style={styles.emptyActions}>
                <Button title="Create routine" fullWidth onPress={() => router.push('/routine/new')} />
                <Button
                  title="Import from another app"
                  icon="download-outline"
                  variant="secondary"
                  fullWidth
                  onPress={() => router.push('/import')}
                />
              </View>
            }
          />
        ) : (
          <View style={{ gap: spacing.xl }}>
            {folders.map((folder) => {
              const folderRoutines = routines.filter((r) => r.folderId === folder.id);
              const existingOutside = routines.filter((r) => r.folderId !== folder.id);
              return (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  routines={folderRoutines}
                  canAddExisting={existingOutside.length > 0}
                  activeRoutineId={active?.routineId}
                  starting={starting}
                  onMenu={() =>
                    openFolderMenu(folder, {
                      empty: folderRoutines.length === 0,
                      canAddExisting: existingOutside.length > 0,
                    })
                  }
                  onAddNew={() => newRoutineIn(folder.id)}
                  onAddExisting={() => setAssigningToFolder({ id: folder.id, name: folder.name })}
                  onOpenRoutine={(id) => router.push({ pathname: '/routine/[id]', params: { id } })}
                  onStart={(id) => void begin(id)}
                />
              );
            })}

            {routines.filter((r) => !r.folderId).length > 0 && (
              <View>
                {folders.length > 0 && <SectionHeader title="Other routines" />}
                <Card padded={false} style={styles.routineCard}>
                  {routines
                    .filter((r) => !r.folderId)
                    .map((routine, index) => (
                      <View key={routine.id}>
                        {index > 0 && <Divider inset={spacing.lg} />}
                        <RoutineEntry
                          routine={routine}
                          active={active?.routineId === routine.id}
                          starting={starting === routine.id}
                          onOpen={() =>
                            router.push({ pathname: '/routine/[id]', params: { id: routine.id } })
                          }
                          onStart={() => void begin(routine.id)}
                        />
                      </View>
                    ))}
                </Card>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <ReorderSheet
        visible={reordering}
        title="Reorder"
        items={outlineItems}
        onClose={() => setReordering(false)}
        onCommit={handleReorder}
      />

      <AssignRoutinesSheet
        key={assigningToFolder?.id ?? 'closed'}
        visible={assigningToFolder !== null}
        folderName={assigningToFolder?.name ?? ''}
        items={assignItems}
        onClose={() => setAssigningToFolder(null)}
        onCommit={handleAssign}
      />

      <PromptModal
        visible={creatingFolder}
        title="New folder"
        placeholder="Folder name"
        maxLength={60}
        onCancel={() => setCreatingFolder(false)}
        onConfirm={(name) => {
          setCreatingFolder(false);
          if (name.trim()) {
            void createRoutineFolder(name.trim());
          }
        }}
      />
      <PromptModal
        visible={!!editingFolder}
        title="Rename folder"
        initialValue={editingFolder?.name}
        placeholder="Folder name"
        onCancel={() => setEditingFolder(null)}
        onConfirm={(name) => {
          if (editingFolder) {
            void updateRoutineFolder(editingFolder.id, name).then(() => {});
            setEditingFolder(null);
          }
        }}
      />
    </Screen>
  );
}

function folderCountLabel(count: number) {
  if (count === 0) return 'Empty';
  if (count === 1) return '1 routine';
  return `${count} routines`;
}

function parseOutline(orderedIds: string[], folderIds: Set<string>) {
  const folderOrder: string[] = [];
  const groups = new Map<string | null, string[]>();
  let current: string | null | undefined;

  for (const id of folderIds) groups.set(id, []);
  groups.set(null, []);

  for (const id of orderedIds) {
    if (id === UNFILED) {
      current = null;
      continue;
    }
    if (folderIds.has(id)) {
      folderOrder.push(id);
      current = id;
      continue;
    }
    const key = current === undefined ? null : current;
    groups.get(key)?.push(id);
  }

  return { folderOrder, groups };
}

function replayPositions(rows: PositionedRow[], orderedIds: string[]): PositionedRow[] {
  let current = [...rows];
  const writes: PositionedRow[] = [];

  orderedIds.forEach((id, target) => {
    const from = current.findIndex((row) => row.id === id);
    if (from === -1 || from === target) return;

    const moved = reorder(current, from, target);
    if (moved.length === 0) return;

    const byId = new Map(moved.map((row) => [row.id, row.position]));
    current = current
      .map((row) => ({ ...row, position: byId.get(row.id) ?? row.position }))
      .sort((a, b) => a.position - b.position);

    writes.push(...moved);
  });

  const final = new Map(writes.map((write) => [write.id, write]));
  return [...final.values()];
}

function RoutineEntry({
  routine,
  active,
  starting,
  onOpen,
  onStart,
}: {
  routine: Routine;
  active: boolean;
  starting: boolean;
  onOpen: () => void;
  onStart: () => void;
}) {
  return (
    <ListRow
      title={routine.name}
      subtitle={
        routine.lastPerformedAt
          ? `Last performed ${formatDateTime(routine.lastPerformedAt, DATE_MEDIUM)}`
          : 'Not performed yet'
      }
      onPress={onOpen}
      accessibilityActions={[{ name: 'start', label: active ? 'Resume' : 'Start' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'start') onStart();
      }}
      accessory={
        <Button
          title={active ? 'Resume' : 'Start'}
          size="sm"
          variant="secondary"
          loading={starting}
          onPress={onStart}
        />
      }
    />
  );
}

function FolderCard({
  folder,
  routines,
  canAddExisting,
  activeRoutineId,
  starting,
  onMenu,
  onAddNew,
  onAddExisting,
  onOpenRoutine,
  onStart,
}: {
  folder: RoutineFolder;
  routines: Routine[];
  canAddExisting: boolean;
  activeRoutineId?: string | null;
  starting: string | null;
  onMenu: () => void;
  onAddNew: () => void;
  onAddExisting: () => void;
  onOpenRoutine: (id: string) => void;
  onStart: (id: string) => void;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(true);
  const empty = routines.length === 0;
  const icon = empty ? 'folder-outline' : expanded ? 'folder-open' : 'folder';

  return (
    <Card padded={false} style={styles.routineCard}>
      <View style={styles.folderHeader}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={folder.name}
          accessibilityHint={folderCountLabel(routines.length)}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((open) => !open)}
          scaleTo={1}
          style={styles.folderToggle}
        >
          <View style={[styles.folderGlyph, { backgroundColor: colors.accentSurface }]}>
            <Ionicons name={icon} size={17} color={colors.accent} />
          </View>
          <View style={styles.folderCopy}>
            <Text variant="bodyMedium" numberOfLines={1}>
              {folder.name}
            </Text>
            <Text variant="caption" color="textTertiary">
              {folderCountLabel(routines.length)}
            </Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-forward'}
            size={16}
            color={colors.textTertiary}
          />
        </PressableScale>
        <PressableScale
          onPress={onMenu}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${folder.name}`}
          scaleTo={PRESS_SCALE_SMALL}
          dimTo={0.6}
          style={styles.folderMore}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
        </PressableScale>
      </View>
      {expanded && (
        <>
          <Divider />
          {empty ? (
            <>
              <ListRow title="Add new routine" icon="add" onPress={onAddNew} />
              {canAddExisting && (
                <>
                  <Divider inset={spacing.lg} />
                  <ListRow title="Add existing routine" icon="list-outline" onPress={onAddExisting} />
                </>
              )}
            </>
          ) : (
            routines.map((routine, index) => (
              <View key={routine.id}>
                {index > 0 && <Divider inset={spacing.lg} />}
                <RoutineEntry
                  routine={routine}
                  active={activeRoutineId === routine.id}
                  starting={starting === routine.id}
                  onOpen={() => onOpenRoutine(routine.id)}
                  onStart={() => onStart(routine.id)}
                />
              </View>
            ))
          )}
        </>
      )}
    </Card>
  );
}

function AssignRoutinesSheet({
  visible,
  folderName,
  items,
  onClose,
  onCommit,
}: {
  visible: boolean;
  folderName: string;
  items: { id: string; label: string; detail?: string }[];
  onClose: () => void;
  onCommit: (ids: string[]) => void;
}) {
  const colors = useColors();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  return (
    <Sheet
      visible={visible}
      label={folderName ? `Add to ${folderName}` : 'Add existing routine'}
      onClose={onClose}
      footer={
        <View style={styles.assignFooter}>
          <Button
            title={selected.size > 0 ? `Add · ${selected.size}` : 'Add'}
            fullWidth
            disabled={selected.size === 0}
            onPress={() => onCommit([...selected])}
          />
        </View>
      }
    >
      <SheetScrollView style={styles.assignList} contentContainerStyle={styles.assignListContent}>
        {items.map((item, index) => {
          const on = selected.has(item.id);
          return (
            <View key={item.id}>
              {index > 0 && <Divider />}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => toggle(item.id)}
                style={({ pressed }) => [
                  styles.assignOption,
                  on && { backgroundColor: colors.accentSurface },
                  pressed && { backgroundColor: colors.surfacePressed },
                ]}
              >
                <View style={styles.assignOptionBody}>
                  <Text variant="bodyMedium" style={on ? { color: colors.accent } : undefined}>
                    {item.label}
                  </Text>
                  {item.detail && (
                    <Text variant="caption" color="textTertiary">
                      {item.detail}
                    </Text>
                  )}
                </View>
                {on ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
              </Pressable>
            </View>
          );
        })}
      </SheetScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  resumeBody: { flex: 1, gap: 2 },
  quickStart: { padding: spacing.lg },
  /*
   * `lg` between the three actions, up from the `md` it was.
   *
   * The pill used to supply the separation: two halves inside one box, with a
   * rule between them and its own edge holding the reorder glyph off. Bare
   * labels have none of that, and at `md` a plus, two words and a glyph run
   * together into one strip of accent. `lg` is the smallest step that reads as
   * three things.
   */
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },

  /*
   * The strip is a row, not a line of type, and the padding is what makes it
   * one.
   *
   * `SectionHeader` closes with `paddingBottom: sm`, and that number was set
   * against a header whose action was a 36pt pill: the gap under the accent
   * labels was the 8 plus the eleven-odd points of pill that hung below the
   * text inside it. Taking the pill away took the eleven with it and left the
   * words sitting almost on the first routine card. The padding puts the box
   * back without putting the fill back, so the header's own `paddingBottom`
   * measures from a row again rather than from a baseline.
   *
   * It is also the target. `hitSlop` covers native and is ignored by React
   * Native Web, so on the desktop layout these were 16pt tall things to hit;
   * real padding is the half of that fix which works everywhere.
   */
  createAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  headerGlyph: { paddingVertical: spacing.sm },
  routineCard: { marginHorizontal: spacing.lg },
  folderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingRight: spacing.md,
  },
  folderToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  folderGlyph: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderCopy: { flex: 1, gap: 2 },
  folderMore: { padding: spacing.sm },
  emptyActions: { alignSelf: 'stretch', gap: spacing.sm, minWidth: 260 },
  assignList: { flexGrow: 0 },
  assignListContent: { paddingBottom: spacing.sm },
  assignFooter: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  assignOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    minHeight: controlHeight.md + 4,
  },
  assignOptionBody: { flex: 1, gap: 2 },
});
