import { Ionicons } from '@expo/vector-icons';
import {
  DATE_MEDIUM,
  formatDateTime,
  formatDistance,
  formatDurationShort,
  formatVolume,
  formatWeight,
  PR_KIND_LABELS,
  PR_KINDS,
  type DistanceUnit,
  type PrKind,
  type WeightUnit,
} from '@lift/shared';
import { desc, eq, isNull } from 'drizzle-orm';
import { router, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Card,
  EmptyState,
  PressableScale,
  Reveal,
  Screen,
  Text,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import { db } from '@/db/client';
import { exercises, personalRecords } from '@/db/schema';
import {
  resolveExerciseUnits,
  useAppUnits,
  type ExerciseUnitOverrides,
} from '@/features/exercises/units';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { font, radius, spacing, stroke, useColors } from '@/theme';

/**
 * How long a record stays gold.
 *
 * Gold is this screen's whole vocabulary for "new", and it only says that if
 * most of the screen is not wearing it. Every figure here is a record by
 * definition, so printing all of them in `record` made last November's best
 * look exactly like this morning's. Two weeks is long enough that a record set
 * on Monday is still marked when the screen is opened the following weekend,
 * and short enough that the gold on screen is usually one or two figures.
 */
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

/** The grid's labels: the cell is half a card wide, so "Best Session Volume" will not do. */
const SHORT_LABELS: Record<PrKind, string> = {
  heaviest_weight: 'Heaviest',
  best_1rm: 'Est. 1RM',
  best_set_volume: 'Best set',
  best_session_volume: 'Session',
  most_reps: 'Most reps',
  best_duration: 'Longest',
  best_distance: 'Farthest',
};

interface ExerciseRecords {
  exerciseId: string;
  exerciseName: string;
  /**
   * The exercise's own unit overrides, carried through the query so each group
   * prints its record in the unit that exercise is logged in. A best bench of
   * "102.5 kg" under a heading the user only ever sees as 225 lb is a number
   * they have to convert to recognise as theirs. Null here means the exercise
   * has no opinion and follows the app-wide setting.
   */
  units: ExerciseUnitOverrides;
  records: { kind: PrKind; value: number; achievedAt: Date }[];
}

export default function RecordsScreen() {
  const scrollEdge = useScrollEdge();

  const colors = useColors();
  const appUnits = useAppUnits();
  const [grouped, setGrouped] = useState<ExerciseRecords[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Stamped with the query rather than read at render, so what counts as recent
  // is decided once per visit and a long-open screen does not quietly re-colour.
  const [recentSince, setRecentSince] = useState(0);

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        try {
          const rows = await db
            .select({
              exerciseId: personalRecords.exerciseId,
              exerciseName: exercises.name,
              weightUnit: exercises.weightUnit,
              distanceUnit: exercises.distanceUnit,
              kind: personalRecords.kind,
              value: personalRecords.value,
              achievedAt: personalRecords.achievedAt,
            })
            .from(personalRecords)
            .innerJoin(exercises, eq(personalRecords.exerciseId, exercises.id))
            .where(isNull(personalRecords.deletedAt))
            .orderBy(desc(personalRecords.achievedAt));

          // Keep only the best entry per (exercise, kind).
          const byExercise = new Map<string, ExerciseRecords>();
          const seen = new Map<string, number>();

          for (const row of rows) {
            const key = `${row.exerciseId}:${row.kind}`;
            if ((seen.get(key) ?? 0) >= row.value) continue;
            seen.set(key, row.value);

            let entry = byExercise.get(row.exerciseId);
            if (!entry) {
              entry = {
                exerciseId: row.exerciseId,
                exerciseName: row.exerciseName,
                units: { weightUnit: row.weightUnit, distanceUnit: row.distanceUnit },
                records: [],
              };
              byExercise.set(row.exerciseId, entry);
            }

            const existing = entry.records.findIndex((record) => record.kind === row.kind);
            const next = { kind: row.kind, value: row.value, achievedAt: row.achievedAt };
            if (existing >= 0) entry.records[existing] = next;
            else entry.records.push(next);
          }

          // Kinds in their declared order rather than by date, so the heaviest
          // weight is the first figure under every exercise on the screen and the
          // column can be scanned rather than read.
          for (const entry of byExercise.values()) {
            entry.records.sort((a, b) => PR_KINDS.indexOf(a.kind) - PR_KINDS.indexOf(b.kind));
          }

          /*
           * Recent records first, newest at the top; everything else in name
           * order below them.
           *
           * Alphabetical alone is the right order for finding a lift and the
           * wrong one for the question most visits ask, which is "what have I
           * hit lately". A record set this week sat wherever its name fell, so
           * the gold that marks it could be three screens down. The rest stay
           * alphabetical so the long tail can still be scanned for a name.
           */
          const since = Date.now() - RECENT_MS;
          const latest = (entry: ExerciseRecords) =>
            Math.max(...entry.records.map((record) => record.achievedAt.getTime()));

          const all = [...byExercise.values()];
          const recent = all
            .filter((entry) => latest(entry) >= since)
            .sort((a, b) => latest(b) - latest(a));
          const rest = all
            .filter((entry) => latest(entry) < since)
            .sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));

          if (!cancelled) {
            setRecentSince(since);
            setGrouped([...recent, ...rest]);
          }
        } catch {
          // A failed query counts as loaded, the same rule use-rows.ts applies:
          // a screen that never answers has to fall through to the empty state
          // rather than stay blank for the rest of the visit.
        } finally {
          if (!cancelled) setLoaded(true);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  // The query answers a tick after mount and `grouped` is seeded to [], so the
  // empty state has to wait for it: otherwise every open of this screen starts
  // on "No records yet" and corrects itself a frame later, on a screen reached
  // from a row that promises records. Same rule as history.tsx and use-rows.ts.
  // The header stays mounted so the native title does not flash the route name.
  if (!loaded) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        <Stack.Screen options={{ title: 'Personal records' }} />
      </Screen>
    );
  }

  if (grouped.length === 0) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        <Stack.Screen options={{ title: 'Personal records' }} />
        <Reveal>
          <EmptyState
            icon="trending-up-outline"
            title="No records yet"
            description="A record is filed when a completed set beats your best on that exercise."
          />
        </Reveal>
      </Screen>
    );
  }

  const showsEstimated1rm = grouped.some((entry) =>
    entry.records.some((record) => record.kind === 'best_1rm'),
  );

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Personal records' }} />

      {/* Both branches above hold a bare header until the query answers, so
          whichever one wins arrives some way into the screen's life rather than
          with the push. The `Reveal` is what turns that into the page settling
          instead of a page appearing. */}
      <Reveal style={styles.flex}>
        {/*
          The record is the largest thing on the row, and everything that
          qualifies it (which record, which day) is set beneath it at caption
          size. This used to be a label-left / value-right list row, identical in
          weight to a settings toggle: the one screen in the app whose entire
          contents are worth being proud of read as a table of preferences. No
          badge and no medal either; the number is the achievement, and dressing
          it up would say the number is not enough.
        */}
        <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
          {showsEstimated1rm && (
            <Text variant="caption" color="textTertiary" style={styles.note}>
              An estimated 1RM is calculated from a set you completed, not a max you have tested.
            </Text>
          )}

          {grouped.map((entry) => {
            const units = resolveExerciseUnits(entry.units, appUnits);
            const isRecent = (record: { achievedAt: Date }) =>
              record.achievedAt.getTime() >= recentSince;

            /*
             * One figure leads, and it is the estimated 1RM where there is one.
             *
             * Five records at one size made every exercise a column of five
             * numbers, and the screen a wall of them. The 1RM is the one that
             * moves when any of the others do, so it is the figure that says
             * how strong this lift is; the other four sit under it at reading
             * size, where they can be looked up rather than read past.
             */
            const headline =
              entry.records.find((record) => record.kind === 'best_1rm') ?? entry.records[0]!;
            const others = entry.records.filter((record) => record !== headline);
            const anyRecent = entry.records.some(isRecent);

            const headMeasure = formatRecord(
              headline.kind,
              headline.value,
              units.weightUnit,
              units.distanceUnit,
            );
            const [headFigure, headUnit] = splitMeasure(headMeasure);
            const headDay = formatDateTime(headline.achievedAt, DATE_MEDIUM);
            // The date alone beside the card's figure. The time of day is in the
            // spoken label, and on screen it pushed the date into the figure's
            // column for a detail nobody reads a record for.
            const headDate = headline.achievedAt.toLocaleDateString(undefined, DATE_MEDIUM);

            return (
              <Card key={entry.exerciseId} padded={false} style={styles.card}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={
                    `${entry.exerciseName}. ${PR_KIND_LABELS[headline.kind]}, ` +
                    `${headMeasure}, ${headDay}.${anyRecent ? ' New record.' : ''}`
                  }
                  accessibilityHint="Opens the exercise"
                  onPress={() =>
                    router.push({ pathname: '/exercise/[id]', params: { id: entry.exerciseId } })
                  }
                  // Spans the card's width, so it highlights rather than scales:
                  // the same rule `ListRow` follows.
                  fill={colors.surface}
                  fillPressed={colors.surfacePressed}
                  scaleTo={1}
                  style={styles.head}
                >
                  <View style={styles.flex}>
                    <Text variant="label" color="textSecondary" numberOfLines={1}>
                      {entry.exerciseName}
                    </Text>
                    <Text
                      variant="title"
                      color={isRecent(headline) ? 'record' : 'text'}
                      numberOfLines={1}
                      style={styles.figure}
                    >
                      {headFigure}
                      <Text variant="label" color="textTertiary">
                        {`${headUnit ? ` ${headUnit}` : ''} ${SHORT_LABELS[headline.kind]}`}
                      </Text>
                    </Text>
                  </View>

                  {anyRecent ? (
                    <View style={[styles.chip, { backgroundColor: colors.recordSurface }]}>
                      <Ionicons name="trophy" size={11} color={colors.record} />
                      <Text variant="caption" color="record" style={styles.chipText}>
                        New
                      </Text>
                    </View>
                  ) : (
                    <Text variant="caption" color="textTertiary">
                      {headDate}
                    </Text>
                  )}
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </PressableScale>

                {others.length > 0 && (
                  <View style={[styles.grid, { borderTopColor: colors.border }]}>
                    {others.map((record) => {
                      const measure = formatRecord(
                        record.kind,
                        record.value,
                        units.weightUnit,
                        units.distanceUnit,
                      );
                      const day = formatDateTime(record.achievedAt, DATE_MEDIUM);

                      return (
                        <View
                          key={record.kind}
                          accessible
                          accessibilityLabel={`${PR_KIND_LABELS[record.kind]}, ${measure}, ${day}`}
                          style={styles.cell}
                        >
                          <Text variant="caption" color="textTertiary" numberOfLines={1}>
                            {SHORT_LABELS[record.kind]}
                          </Text>
                          <Text
                            variant="numeric"
                            color={isRecent(record) ? 'record' : 'text'}
                            numberOfLines={1}
                          >
                            {measure}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </Card>
            );
          })}
        </ScrollView>
      </Reveal>
    </Screen>
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
  content: { paddingBottom: spacing.huge, paddingHorizontal: spacing.lg, gap: spacing.md },
  note: { paddingTop: spacing.lg, paddingBottom: spacing.xs },
  card: { overflow: 'hidden', borderRadius: radius.xl },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  figure: { marginTop: 2, fontVariant: ['tabular-nums'] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    height: 22,
    borderRadius: radius.pill,
  },
  // Through `font()`, never a bare `fontWeight`: see the note on it in tokens.ts.
  chipText: font('semibold'),
  /*
   * Two columns, ruled off from the headline above but not boxed: four figures
   * read as a small table without a grid around them, which is the argument
   * the logging screen makes for its own column headings.
   */
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderTopWidth: stroke.rule,
  },
  cell: { width: '50%', paddingTop: spacing.sm, paddingRight: spacing.md },
  flex: { flex: 1 },
});
