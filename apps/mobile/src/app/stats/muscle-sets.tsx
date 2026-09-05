import {
  landmarksFor,
  MUSCLE_GROUP_LABELS,
  volumeZone,
  VOLUME_ZONE_LABELS,
  type MuscleGroup,
} from '@lift/shared';
import { Stack } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ColumnChart, type ColumnDatum } from '@/components/charts/column-chart';
import { Badge, Card, EmptyState, Screen, Text, useScrollEdge } from '@/components/ui';
import { UNMAPPED_MUSCLES } from '@/components/charts/body-map';
import { formatSets, pluralSets } from '@/features/analytics/format';
import {
  getMuscleSetTrend,
  type MuscleSeries,
  type MuscleSetTrend,
} from '@/features/analytics/muscle-stats';
import { RangePicker } from '@/features/analytics/range-picker';
import { volumeColor } from '@/features/analytics/volume-landmarks';
import type { StatRange } from '@/features/analytics/windows';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { radius, spacing, stroke, useColors, useContentWidth } from '@/theme';

/**
 * A week is not a range this screen can plot.
 *
 * Its buckets are weeks or months, so "last 7 days" would draw a single bar:
 * a chart with nothing to compare against. The body graph on the statistics
 * hub is where a single week belongs.
 */
const RANGES: readonly StatRange[] = ['30d', '3m', '1y', 'all'];

/** What a figure reads while its range is still being counted. */
const PENDING = '—';

