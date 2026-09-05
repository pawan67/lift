import {
  BODY_PART_LABELS,
  DATE_LONG,
  formatDateTime,
  formatDurationShort,
  formatVolume,
} from '@lift/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BarChart, type BarDatum } from '@/components/charts/bar-chart';
import {
  Button,
  Card,
  HeaderAction,
  PromptModal,
  Screen,
  SectionHeader,
  StatBand,
  Text,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import { db } from '@/db/client';
import { personalRecords } from '@/db/schema';
import { workoutMuscleSplit } from '@/features/analytics/muscle-stats';
import { bodyPartColor } from '@/features/analytics/tones';
import { ExerciseSetList } from '@/features/workouts/exercise-set-list';
import {
  deleteWorkout,
  getWorkoutDetail,
  repeatWorkout,
  updateWorkoutFields,
  type WorkoutDetail,
} from '@/features/workouts/repository';
import { startSession } from '@/features/workouts/start-session';
import { resolveExerciseUnits, useAppUnits } from '@/features/exercises/units';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { showAlert, showConfirm } from '@/store/dialog';
import { spacing, useColors } from '@/theme';
import { buildSessionShare } from '@/features/share';
import { useShare } from '@/features/share/use-share';

export default function WorkoutDetailScreen() {
  const scrollEdge = useScrollEdge();
  const colors = useColors();
  const { sharing, share } = useShare();

  const { id } = useLocalSearchParams<{ id: string }>();
  // The app-wide pair, which the session's own totals are printed in and which
  // each exercise falls back to when it has no unit of its own.
  const appUnits = useAppUnits();
  const { weightUnit } = appUnits;

  const [detail, setDetail] = useState<WorkoutDetail | null>(null);
  const [prSetIds, setPrSetIds] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    const loaded = await getWorkoutDetail(id);
    setDetail(loaded ?? null);

    const records = await db
      .select({ setId: personalRecords.setId })
      .from(personalRecords)
      .where(and(eq(personalRecords.workoutId, id), isNull(personalRecords.deletedAt)));

    setPrSetIds(new Set(records.map((row) => row.setId).filter((value): value is string => !!value)));
  }, [id]);

  // Read on focus rather than in a mount effect. Nothing on this screen is a
  // live query, so a mount-only read would go on showing whatever storage held
  // when it was first opened; running it on focus also keeps the setState off
  // the render path, where it forces a second pass before the first frame.
  useDeferredFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const rename = async (name: string) => {
    await updateWorkoutFields(id, { name });
    await reload();
  };

  const openActive = () => router.push('/workout/active');

  const repeat = async () => {
    // The latch is the ref, not the state that drives the spinner: two taps
    // inside one frame would both read the pre-render state and get through.
    if (inFlight.current) return;
    inFlight.current = true;
    setRepeating(true);

    try {
      // No `resumes` predicate: repeating always means a new session, so an
      // open one is never the thing being asked for, even when it came from the
      // same routine.
      const outcome = await startSession({
        create: () => repeatWorkout(id),
        openExisting: openActive,
      });

      if (outcome === 'started') openActive();
    } finally {
      inFlight.current = false;
      setRepeating(false);
    }
  };

  const confirmDelete = () => {
    void (async () => {
      const confirmed = await showConfirm({
        title: 'Delete workout',
        message: 'This session, its sets and any records it set will be removed.',
        confirmLabel: 'Delete',
      });
      if (!confirmed) return;

      try {
        // The repository owns the order. Records, then sets, then the session.
        // Deleting the row here left a mistyped record behind to gate every
        // future PR for that exercise.
        await deleteWorkout(id);
        router.back();
      } catch (error) {
        void showAlert(
          'Could not delete the workout',
          error instanceof Error ? error.message : 'The session is still here.',
        );
      }
    })();
  };

  // Above the loading guard, because hooks cannot be conditional.
  const split = useMemo<BarDatum[]>(() => {
    if (!detail) return [];

    // The same ink as Home's 30-day chart, and sorted by share, so the largest
    // slice takes the marked weight and the rest sit a step behind it. See
    // `tones.ts` for what this used to be and why it is not a hue any more.
    return workoutMuscleSplit(detail.exercises).map((slice, index) => ({
      label: BODY_PART_LABELS[slice.bodyPart],
      value: slice.share * 100,
      color: bodyPartColor(slice.bodyPart, colors, index === 0),
    }));
  }, [detail, colors]);

  if (!detail) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        <Stack.Screen options={{ title: 'Workout' }} />
      </Screen>
    );
  }

  const { workout, exercises } = detail;

  const startedAt = formatDateTime(workout.startedAt, DATE_LONG);

  const [volume, volumeUnit] = splitMeasure(formatVolume(workout.totalVolumeKg, weightUnit));

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: workout.name,
          headerRight: () => (
            // Two actions at the same end of the header, so they need a gap of
            // their own: each one's frame already reaches inwards for its touch
            // target, and without this the two frames would meet.
            <View style={styles.headerActions}>
              {/* Edit before Delete, and a glyph each. A session is corrected
                  far more often than it is thrown away: a weight typed into
                  the wrong row, a set logged twice, a timer left running, and
                  until this existed the only remedy for any of them was the
                  button beside it. */}
              <HeaderAction
                label="Edit workout"
                icon="create-outline"
                onPress={() => router.push({ pathname: '/workout/edit/[id]', params: { id } })}
              />
              <HeaderAction
                label="Share workout"
                icon="share-outline"
                disabled={sharing}
                onPress={() => share(() => buildSessionShare(id))}
              />
              <HeaderAction
                label="Delete workout"
                icon="trash-outline"
                tone="danger"
                onPress={confirmDelete}
              />
            </View>
          ),
        }}
      />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        {/* `title`, the same size the summary screen sets this same object at.
            The date has to stay inside the label: supplying one on the
            Pressable replaces the merged child text, so naming only the workout
            would tell a screen reader less than the silent version did. */}
        <Pressable
          onPress={() => setRenaming(true)}
          style={styles.titleBlock}
          accessibilityRole="button"
          accessibilityLabel={`${workout.name}, ${startedAt}`}
          accessibilityHint="Renames this workout"
        >
          <Text variant="title">{workout.name}</Text>
          <Text variant="label" color="textSecondary">
            {startedAt}
          </Text>
        </Pressable>

        {/* One stat grammar across the app: overline labels over tabular
            figures: not 15px numbers in a rounded box, which is what made this
            session's four figures read differently here than on the summary
            screen one tap away. Four across a phone is one too many for a
            single band once a six-digit volume is one of them, so they run as
            two of two, paired by kind, and read as a 2×2 grid. */}
        <View style={styles.band}>
          <StatBand
            items={[
              { label: 'Duration', value: formatDurationShort(workout.durationSeconds ?? 0) },
              { label: 'Volume', value: volume, unit: volumeUnit },
            ]}
          />
          <StatBand
            items={[
              { label: 'Sets', value: String(workout.totalSets) },
              { label: 'Records', value: String(workout.prCount) },
            ]}
          />
        </View>

        {workout.notes ? (
          <Card style={styles.notes}>
            <Text variant="label" color="textSecondary">
              {workout.notes}
            </Text>
          </Card>
        ) : null}

        {/* Percentages of the session's completed working sets, primary muscle
            only: see `workoutMuscleSplit` for why the secondary discount the
            statistics screens apply is deliberately not used here. */}
        {split.length > 0 && (
          <>
            <SectionHeader title="Muscle split" />
            <View style={styles.chart}>
              <BarChart data={split} formatValue={(value) => `${Math.round(value)}%`} />
            </View>
          </>
        )}

        <SectionHeader title="Workout" />

        {/* Each block reads in its own exercise's units: the dumbbell press in
            pounds under a session whose volume total is in kilos. The total is
            the app's unit because it is a sum across exercises that may not
            agree, and a number added up from two units has to be printed in one
            of them: the one the user set for the app. `resolveExerciseUnits`
            rather than the hook, because this is a map and a hook cannot be. */}
        {exercises.map((entry) => {
          const units = resolveExerciseUnits(entry.exercise, appUnits);

          return (
            <ExerciseSetList
              key={entry.workoutExercise.id}
              exerciseId={entry.exercise.id}
              name={entry.exercise.name}
              thumbnailUrl={entry.exercise.thumbnailUrl}
              notes={entry.workoutExercise.notes}
              sets={entry.sets}
              recordSetIds={prSetIds}
              weightUnit={units.weightUnit}
              distanceUnit={units.distanceUnit}
            />
          );
        })}

        <View style={styles.repeat}>
          <Button
            title="Repeat workout"
            variant="secondary"
            fullWidth
            loading={repeating}
            onPress={() => void repeat()}
          />
          {/* Said plainly here so the empty fields are not a surprise: the copy
              carries the structure, and the numbers are already one column away
              in Previous. */}
          <Text variant="caption" color="textTertiary">
            Copies the exercises and set structure, not the weights and reps.
          </Text>
        </View>
      </ScrollView>

      <PromptModal
        visible={renaming}
        title="Rename workout"
        initialValue={workout.name}
        onCancel={() => setRenaming(false)}
        onConfirm={(value) => {
          setRenaming(false);
          void rename(value);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // No horizontal padding: the set rows stripe edge to edge, so every other
  // block carries the screen margin itself. See `ExerciseSetList`.
  content: { paddingBottom: spacing.huge },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  titleBlock: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  band: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  notes: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  chart: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  repeat: { margin: spacing.lg, marginTop: spacing.xxl, gap: spacing.sm },
});
