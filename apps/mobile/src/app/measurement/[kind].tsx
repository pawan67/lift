import {
  MEASUREMENT_KINDS,
  MEASUREMENT_KIND_LABELS,
  MEASUREMENT_KIND_META,
  bmiBand,
  BMI_BAND_LABELS,
  bodyMassIndex,
  formatMeasurementDelta,
  formatMeasurementValue,
  selectWindow,
  smoothMeasurements,
  summarizeMeasurements,
  symmetry,
  trimZeros,
  waistBand,
  WAIST_BAND_LABELS,
  waistToHeightRatio,
  type MeasurementKind,
  type MeasurementPoint,
  type MeasurementUnitPreferences,
} from '@lift/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
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
  StatBand,
  Text,
  splitMeasure,
  useScrollEdge,
  type SegmentOption,
} from '@/components/ui';
import type { BodyMeasurement } from '@/db/schema';
import { haptics } from '@/features/feedback/haptics';
import {
  MeasurementEntrySheet,
  type MeasurementEntryInput,
} from '@/features/measurements/entry-sheet';
import { describeRate, describeRecency } from '@/features/measurements/insights';
import {
  deleteMeasurement,
  getMeasurementHistory,
  recordMeasurement,
  toMeasurementPoints,
  updateMeasurement,
} from '@/features/measurements/repository';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { showConfirm } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { MIN_TOUCH_SIZE, spacing, useColors, useContentWidth } from '@/theme';

type Range = '90' | '180' | '365' | 'all';

const RANGES: readonly SegmentOption<Range>[] = [
  { value: '90', label: '3M' },
  { value: '180', label: '6M' },
  { value: '365', label: '1Y' },
  { value: 'all', label: 'All' },
];

/** Which entry the sheet is on: a correction, or a new reading. */
type SheetState = { mode: 'add' } | { mode: 'edit'; entry: BodyMeasurement } | null;

/**
 * One measurement, in full.
 *
 * The chart used to be a 140pt strip that unfolded inside a list row, with no
 * axis worth reading and no way to interrogate a point, and the readings
 * behind it were not reachable at all, so a tape misread at 39.5 instead of
 * 35.9 was in the log for good. This screen is the other half of that: a chart
 * big enough to scrub, the statistics for whatever window you picked, and every
 * reading listed and editable.
 */