export default function MuscleSetsScreen() {
  const scrollEdge = useScrollEdge();

  // The column this screen is drawn in, not the window: see `useContentWidth`.
  const width = useContentWidth();
  const firstDayOfWeek = useSettings((state) => state.firstDayOfWeek);

  const [range, setRange] = useState<StatRange>('3m');
  const [trend, setTrend] = useState<MuscleSetTrend | null>(null);
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [bucket, setBucket] = useState<number | null>(null);

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const next = await getMuscleSetTrend(range, firstDayOfWeek).catch(() => null);
        if (!cancelled) setTrend(next);
      })();

      return () => {
        cancelled = true;
      };
    }, [range, firstDayOfWeek]),
  );

  // The query is asynchronous, so `trend` still describes the range the user
  // just moved off for as long as it takes to run. Nothing on this screen is
  // labelled by range. The picker is the only thing that says which window the
  // figures belong to, so matching on the range the result carries drops them
  // the instant the picker moves, rather than showing three-month counts under
  // "Last year" where they are read as fact.
  const ranged = trend?.range === range ? trend : null;

  const selected = useMemo(
    () => ranged?.muscles.find((entry) => entry.muscle === muscle) ?? null,
    [ranged, muscle],
  );

  const columns = useMemo<ColumnDatum[]>(() => {
    // Resolved inside the memo rather than beside it: a fresh `[]` fallback
    // computed in render would be a new array identity every pass and would
    // rebuild the columns on every keystroke elsewhere on the screen.
    const series = selected?.perBucket ?? ranged?.totalPerBucket ?? [];

    return (ranged?.buckets ?? []).map((item, index) => ({
      key: item.start,
      label: item.label,
      value: series[index] ?? 0,
    }));
  }, [ranged, selected]);

  const chartWidth = width - spacing.lg * 2 - spacing.lg * 2;
  const activeBucket = columns.find((column) => column.key === bucket) ?? null;

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Set count per muscle' }} />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        <RangePicker
          value={range}
          options={RANGES}
          onChange={(next) => {
            setRange(next);
            setBucket(null);
          }}
        />

        <Card style={styles.chartCard}>
          <View style={styles.readout}>
            <Text variant="overline" color="textSecondary">
              {selected ? MUSCLE_GROUP_LABELS[selected.muscle] : 'All muscles'}
            </Text>
            <Text variant="numericLarge" numberOfLines={1} adjustsFontSizeToFit>
              {!ranged
                ? PENDING
                : activeBucket
                  ? String(activeBucket.value)
                  : String(selected ? selected.directSets : ranged.totalSets)}
            </Text>
            <Text variant="caption" color="textTertiary">
              {readoutCaption(ranged, activeBucket, selected)}
            </Text>
          </View>

          <ColumnChart
            data={columns}
            width={chartWidth}
            selectedKey={bucket}
            onSelect={(datum) => setBucket(datum?.key ?? null)}
          />
        </Card>

        {!ranged ? null : ranged.muscles.length === 0 ? (
          <EmptyState
            icon="stats-chart-outline"
            title="No sets in this range"
            description="Finish a workout and every muscle it trained shows up here, ranked."
          />
        ) : (
          <>
            {/* A plain overline rather than `SectionHeader`: this scroll view is
                already inset, and the shared component carries its own. */}
            <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
              {ranged.muscles.length} muscles trained
            </Text>

            <Card style={styles.list}>
              {ranged.muscles.map((entry) => (
                <MuscleRow
                  key={entry.muscle}
                  entry={entry}
                  totalSets={ranged.totalSets}
                  selected={muscle === entry.muscle}
                  onPress={() => {
                    setMuscle(muscle === entry.muscle ? null : entry.muscle);
                    setBucket(null);
                  }}
                />
              ))}
            </Card>

            <Text variant="caption" color="textTertiary" style={styles.footnote}>
              The chart counts sets where the muscle was the target. The weekly rate beside each
              row also counts sets that trained it as an assisting muscle, at half a set each,
              which is why the two figures differ on a row like triceps.
            </Text>

            {/*
              Stated rather than papered over.

              The window is exactly the range that was picked, so the totals
              match their label, which means the first and last bars are
              whichever slice of their period the window happens to cover.
              Rounding the window out to whole weeks would fix the bars and
              break the number above them, and the number is the one a reader
              quotes.
            */}
            <Text variant="caption" color="textTertiary" style={styles.footnote}>
              Bars are whole {ranged.granularity === 'week' ? 'weeks' : 'months'}; the first and
              the current one cover only the part of their period that falls inside the range.
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function readoutCaption(
  trend: MuscleSetTrend | null,
  bucket: ColumnDatum | null,
  selected: MuscleSeries | null,
): string {
  // Deliberately a space rather than absent while the range is counted: an
  // empty line still occupies its height, so the chart below does not step up
  // and back down under a thumb already reaching for a bar.
  if (!trend) return ' ';

  if (bucket) {
    const period = trend.granularity === 'week' ? `Week of ${bucket.label}` : bucket.label;
    return `${period} · ${pluralSets(bucket.value)}`;
  }

  const periods = trend.buckets.length;
  const noun = trend.granularity === 'week' ? 'weeks' : 'months';
  const rate = selected
    ? `${formatSets(selected.setsPerWeek)}/wk`
    : `${formatSets(trend.totalSets / trend.weeks)}/wk`;

  return periods > 0
    ? `sets across ${periods} ${noun} · ${rate} · tap a bar for detail`
    : 'No data in this range';
}

function MuscleRow({
  entry,
  totalSets,
  selected,
  onPress,
}: {
  entry: MuscleSeries;
  totalSets: number;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const share = totalSets === 0 ? 0 : Math.round((entry.directSets / totalSets) * 100);
  const landmarks = landmarksFor(entry.muscle);
  const zone = volumeZone(entry.setsPerWeek, landmarks);
  const unmapped = UNMAPPED_MUSCLES.includes(entry.muscle);

  // The bar tracks this muscle's own recoverable ceiling rather than the busiest
  // muscle, so a row short of MEV looks short even in a month where nothing else
  // got trained either, and 16 sets of triceps reads fuller than 16 of
  // shoulders, which is the truth of it. Muscles with no ceiling (cardio and
  // friends) get an empty track rather than a division by zero.
  const fill = landmarks.mrv <= 0 ? 0 : Math.min(100, (entry.setsPerWeek / landmarks.mrv) * 100);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${MUSCLE_GROUP_LABELS[entry.muscle]}, ${entry.directSets} sets, ${formatSets(entry.setsPerWeek)} per week, ${VOLUME_ZONE_LABELS[zone]}, ${share}% of sets`}
      accessibilityHint="Shows this muscle in the chart above"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        // The resting outline is the card fill this row sits on rather than
        // `transparent`: the border is drawn in every state, so selecting one
        // cannot reflow the row, and a see-through stroke around a radius seams
        // on Android. See `stroke` in the tokens.
        selected
          ? { backgroundColor: colors.accentSurface, borderColor: colors.accent }
          : pressed
            ? { backgroundColor: colors.surfacePressed, borderColor: colors.surfacePressed }
            : { borderColor: colors.surface },
      ]}
    >
      <View style={styles.rowHeader}>
        <Text variant="label" numberOfLines={1} style={styles.rowName}>
          {MUSCLE_GROUP_LABELS[entry.muscle]}
        </Text>
        {unmapped && <Badge label="Not on map" tone="neutral" />}
        <Text variant="numeric" color="text" style={styles.rowCount}>
          {entry.directSets}
        </Text>
      </View>

      <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
        <View
          style={[
            styles.fill,
            {
              backgroundColor: volumeColor(entry.setsPerWeek, colors, landmarks),
              width: `${Math.max(2, fill)}%`,
            },
          ]}
        />
      </View>

      <Text variant="caption" color="textTertiary" numberOfLines={1}>
        {formatSets(entry.setsPerWeek)}/wk · {VOLUME_ZONE_LABELS[zone]} · {share}% of sets ·{' '}
        {entry.exercises === 1 ? '1 exercise' : `${entry.exercises} exercises`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  chartCard: { gap: spacing.md },
  readout: { gap: 2 },
  sectionHeader: { paddingTop: spacing.sm },
  list: { gap: spacing.xs },
  footnote: { paddingHorizontal: spacing.xs },
  row: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: stroke.outline,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowName: { flex: 1 },
  rowCount: { minWidth: 28, textAlign: 'right' },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
});
