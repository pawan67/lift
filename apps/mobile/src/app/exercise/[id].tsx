import { Ionicons } from '@expo/vector-icons';
import {
  DATE_MEDIUM,
  EQUIPMENT_LABELS,
  formatDateTime,
  formatDistance,
  formatDurationShort,
  formatVolume,
  formatWeight,
  MUSCLE_GROUP_LABELS,
  PR_KIND_LABELS,
  repMaxTable,
  setOneRepMaxKg,
  type AnalyticsContext,
  type DistanceUnit,
  type PrKind,
  type SetLike,
  type WeightUnit,
} from '@lift/shared';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { LineChart, type DataPoint } from '@/components/charts/line-chart';
import {
  Card,
  Divider,
  EmptyState,
  HeaderAction,
  Screen,
  SectionHeader,
  SegmentedControl,
  Text,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import { db } from '@/db/client';
import {
  personalRecords,
  workoutExercises,
  workoutSets,
  workouts,
  type Exercise,
  type WorkoutSet,
} from '@/db/schema';
import { ExerciseMedia } from '@/features/exercises/exercise-media';
import { deleteExercise, getExercise } from '@/features/exercises/repository';
import { useExerciseUnits } from '@/features/exercises/units';
import { ExerciseSetList } from '@/features/workouts/exercise-set-list';
import { showConfirm } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { spacing, useColors, useContentWidth } from '@/theme';

type Tab = 'summary' | 'history';

const TABS = [
  { value: 'summary', label: 'Summary' },
  { value: 'history', label: 'History' },
] as const;

interface HistoryEntry {
  workoutId: string;
  workoutName: string;
  performedAt: Date;
  sets: WorkoutSet[];
}

interface OneRepMaxTrend {
  /** Chronological, y in kilograms. */
  points: DataPoint[];
  latestKg: number;
  changeKg: number;
  /** When the series starts: "June", or "June 2025" once the year differs. */
  since: string;
}

/**
 * Best estimated 1RM per session, oldest first.
 *
 * Derived from the history this screen has already loaded rather than from a
 * query of its own. The sets are in memory, and one `Math.max` per session is
 * cheaper than the round trip would be. Sessions that produced no estimate
 * (warm-ups only, an exercise that isn't weight-and-reps) drop out instead of
 * plotting a zero, which would read as a week of no strength rather than a week
 * of no comparable set.
 */
function buildOneRepMaxTrend(history: HistoryEntry[], ctx: AnalyticsContext): OneRepMaxTrend | null {
  const points: DataPoint[] = [];

  // The query returns newest first; walk it backwards so the line reads left to
  // right in time.
  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index]!;

    let best = 0;
    for (const set of entry.sets) best = Math.max(best, setOneRepMaxKg(set, ctx));
    if (best > 0) points.push({ x: entry.performedAt.getTime(), y: best });
  }

  // One point is a reading, not a trend, and the chart would draw a lone dot.
  if (points.length < 2) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const start = new Date(first.x);

  return {
    points,
    latestKg: last.y,
    changeKg: last.y - first.y,
    since: start.toLocaleDateString(
      undefined,
      start.getFullYear() === new Date().getFullYear()
        ? { month: 'long' }
        : { month: 'long', year: 'numeric' },
    ),
  };
}

/** "+4 kg since June", "-2.5 kg since June", "No change since June". */
function describeChange(trend: OneRepMaxTrend, unit: WeightUnit): string {
  // Under a tenth of a kilogram is float noise from the formula, not progress.
  if (Math.abs(trend.changeKg) < 0.1) return `No change since ${trend.since}`;

  const sign = trend.changeKg > 0 ? '+' : '-';
  const magnitude = formatWeight(Math.abs(trend.changeKg), unit, { decimals: 1 });
  return `${sign}${magnitude} since ${trend.since}`;
}