export default function MeasurementDetailScreen() {
  const scrollEdge = useScrollEdge();

  const colors = useColors();
  // The column this screen is drawn in, not the window: see `useContentWidth`.
  const width = useContentWidth();
  const params = useLocalSearchParams<{ kind: string; log?: string }>();

  const weightUnit = useSettings((state) => state.weightUnit);
  const measurementUnit = useSettings((state) => state.measurementUnit);
  const heightCm = useSettings((state) => state.heightCm);
  const prefs = useMemo<MeasurementUnitPreferences>(
    () => ({ weightUnit, measurementUnit }),
    [weightUnit, measurementUnit],
  );

  const kind = asMeasurementKind(params.kind);

  const [rows, setRows] = useState<BodyMeasurement[]>([]);
  const [counterpart, setCounterpart] = useState<BodyMeasurement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [range, setRange] = useState<Range>('180');
  const [scrubbed, setScrubbed] = useState<DataPoint | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [now, setNow] = useState(() => Date.now());

  /*
   * `?log=<anything>` opens the entry sheet on arrival.
   *
   * The weigh-in reminder's notification routes here when it is tapped rather
   * than typed into, and landing on a chart when you were answering a prompt to
   * log a number is a dead end with the actual control up in the header. Opened
   * during render rather than in an effect so the sheet is in the first painted
   * frame: an effect would show the screen without it and drop it in a commit
   * later, which on a route pushed from outside the app reads as a mis-tap.
   *
   * Latched on the param's value rather than run once on mount, because a
   * second notification tapped while this screen is already on the stack has to
   * re-open the sheet the user dismissed the first time. What the value *is*
   * never matters here, only that it changed, which is why the sender passes the
   * notification's delivery timestamp rather than a flag.
   */
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (params.log && params.log !== openedFor) {
    setOpenedFor(params.log);
    setSheet({ mode: 'add' });
  }

  const reload = useCallback(async () => {
    if (!kind) {
      setLoaded(true);
      return;
    }

    const history = await getMeasurementHistory(kind).catch(() => null);
    if (history) {
      setRows(history);
      setNow(Date.now());
    }

    // Only the paired kinds have one, and only they show the symmetry line.
    const other = MEASUREMENT_KIND_META[kind].counterpart;
    if (other) {
      const otherRows = await getMeasurementHistory(other).catch(() => null);
      setCounterpart(otherRows && otherRows.length > 0 ? otherRows[otherRows.length - 1]! : null);
    }

    setLoaded(true);
  }, [kind]);

  useDeferredFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const points = useMemo(() => toMeasurementPoints(rows), [rows]);

  // The window the chart and the statistics both describe. Falling back to the
  // whole series matters more than honouring the segment: a chart that empties
  // when someone taps "3M" looks broken, and the honest reading of "no entries
  // in three months" is the older data, not a blank panel.
  const windowed = useMemo(() => {
    if (range === 'all') return points;
    const selected = selectWindow(points, Number(range), now);
    return selected.length >= 2 ? selected : points;
  }, [points, range, now]);

  const stats = useMemo(() => summarizeMeasurements(windowed), [windowed]);
  const overall = useMemo(() => summarizeMeasurements(points), [points]);

  // Drawn dashed behind the readings: what the series says, as against what any
  // one reading said. Only where it earns its ink: under about a dozen
  // readings the smoothing has nothing to smooth and the two lines overlap.
  const trendLine = useMemo(
    () => (windowed.length >= 10 ? toChartPoints(smoothMeasurements(windowed)) : undefined),
    [windowed],
  );

  const chartWidth = width - spacing.lg * 4;

  if (!kind) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        <Stack.Screen options={{ title: 'Measurement' }} />
        <EmptyState icon="help-circle-outline" title="Unknown measurement" />
      </Screen>
    );
  }

  const label = MEASUREMENT_KIND_LABELS[kind];

  const header = (
    <Stack.Screen
      options={{
        title: label,
        // Filled: everything below the header is a readout: a chart and the
        // list of past readings, so adding one is the only thing the screen
        // can be visited to *do*, and the rest of it is what you look at
        // afterwards. Editing and deleting a reading are reached from the rows
        // themselves, which keeps this the header's only action.
        headerRight: () => (
          <HeaderAction
            label={`Log ${label}`}
            title="Log"
            variant="filled"
            onPress={() => setSheet({ mode: 'add' })}
          />
        ),
      }}
    />
  );

  const sheetEntry = sheet?.mode === 'edit' ? sheet.entry : null;

  const save = async (input: MeasurementEntryInput) => {
    if (sheetEntry) await updateMeasurement(sheetEntry.id, input);
    else await recordMeasurement({ kind, ...input });

    haptics.logged();
    setSheet(null);
    await reload();
  };

  // Confirmed rather than undone: a reading is a few characters to retype, and
  // an undo bar has nowhere to live on a screen whose bottom half is a list the
  // deletion just changed.
  const confirmDelete = (entry: BodyMeasurement) => {
    void (async () => {
      // The sheet this is asked from is itself a `Modal`, and so is the dialog.
      // Two of those on screen at once is not something Android stacks
      // reliably, so the sheet goes down first and comes back if the reading is
      // kept, which is the state the user was in when they asked. Under
      // `Alert.alert` this did not arise: a platform alert is not a React
      // Native modal and had nothing to collide with.
      setSheet(null);

      const confirmed = await showConfirm({
        title: 'Delete this reading?',
        message: `${formatMeasurementValue(kind, entry.value, prefs)} on ${longDate(entry.measuredAt)}.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep',
      });

      if (!confirmed) {
        setSheet({ mode: 'edit', entry });
        return;
      }

      await deleteMeasurement(entry.id);
      haptics.destructive();
      await reload();
    })();
  };

  const entrySheet = (
    <MeasurementEntrySheet
      visible={sheet !== null}
      kind={kind}
      entry={sheetEntry}
      previous={previousReading(rows, sheetEntry)}
      onCancel={() => setSheet(null)}
      onSubmit={(input) => void save(input)}
      onDelete={sheetEntry ? () => confirmDelete(sheetEntry) : undefined}
    />
  );

  if (!loaded) return <Screen scrolled={scrollEdge.progress}>{header}</Screen>;

  if (!stats || !overall) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        {header}
        <EmptyState
          icon="analytics-outline"
          title={`No ${label.toLowerCase()} logged`}
          description="Log a reading and this fills in with its trend, its rate of change and every entry behind it."
        />
        {entrySheet}
      </Screen>
    );
  }

  const latest = rows[rows.length - 1]!;

  // While a finger is on the chart the subtitle becomes the readout for the
  // point under it. The chart has no room for a tooltip, and a line of text
  // that was already there costs nothing to repurpose.
  const subtitle = scrubbed
    ? `${formatMeasurementValue(kind, scrubbed.y, prefs)} · ${longDate(new Date(scrubbed.x))}`
    : [
        overall.previous
          ? `${formatMeasurementDelta(kind, overall.latest.value - overall.previous.value, prefs)} since last`
          : 'First reading',
        describeRecency(Math.max(0, Math.round((now - latest.measuredAt.getTime()) / 86_400_000))),
      ].join(' · ');

  const [figure, unit] = splitMeasure(formatMeasurementValue(kind, latest.value, prefs));
  const insight = buildInsight(kind, windowed, prefs, { heightCm, counterpart });

  return (
    <Screen scrolled={scrollEdge.progress}>
      {header}

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        <View style={styles.masthead}>
          <Text variant="overline" color="textSecondary">
            Latest
          </Text>
          <Text variant="heading" numberOfLines={1} adjustsFontSizeToFit>
            {figure}
            {unit ? (
              <Text variant="label" color="textTertiary">
                {` ${unit}`}
              </Text>
            ) : null}
          </Text>
          <Text variant="caption" color={scrubbed ? 'text' : 'textSecondary'}>
            {subtitle}
          </Text>
        </View>

        <Card style={styles.card}>
          <SegmentedControl
            options={RANGES}
            value={range}
            label="Range"
            onChange={(next) => {
              haptics.selection();
              setScrubbed(null);
              setRange(next);
            }}
          />

          <LineChart
            data={toChartPoints(windowed)}
            overlay={trendLine}
            width={chartWidth}
            height={200}
            highlight={scrubbed}
            onScrub={setScrubbed}
            formatValue={(value) => formatMeasurementValue(kind, value, prefs, { withUnit: false })}
            formatLabel={(x) =>
              new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
            }
          />

          <Text variant="caption" color="textTertiary">
            {trendLine
              ? 'Drag across the chart to read a date. The dashed line is the smoothed trend.'
              : 'Drag across the chart to read a date.'}
          </Text>
        </Card>

        <StatBand
          style={styles.band}
          items={[
            {
              // First to last of exactly what the chart is drawing, so the
              // figure and the line can never disagree about the period.
              label: range === 'all' ? 'Overall' : `Last ${rangeLabel(range)}`,
              value:
                stats.count > 1
                  ? formatMeasurementDelta(kind, stats.change, prefs, { withUnit: false })
                  : '—',
              unit: stats.count > 1 ? unit : undefined,
              lead: true,
            },
            {
              label: 'Average',
              value: formatMeasurementValue(kind, stats.mean, prefs, { withUnit: false }),
              unit,
            },
            {
              label: 'Range',
              value: `${formatMeasurementValue(kind, stats.lowest.value, prefs, {
                withUnit: false,
              })}–${formatMeasurementValue(kind, stats.highest.value, prefs, { withUnit: false })}`,
              unit,
            },
          ]}
        />

        {insight.length > 0 && (
          <>
            <SectionHeader title="Reading this" />
            <Card padded={false} style={styles.card}>
              {insight.map((line, index) => (
                <View key={line.label}>
                  {index > 0 && <Divider inset={spacing.lg} />}
                  <View
                    accessible
                    accessibilityLabel={`${line.label}, ${line.value}${
                      line.detail ? `. ${line.detail}` : ''
                    }`}
                    style={styles.insightRow}
                  >
                    <View style={styles.insightText}>
                      <Text variant="bodyMedium">{line.label}</Text>
                      {line.detail && (
                        <Text variant="caption" color="textTertiary">
                          {line.detail}
                        </Text>
                      )}
                    </View>
                    <Text variant="numeric">{line.value}</Text>
                  </View>
                </View>
              ))}
            </Card>
          </>
        )}

        <SectionHeader title={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`} />
        <Card padded={false} style={styles.card}>
          {[...rows].reverse().map((row, index, reversed) => {
            const earlier = reversed[index + 1];
            const delta = earlier ? row.value - earlier.value : null;

            return (
              <View key={row.id}>
                {index > 0 && <Divider inset={spacing.lg} />}
                <Pressable
                  onPress={() => setSheet({ mode: 'edit', entry: row })}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatMeasurementValue(kind, row.value, prefs)} on ${longDate(
                    row.measuredAt,
                  )}${row.notes ? `. Note: ${row.notes}` : ''}`}
                  accessibilityHint="Opens this reading to correct or delete it."
                  style={({ pressed }) => [
                    styles.entryRow,
                    pressed && { backgroundColor: colors.surfacePressed },
                  ]}
                >
                  <View style={styles.entryText}>
                    <Text variant="body">{longDate(row.measuredAt)}</Text>
                    {row.notes ? (
                      <Text variant="caption" color="textTertiary" numberOfLines={1}>
                        {row.notes}
                      </Text>
                    ) : delta !== null ? (
                      <Text variant="caption" color="textTertiary">
                        {formatMeasurementDelta(kind, delta, prefs)}
                      </Text>
                    ) : (
                      <Text variant="caption" color="textTertiary">
                        First reading
                      </Text>
                    )}
                  </View>
                  <Text variant="numeric">{formatMeasurementValue(kind, row.value, prefs)}</Text>
                </Pressable>
              </View>
            );
          })}
        </Card>
      </ScrollView>

      {entrySheet}
    </Screen>
  );
}

interface InsightLine {
  label: string;
  value: string;
  detail?: string;
}

/**
 * What this particular measurement is worth saying beyond its own number.
 *
 * Per kind rather than one generic block: a rate of change is the whole point
 * of a bodyweight series and near-meaningless for a neck, a waist implies a
 * health marker no other circumference does, and a bicep only means something
 * against the other arm.
 */
function buildInsight(
  kind: MeasurementKind,
  points: readonly MeasurementPoint[],
  prefs: MeasurementUnitPreferences,
  context: { heightCm: number | null; counterpart: BodyMeasurement | null },
): InsightLine[] {
  const stats = summarizeMeasurements(points);
  if (!stats) return [];

  const lines: InsightLine[] = [];

  const rate = describeRate(kind, stats, prefs);
  if (rate) {
    lines.push({
      label: 'Rate of change',
      value: rate,
      detail: 'Fitted to every reading in this range, not just the two ends',
    });
  }

  if (kind === 'bodyweight') {
    lines.push({
      label: 'Trend weight',
      value: formatMeasurementValue(kind, stats.trend, prefs),
      detail: 'Weighted towards recent readings, so one heavy day cannot move it far',
    });

    const bmi = bodyMassIndex(stats.latest.value, context.heightCm);
    if (bmi != null) {
      lines.push({
        label: 'BMI',
        value: bmi.toFixed(1),
        detail: `${BMI_BAND_LABELS[bmiBand(bmi)]} · counts muscle and fat alike`,
      });
    }
  }

  if (kind === 'waist') {
    const ratio = waistToHeightRatio(stats.latest.value, context.heightCm);
    if (ratio != null) {
      lines.push({
        label: 'Waist-to-height',
        value: ratio.toFixed(2),
        detail: `${WAIST_BAND_LABELS[waistBand(ratio)]} · the guidance is to stay under 0.50`,
      });
    }
  }

  const other = MEASUREMENT_KIND_META[kind].counterpart;
  if (other && context.counterpart) {
    const meta = MEASUREMENT_KIND_META[kind];
    const isLeft = meta.side === 'left';
    const result = symmetry(
      isLeft ? stats.latest.value : context.counterpart.value,
      isLeft ? context.counterpart.value : stats.latest.value,
    );

    if (result) {
      lines.push({
        label: 'Against the other side',
        value:
          result.larger === 'even'
            ? 'Even'
            : `${result.larger === 'left' ? 'Left' : 'Right'} +${formatMeasurementValue(
                kind,
                result.difference,
                prefs,
              )}`,
        detail: `${MEASUREMENT_KIND_LABELS[other]} is ${formatMeasurementValue(
          other,
          context.counterpart.value,
          prefs,
        )} · ${trimZeros(result.percent.toFixed(1))}% apart`,
      });
    }
  }

  return lines;
}

/** The reading immediately before `entry`, or the newest one when adding. */
function previousReading(
  rows: readonly BodyMeasurement[],
  entry: BodyMeasurement | null,
): BodyMeasurement | null {
  if (!entry) return rows.length > 0 ? rows[rows.length - 1]! : null;

  const index = rows.findIndex((row) => row.id === entry.id);
  return index > 0 ? rows[index - 1]! : null;
}

function toChartPoints(points: readonly MeasurementPoint[]): DataPoint[] {
  return points.map((point) => ({ x: point.at, y: point.value }));
}

/** Guards the route param: a hand-typed URL must not index the metadata tables. */
function asMeasurementKind(value: string | undefined): MeasurementKind | null {
  return MEASUREMENT_KINDS.includes(value as MeasurementKind) ? (value as MeasurementKind) : null;
}

function rangeLabel(range: Range): string {
  switch (range) {
    case '90':
      return '3 months';
    case '180':
      return '6 months';
    case '365':
      return 'year';
    case 'all':
      return 'all';
  }
}

function longDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === new Date().getFullYear()
      ? { weekday: 'short', day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' };

  return date.toLocaleDateString(undefined, options);
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  masthead: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  card: { marginHorizontal: spacing.lg, gap: spacing.lg },
  band: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  insightText: { flex: 1, gap: 2 },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: MIN_TOUCH_SIZE,
  },
  entryText: { flex: 1, gap: 2 },
});
