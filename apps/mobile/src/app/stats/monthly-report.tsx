import { Ionicons } from '@expo/vector-icons';
import {
  DATE_SHORT,
  formatDateTime,
  formatDurationShort,
  formatVolume,
  MUSCLE_GROUP_LABELS,
  type WeightUnit,
} from '@lift/shared';
import { router, Stack } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';

import { ColumnChart, type ColumnDatum } from '@/components/charts/column-chart';
import {
  Badge,
  Button,
  Card,
  Divider,
  Screen,
  SegmentedControl,
  Text,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import { pluralSessions, pluralSets } from '@/features/analytics/format';
import {
  getMonthlyReport,
  monthlyReportShareText,
  REPORT_METRIC_VALUE,
  REPORT_METRICS,
  type MonthlyReport,
  type MonthTotals,
  type ReportMetric,
  type SessionHighlight,
} from '@/features/analytics/monthly-report';
import { deltaOf, SummaryGrid, type SummaryFigure } from '@/features/analytics/summary-grid';
import { addMonths, startOfMonth } from '@/features/analytics/windows';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { MIN_TOUCH_SIZE, radius, spacing, useColors, useContentWidth } from '@/theme';

/** What a figure reads while the month is still being counted. */
const PENDING = '—';

/**
 * How each metric is pulled off a month and rendered.
 *
 * The axis formatter is terser than the readout one on purpose: the chart's
 * y-gutter is 46px, so "12.4k" belongs there and "12,431 kg" belongs in the
 * summary tile.
 */
const METRICS: Record<
  ReportMetric,
  {
    format: (value: number, unit: WeightUnit) => string;
    axis: (value: number, unit: WeightUnit) => string;
  }
> = {
  workouts: {
    format: (value) => String(Math.round(value)),
    axis: (value) => String(Math.round(value)),
  },
  duration: {
    format: (value) => formatDurationShort(value),
    axis: (value) => (value >= 3600 ? `${Math.round(value / 3600)}h` : `${Math.round(value / 60)}m`),
  },
  volume: {
    format: (value, unit) => formatVolume(value, unit),
    axis: (value, unit) => formatVolume(value, unit).replace(` ${unit}`, ''),
  },
  sets: {
    format: (value) => String(Math.round(value)),
    axis: (value) => String(Math.round(value)),
  },
  reps: {
    format: (value) => Math.round(value).toLocaleString(),
    axis: (value) => (value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(Math.round(value))),
  },
};

export default function MonthlyReportScreen() {
  const scrollEdge = useScrollEdge();

  // The column this screen is drawn in, not the window: see `useContentWidth`.
  const width = useContentWidth();
  const weightUnit = useSettings((state) => state.weightUnit);
  const bodyweightKg = useSettings((state) => state.bodyweightKg);
  const formula = useSettings((state) => state.oneRepMaxFormula);

  // Months back from the current one, so the report cannot go stale sitting in
  // the background across a month boundary.
  const [monthsBack, setMonthsBack] = useState(0);
  const [metric, setMetric] = useState<ReportMetric>('workouts');
  const [report, setReport] = useState<MonthlyReport | null>(null);

  const month = useMemo(
    () => addMonths(startOfMonth(new Date()), -monthsBack),
    [monthsBack],
  );

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const next = await getMonthlyReport(month, { bodyweightKg, formula }).catch(() => null);
        if (!cancelled) setReport(next);
      })();

      return () => {
        cancelled = true;
      };
    }, [month, bodyweightKg, formula]),
  );

  // Only figures belonging to the month named in the header. The query is
  // asynchronous, and last month's totals left up under this month's title are
  // read as this month's.
  const current = report?.monthStart === month.getTime() ? report : null;

  const columns = useMemo<ColumnDatum[]>(
    () =>
      (current?.series ?? []).map((bucket) => ({
        key: bucket.start,
        label: bucket.label,
        value: REPORT_METRIC_VALUE[metric](bucket),
      })),
    [current, metric],
  );

  const chartWidth = width - spacing.lg * 2 - spacing.lg * 2;

  // The floor for the back arrow. Stepping before the first workout would open
  // a report on a month the user had not started training in, which is a screen
  // full of zeroes and no way to tell it from a bug.
  const atEarliest =
    current?.earliestMonth != null && month.getTime() <= current.earliestMonth;

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Monthly report' }} />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        <View style={styles.nav}>
          <NavButton
            icon="chevron-back"
            label="Previous month"
            disabled={atEarliest}
            onPress={() => setMonthsBack((months) => months + 1)}
          />
          <Text variant="subheading" align="center" numberOfLines={1} style={styles.navTitle}>
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </Text>
          <NavButton
            icon="chevron-forward"
            label="Next month"
            disabled={monthsBack === 0}
            onPress={() => setMonthsBack((months) => Math.max(0, months - 1))}
          />
        </View>

        <Card style={styles.chartCard}>
          <SegmentedControl
            options={REPORT_METRICS}
            value={metric}
            onChange={setMetric}
            size="sm"
            label="Metric"
          />

          <View style={styles.readout}>
            <Text variant="numericLarge" numberOfLines={1} adjustsFontSizeToFit>
              {current
                ? METRICS[metric].format(REPORT_METRIC_VALUE[metric](current.totals), weightUnit)
                : PENDING}
            </Text>
            <Text variant="caption" color="textTertiary">
              {current
                ? `this month · ${current.series.length} months shown`
                : /* A space rather than nothing: an empty line keeps its height,
                     so the chart does not step up and back down as the month is
                     counted. */
                  ' '}
            </Text>
          </View>

          <ColumnChart
            data={columns}
            width={chartWidth}
            // Selection is deliberately off. The bars are months and the one
            // being reported is the last of them. Everything a tap would say
            // is already on this screen, in words, below the chart.
            selectedKey={current ? current.monthStart : null}
            formatValue={(value) => METRICS[metric].axis(value, weightUnit)}
            maxLabels={6}
          />
        </Card>

        <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
          Summary
        </Text>
        <SummaryGrid items={summaryFigures(current, weightUnit)} />

        {current && current.totals.workouts > 0 ? (
          <Highlights report={current} weightUnit={weightUnit} />
        ) : current ? (
          <Card>
            <Text variant="body" color="textSecondary" align="center">
              No sessions logged in{' '}
              {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}.
            </Text>
          </Card>
        ) : null}

        {current && (
          <Button
            title="Share"
            variant="secondary"
            icon="share-outline"
            fullWidth
            onPress={() => {
              // Fire and forget: a dismissed share sheet resolves, and a
              // failure here is not worth an alert over a recap.
              void Share.share({ message: monthlyReportShareText(current, weightUnit) }).catch(
                () => undefined,
              );
            }}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

function summaryFigures(report: MonthlyReport | null, weightUnit: WeightUnit): SummaryFigure[] {
  const totals: MonthTotals | undefined = report?.totals;
  const previous = report?.previous ?? null;

  const [volume, volumeUnit]: [string, string | undefined] = totals
    ? splitMeasure(formatVolume(totals.volumeKg, weightUnit))
    : [PENDING, undefined];

  return [
    {
      label: 'Workouts',
      value: totals ? String(totals.workouts) : PENDING,
      delta: totals ? deltaOf(totals.workouts, previous?.workouts, String) : null,
    },
    {
      label: 'Duration',
      value: totals ? formatDurationShort(totals.durationSeconds) : PENDING,
      delta: totals
        ? deltaOf(totals.durationSeconds, previous?.durationSeconds, formatDurationShort)
        : null,
    },
    {
      label: 'Volume',
      value: volume,
      unit: volumeUnit,
      delta:
        totals && previous
          ? {
              direction:
                totals.volumeKg > previous.volumeKg
                  ? 'up'
                  : totals.volumeKg < previous.volumeKg
                    ? 'down'
                    : 'flat',
              // Formatted through the same collapsing formatter as the figure
              // above it, so "2.1k kg" and "12.4k kg" read as the same kind of
              // number rather than one being spelled out in full.
              text: formatVolume(Math.abs(totals.volumeKg - previous.volumeKg), weightUnit),
            }
          : null,
    },
    {
      label: 'Sets',
      value: totals ? String(totals.sets) : PENDING,
      delta: totals ? deltaOf(totals.sets, previous?.sets, String) : null,
    },
  ];
}

/**
 * The month in sentences rather than figures.
 *
 * Four tiles say how much was done; this says what it was. Everything here
 * links somewhere (a session, an exercise) because a highlight the reader
 * cannot open is a fact they have to go and look up.
 */
function Highlights({ report, weightUnit }: { report: MonthlyReport; weightUnit: WeightUnit }) {
  const colors = useColors();
  const muscle = report.topMuscles[0];

  return (
    <>
      <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
        Highlights
      </Text>

      <Card style={styles.highlights}>
        <View style={styles.factLine}>
          <Text variant="body" style={styles.flex}>
            Trained on{' '}
            <Text variant="bodyMedium">
              {report.activeDays}
            </Text>{' '}
            of {report.daysInMonth} days
          </Text>
          {report.prCount > 0 && (
            <Badge
              tone="record"
              icon="trophy"
              label={report.prCount === 1 ? '1 PR' : `${report.prCount} PRs`}
            />
          )}
        </View>

        {muscle && (
          <Text variant="body" color="textSecondary">
            Most trained: {MUSCLE_GROUP_LABELS[muscle.muscle]} ·{' '}
            {pluralSets(muscle.directSets)}
            {report.topMuscles.length > 1
              ? `, then ${report.topMuscles
                  .slice(1)
                  .map((entry) => MUSCLE_GROUP_LABELS[entry.muscle])
                  .join(' and ')}`
              : ''}
          </Text>
        )}

        <Text variant="body" color="textSecondary">
          Averaged{' '}
          {formatDurationShort(
            Math.round(report.totals.durationSeconds / Math.max(1, report.totals.workouts)),
          )}{' '}
          and{' '}
          {formatVolume(report.totals.volumeKg / Math.max(1, report.totals.workouts), weightUnit)}{' '}
          per session.
        </Text>
      </Card>

      {(report.biggestSession || report.longestSession) && (
        <Card padded={false}>
          {report.biggestSession && (
            <SessionRow
              label="Heaviest session"
              session={report.biggestSession}
              detail={formatVolume(report.biggestSession.volumeKg, weightUnit)}
            />
          )}
          {report.biggestSession && report.longestSession && <Divider inset={spacing.lg} />}
          {report.longestSession && (
            <SessionRow
              label="Longest session"
              session={report.longestSession}
              detail={formatDurationShort(report.longestSession.durationSeconds)}
            />
          )}
        </Card>
      )}

      {report.topExercises.length > 0 && (
        <>
          <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
            Top exercises
          </Text>

          <Card padded={false}>
            {report.topExercises.map((exercise, index) => (
              <View key={exercise.id}>
                {index > 0 && <Divider inset={spacing.lg} />}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${exercise.name}, ${pluralSessions(exercise.times)}, ${exercise.sets} sets`}
                  onPress={() =>
                    router.push({ pathname: '/exercise/[id]', params: { id: exercise.id } })
                  }
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: colors.surfacePressed },
                  ]}
                >
                  <View style={styles.flex}>
                    <Text variant="bodyMedium" numberOfLines={1}>
                      {exercise.name}
                    </Text>
                    <Text variant="caption" color="textTertiary" numberOfLines={1}>
                      {pluralSessions(exercise.times)} · {exercise.sets} sets ·{' '}
                      {formatVolume(exercise.volumeKg, weightUnit)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </Pressable>
              </View>
            ))}
          </Card>
        </>
      )}
    </>
  );
}

function SessionRow({
  label,
  session,
  detail,
}: {
  label: string;
  session: SessionHighlight;
  detail: string;
}) {
  const colors = useColors();
  const day = formatDateTime(new Date(session.startedAt), DATE_SHORT);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${session.name}, ${detail}, ${day}`}
      onPress={() => router.push({ pathname: '/workout/[id]', params: { id: session.id } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      <View style={styles.flex}>
        <Text variant="overline" color="textTertiary">
          {label}
        </Text>
        <Text variant="bodyMedium" numberOfLines={1}>
          {session.name}
        </Text>
        <Text variant="caption" color="textTertiary" numberOfLines={1}>
          {detail} · {session.sets} sets · {day}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

function NavButton({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navButton,
        pressed && !disabled ? { backgroundColor: colors.surfacePressed } : null,
      ]}
    >
      <Ionicons name={icon} size={22} color={disabled ? colors.border : colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  nav: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  navTitle: { flex: 1 },
  navButton: {
    width: MIN_TOUCH_SIZE,
    height: MIN_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  chartCard: { gap: spacing.md },
  readout: { gap: 2 },
  sectionHeader: { paddingTop: spacing.sm },
  highlights: { gap: spacing.sm },
  factLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  flex: { flex: 1, gap: 2 },
});