export default function ExerciseDetailScreen() {
  const scrollEdge = useScrollEdge();

  const { id } = useLocalSearchParams<{ id: string }>();
  // The column this screen is drawn in, not the window: see `useContentWidth`.
  const width = useContentWidth();
  const { oneRepMaxFormula, bodyweightKg } = useSettings();

  const [tab, setTab] = useState<Tab>('summary');
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [records, setRecords] = useState<{ kind: PrKind; value: number }[]>([]);

  /*
   * Every figure on this screen belongs to this one exercise: the trend, the
   * rep-max table, the chart axis, the session history, so all of them read in
   * its unit rather than the app's. That is the point of the override: someone
   * who logs the dumbbell press in pounds should not have to convert their own
   * history in their head to check it against last month.
   *
   * Null while the row is loading, which resolves to the app-wide pair. The
   * screen renders its skeleton in that frame, so nothing is printed in a unit
   * that then changes under the reader.
   */
  const { weightUnit, distanceUnit } = useExerciseUnits(exercise);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const loaded = await getExercise(id);
      if (cancelled) return;
      setExercise(loaded ?? null);
      if (!loaded) return;

      // Most recent sessions containing this exercise.
      const links = await db
        .select({
          linkId: workoutExercises.id,
          workoutId: workouts.id,
          workoutName: workouts.name,
          startedAt: workouts.startedAt,
        })
        .from(workoutExercises)
        .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
        .where(
          and(
            eq(workoutExercises.exerciseId, id),
            isNotNull(workouts.finishedAt),
            isNull(workouts.deletedAt),
            isNull(workoutExercises.deletedAt),
          ),
        )
        .orderBy(desc(workouts.startedAt))
        .limit(20);

      const entries: HistoryEntry[] = [];
      for (const link of links) {
        const sets = await db
          .select()
          .from(workoutSets)
          .where(and(eq(workoutSets.workoutExerciseId, link.linkId), isNull(workoutSets.deletedAt)))
          .orderBy(workoutSets.position);

        entries.push({
          workoutId: link.workoutId,
          workoutName: link.workoutName,
          performedAt: link.startedAt,
          sets,
        });
      }

      const prRows = await db
        .select()
        .from(personalRecords)
        .where(and(eq(personalRecords.exerciseId, id), isNull(personalRecords.deletedAt)));

      // Keep only the best value per kind.
      const bestByKind = new Map<PrKind, number>();
      for (const row of prRows) {
        if (row.value > (bestByKind.get(row.kind) ?? 0)) bestByKind.set(row.kind, row.value);
      }

      if (!cancelled) {
        setHistory(entries);
        setRecords([...bestByKind].map(([kind, value]) => ({ kind, value })));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  /*
   * The row again, each time the screen comes back into view: the edit form is
   * pushed on top of it, and the name, muscle and equipment it changed are all
   * drawn here. The history below does not change with an edit and is not
   * re-read.
   */
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getExercise(id).then((row) => {
        if (!cancelled && row) setExercise(row);
      });
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  // Above the loading guard, because hooks cannot be conditional.
  const trend = useMemo(() => {
    if (!exercise) return null;
    return buildOneRepMaxTrend(history, {
      trackingType: exercise.trackingType,
      bodyweightKg: bodyweightKg ?? undefined,
      formula: oneRepMaxFormula,
    });
  }, [exercise, history, bodyweightKg, oneRepMaxFormula]);

  if (!exercise) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        <Stack.Screen options={{ title: 'Exercise' }} />
      </Screen>
    );
  }

  const analytics: AnalyticsContext = {
    trackingType: exercise.trackingType,
    bodyweightKg: bodyweightKg ?? undefined,
    formula: oneRepMaxFormula,
  };

  const allSets = history.flatMap((entry) => entry.sets) as SetLike[];
  const repMaxes = repMaxTable(allSets, analytics, 10);

  const [trendFigure, trendUnit]: [string, string | undefined] = trend
    ? splitMeasure(formatWeight(trend.latestKg, weightUnit, { decimals: 1 }))
    : ['', undefined];

  // Built-ins only: a custom exercise is deleted from its edit form.
  const confirmArchive = () => {
    void (async () => {
      const confirmed = await showConfirm({
        title: 'Archive exercise',
        message: 'Built-in exercises are archived rather than deleted, so they stay out of pickers.',
        confirmLabel: 'Archive',
      });
      if (!confirmed) return;

      await deleteExercise(id);
      router.back();
    })();
  };

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: exercise.name,
          // A custom exercise is the user's own and opens in its form, where
          // Delete also lives. A built-in belongs to the catalog: it can only
          // be archived out of the pickers.
          headerRight: () =>
            exercise.isCustom ? (
              <HeaderAction
                label="Edit exercise"
                title="Edit"
                onPress={() =>
                  router.push({ pathname: '/exercise/edit/[id]', params: { id: exercise.id } })
                }
              />
            ) : (
              <HeaderAction
                label="Archive exercise"
                title="Archive"
                tone="danger"
                onPress={confirmArchive}
              />
            ),
        }}
      />

      {/*
       * Two tabs, and outside the scroll view so they stay put.
       *
       * This screen answers two unrelated questions. What is this movement,
       * and what have I done with it, and it used to answer both down one
       * scroll, which meant the demonstration clip, the muscles, the 1RM trend
       * and the records all stood between someone and the sets they came to
       * check. Reference above, log below, and the log is one tap away rather
       * than four scrolls.
       *
       * There is no third tab. Hevy's "How to" holds written instructions, and
       * this app has no instruction text for any of its 6,800 exercises: a tab
       * that is empty on every row in the catalog is worse than no tab.
       */}
      <View style={styles.tabs}>
        <SegmentedControl options={TABS} value={tab} onChange={setTab} label="View" />
      </View>

      {tab === 'summary' ? (
        <ScrollView
          {...scrollEdge.list}
          style={styles.scroll}
          contentContainerStyle={styles.content}
        >
          <ExerciseMedia
            name={exercise.name}
            thumbnailUrl={exercise.thumbnailUrl}
            videoUrl={exercise.videoUrl}
          />

          {/*
           * Named muscles rather than a row of chips.
           *
           * Chips are a control shape. The picker's filters are chips, and so
           * are the set-type selectors, so a row of them here read as five
           * things to tap that did nothing. "Primary: Biceps" is the same fact
           * in the form it is actually read: a label and a value.
           */}
          <View style={styles.facts}>
            <Fact label="Primary" value={MUSCLE_GROUP_LABELS[exercise.primaryMuscle]} />
            {exercise.secondaryMuscles.length > 0 && (
              <Fact
                label="Secondary"
                value={exercise.secondaryMuscles
                  .map((muscle) => MUSCLE_GROUP_LABELS[muscle])
                  .join(', ')}
              />
            )}
            <Fact label="Equipment" value={EQUIPMENT_LABELS[exercise.equipment]} />
          </View>

          {trend && (
            <>
              <SectionHeader title="Est. 1RM" />
              {/* The chart has no scrub gesture and prints only its first and
                  last x labels, so the answer is stated above it. The reading
                  you want. Where you are now, and how far that is from where
                  the line starts. Should not require touching anything. */}
              <View style={styles.trend}>
                <Text variant="numericLarge" numberOfLines={1}>
                  {trendFigure}
                  {trendUnit ? (
                    <Text variant="label" color="textTertiary">{` ${trendUnit}`}</Text>
                  ) : null}
                </Text>
                <Text variant="label" color="textSecondary">
                  {describeChange(trend, weightUnit)}
                </Text>
              </View>

              <View style={styles.chart}>
                <LineChart
                  data={trend.points}
                  width={width - spacing.lg * 2}
                  height={160}
                  formatValue={(value) =>
                    formatWeight(value, weightUnit, { withUnit: false, decimals: 0 })
                  }
                  formatLabel={(x) =>
                    new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
                  }
                />
              </View>

              <Text variant="caption" color="textTertiary" style={styles.hint}>
                A one-rep max estimated from the heaviest working set of each session, not a max you
                have tested.
              </Text>
            </>
          )}

          {records.length > 0 && (
            <>
              <SectionHeader title="Personal records" />
              <Card style={styles.card}>
                {records.map((record) => (
                  <View key={record.kind} style={styles.recordRow}>
                    <Text variant="label" color="textSecondary">
                      {PR_KIND_LABELS[record.kind]}
                    </Text>
                    <Text variant="numeric" color="record">
                      {formatRecord(record.kind, record.value, weightUnit, distanceUnit)}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          )}

          {repMaxes.size > 0 && (
            <>
              <SectionHeader title="Rep maxes" />
              <Card style={styles.card}>
                {[...repMaxes]
                  .sort((a, b) => a[0] - b[0])
                  .map(([reps, weight]) => (
                    <View key={reps} style={styles.recordRow}>
                      <Text variant="label" color="textSecondary">
                        {reps} {reps === 1 ? 'rep' : 'reps'}
                      </Text>
                      <Text variant="numeric">
                        {formatWeight(weight, weightUnit, { decimals: 1 })}
                      </Text>
                    </View>
                  ))}
              </Card>
            </>
          )}
        </ScrollView>
      ) : (
        <ScrollView
          {...scrollEdge.list}
          style={styles.scroll}
          contentContainerStyle={styles.content}
        >
          {history.length === 0 ? (
            <EmptyState
              icon="time-outline"
              title="No history yet"
              description="Sets you log for this exercise appear here."
            />
          ) : (
            history.map((entry, index) => (
              <View key={entry.workoutId}>
                {/* Between sessions, not after every one: a rule under the
                    last entry is a line drawn across the bottom of the list. */}
                {index > 0 && <Divider />}
                <SessionHeader
                  name={entry.workoutName}
                  performedAt={entry.performedAt}
                  onPress={() =>
                    router.push({ pathname: '/workout/[id]', params: { id: entry.workoutId } })
                  }
                />
                {/* No `exerciseId`: the link would lead back to this screen. */}
                <ExerciseSetList
                  name={exercise.name}
                  thumbnailUrl={exercise.thumbnailUrl}
                  sets={entry.sets}
                  weightUnit={weightUnit}
                  distanceUnit={distanceUnit}
                />
              </View>
            ))
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

/** A label and its value on one line: the muscle and equipment facts. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text variant="label" color="textTertiary" style={styles.factLabel}>
        {label}
      </Text>
      <Text variant="label" style={styles.flex}>
        {value}
      </Text>
    </View>
  );
}

/** Which session the sets below it came from, and a way into it. */
function SessionHeader({
  name,
  performedAt,
  onPress,
}: {
  name: string;
  performedAt: Date;
  onPress: () => void;
}) {
  const colors = useColors();

  const when = formatDateTime(performedAt, DATE_MEDIUM);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${name}, ${when}, open workout`}
      style={styles.sessionHeader}
    >
      <View style={styles.flex}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="caption" color="textTertiary">
          {when}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

function formatRecord(
  kind: PrKind,
  value: number,
  unit: WeightUnit,
  distanceUnit: DistanceUnit,
): string {
  switch (kind) {
    case 'most_reps':
      return `${value} reps`;
    case 'best_duration':
      return formatDurationShort(value);
    case 'best_distance':
      // Stored in kilometres; printed in whichever unit the user set.
      return formatDistance(value, distanceUnit);
    case 'best_set_volume':
    case 'best_session_volume':
      return formatVolume(value, unit);
    default:
      return formatWeight(value, unit, { decimals: 1 });
  }
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  // The tab bar is a fixed sibling, so the scroller has to claim what is left
  // rather than sizing itself to its content and running off the screen.
  scroll: { flex: 1 },
  // No horizontal padding: the set rows on the History tab stripe edge to edge,
  // and the media panel on Summary runs the full width. See `ExerciseSetList`.
  content: { paddingBottom: spacing.huge },
  facts: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xs },
  fact: { flexDirection: 'row', gap: spacing.sm },
  factLabel: { width: 76 },
  trend: { paddingHorizontal: spacing.lg, gap: 2 },
  chart: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  hint: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  card: { marginHorizontal: spacing.lg, gap: spacing.sm },
  recordRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  flex: { flex: 1 },
});
