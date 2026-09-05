import { Ionicons } from '@expo/vector-icons';
import {
  MEASUREMENT_GROUPS,
  MEASUREMENT_GROUP_KINDS,
  MEASUREMENT_GROUP_LABELS,
  MEASUREMENT_KINDS,
  MEASUREMENT_KIND_LABELS,
  STARTER_MEASUREMENT_KINDS,
  formatMeasurementDelta,
  formatMeasurementValue,
  measurementUnitLabel,
  type MeasurementKind,
  type MeasurementUnitPreferences,
} from '@lift/shared';
import { router, Stack } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Sparkline } from '@/components/charts/sparkline';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  HeaderAction,
  Screen,
  SectionHeader,
  StatBand,
  Text,
  splitMeasure,
  useScrollEdge,
  type StatFigure,
} from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import {
  MeasurementEntrySheet,
  type MeasurementEntryInput,
} from '@/features/measurements/entry-sheet';
import {
  buildBodyFigures,
  buildSymmetryNotes,
  describeRate,
  describeRecency,
  describeSummary,
  missingInputHint,
  STALE_AFTER_DAYS,
  summarizeKinds,
  type BodyFigure,
  type KindSummary,
} from '@/features/measurements/insights';
import {
  getMeasurementLog,
  recordMeasurement,
  type MeasurementLog,
} from '@/features/measurements/repository';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { MIN_TOUCH_SIZE, spacing, useColors } from '@/theme';

/**
 * What the entry sheet is currently doing. A guided session is the same sheet
 * walked over a list of kinds, which is why the two share one state rather than
 * each keeping their own copy of "which body part".
 */
type SheetState =
  | { mode: 'single'; kind: MeasurementKind }
  | { mode: 'session'; kinds: MeasurementKind[]; index: number }
  | null;

/**
 * The body screen.
 *
 * It used to be fifteen rows of "label. Number", where the number was the last
 * thing you typed and a tap unfolded a chart. That is a filing cabinet: it
 * stores measurements faithfully and answers no question you would open it to
 * ask. What people want from a tape measure is direction. Is this moving, how
 * fast, and what does it imply, so the direction is now on the surface. Every
 * row carries its shape and its change, the figures a tape implies but does not
 * state are computed above them, and the tap goes to a screen that can hold a
 * real chart instead of a 140pt sliver wedged into a list.
 */
export default function MeasurementsScreen() {
  const scrollEdge = useScrollEdge();

  const colors = useColors();

  // Primitive selectors, never an object literal: Zustand feeds the selector's
  // result to `useSyncExternalStore`, which re-renders on identity change.
  const weightUnit = useSettings((state) => state.weightUnit);
  const measurementUnit = useSettings((state) => state.measurementUnit);
  const heightCm = useSettings((state) => state.heightCm);
  const sex = useSettings((state) => state.sex);
  const prefs = useMemo(() => ({ weightUnit, measurementUnit }), [weightUnit, measurementUnit]);

  const [log, setLog] = useState<MeasurementLog>(() => new Map());
  const [loaded, setLoaded] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);

  // Stamped when the data is read rather than on every render, so "3 days ago"
  // is computed against one instant for the whole screen instead of drifting
  // row by row as the list renders.
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    const next = await getMeasurementLog().catch(() => null);
    if (next) {
      setLog(next);
      setNow(Date.now());
    }
    setLoaded(true);
  }, []);

  useDeferredFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const summaries = useMemo(() => summarizeKinds(log, now), [log, now]);

  const figureInput = useMemo(
    () => ({ summaries, prefs, heightCm, sex }),
    [summaries, prefs, heightCm, sex],
  );
  const figures = useMemo(() => buildBodyFigures(figureInput), [figureInput]);
  const hint = useMemo(() => missingInputHint(figureInput), [figureInput]);
  const symmetry = useMemo(() => buildSymmetryNotes(summaries, prefs), [summaries, prefs]);

  const bodyweight = summaries.get('bodyweight') ?? null;
  const activeKind = sheet ? (sheet.mode === 'single' ? sheet.kind : sheet.kinds[sheet.index]!) : null;

  const startSession = () => {
    // Whatever this person already tracks, in the declared order. A session is
    // for repeating a set of measurements, not for discovering new ones. With
    // nothing tracked yet it falls back to the starter set rather than marching
    // a first-time user through all fifteen.
    const tracked = MEASUREMENT_KINDS.filter((kind) => summaries.has(kind));
    const kinds = tracked.length > 0 ? tracked : STARTER_MEASUREMENT_KINDS;

    haptics.added();
    setSheet({ mode: 'session', kinds, index: 0 });
  };

  const advance = () => {
    setSheet((current) => {
      if (!current || current.mode !== 'session') return null;

      const next = current.index + 1;
      if (next >= current.kinds.length) {
        haptics.finished();
        return null;
      }
      return { ...current, index: next };
    });
  };

  const submit = async (input: MeasurementEntryInput) => {
    if (!activeKind) return;

    await recordMeasurement({ kind: activeKind, ...input });
    haptics.logged();
    await reload();

    if (sheet?.mode === 'session') advance();
    else setSheet(null);
  };

  const header = (
    <Stack.Screen
      options={{
        title: 'Body',
        headerRight: () => (
          <HeaderAction
            label="Take measurements"
            icon="add"
            iconSize={24}
            onPress={startSession}
          />
        ),
      }}
    />
  );

  // The query answers a tick after mount, so the empty state has to wait for
  // it. Otherwise every visit opens on "Nothing logged yet" and corrects
  // itself a frame later. The header stays mounted so the native title does not
  // flash the route name. Same rule as records.tsx and history.tsx.
  if (!loaded) {
    return <Screen scrolled={scrollEdge.progress}>{header}</Screen>;
  }

  if (summaries.size === 0) {
    return (
      <Screen scrolled={scrollEdge.progress}>
        {header}
        <EmptyState
          icon="body-outline"
          title="Nothing logged yet"
          description="A tape measure and a scale tell you what the training log cannot: whether any of it is changing you. Eight measurements is enough to start."
          action={<Button title="Take measurements" onPress={startSession} />}
        />
        <EntrySheet
          sheet={sheet}
          kind={activeKind}
          log={log}
          onCancel={() => setSheet(null)}
          onSkip={advance}
          onSubmit={submit}
        />
      </Screen>
    );
  }

  return (
    <Screen scrolled={scrollEdge.progress}>
      {header}

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        {/*
         * Bodyweight leads because it is the one measurement almost everyone
         * takes, the one taken most often, and the only one the rest of the app
         * reads back. Push-ups and dips are valued at it. Tapping the figure
         * logs a new one, which makes the most common action on this screen the
         * largest target on it.
         */}
        <Pressable
          onPress={() => setSheet({ mode: 'single', kind: 'bodyweight' })}
          accessibilityRole="button"
          accessibilityLabel={
            bodyweight
              ? `Bodyweight, ${formatMeasurementValue('bodyweight', bodyweight.latest.value, prefs)}`
              : 'Bodyweight, not logged'
          }
          accessibilityHint="Logs a new bodyweight."
          style={({ pressed }) => [
            styles.masthead,
            pressed && { backgroundColor: colors.surfacePressed },
          ]}
        >
          <Text variant="overline" color="textSecondary">
            Bodyweight
          </Text>
          <Masthead summary={bodyweight} prefs={prefs} />
        </Pressable>

        <StatBand style={styles.band} items={buildBand(bodyweight, figures, prefs, summaries)} />

        {/*
         * The one control that starts a measuring session, sized as the primary
         * action of the screen. The header carries the same action as an icon
         * for anyone who already knows where it is.
         */}
        <View style={styles.session}>
          <Button
            title="Take measurements"
            icon="resize-outline"
            fullWidth
            accessibilityLabel="Take measurements, stepping through everything you track"
            onPress={startSession}
          />
        </View>

        {(figures.length > 0 || hint) && (
          <>
            <SectionHeader title="What this implies" />
            <Card padded={false} style={styles.card}>
              {figures.map((figure, index) => (
                <View key={figure.key}>
                  {index > 0 && <Divider inset={spacing.lg} />}
                  <View
                    accessible
                    accessibilityLabel={`${figure.label}, ${figure.value}. ${figure.detail}`}
                    style={styles.figureRow}
                  >
                    <View style={styles.figureText}>
                      <View style={styles.figureLabel}>
                        <Text variant="bodyMedium">{figure.label}</Text>
                        {/* Named as an estimate wherever it is shown. These are
                            regressions on a tape measure, and the difference
                            between that and a reading matters most to exactly
                            the people who will act on it. */}
                        {figure.estimated && <Badge label="Est." tone="neutral" />}
                      </View>
                      <Text variant="caption" color="textTertiary">
                        {figure.detail}
                      </Text>
                    </View>
                    <Text variant="numeric">{figure.value}</Text>
                  </View>
                </View>
              ))}

              {hint && (
                <>
                  {figures.length > 0 && <Divider inset={spacing.lg} />}
                  <Pressable
                    onPress={() =>
                      // Straight to the page holding height and sex, not to the
                      // settings hub: the hint names the figure that is
                      // missing, and landing a level above it makes the reader
                      // go looking for what they were just sent to fix.
                      hint.action === 'settings'
                        ? router.push('/settings/body')
                        : setSheet({ mode: 'single', kind: hint.kind })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={hint.message}
                    style={({ pressed }) => [
                      styles.hintRow,
                      pressed && { backgroundColor: colors.surfacePressed },
                    ]}
                  >
                    <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                    <Text variant="caption" color="textSecondary" style={styles.flex}>
                      {hint.message}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </Pressable>
                </>
              )}
            </Card>
          </>
        )}

        {symmetry.length > 0 && (
          <>
            <SectionHeader title="Left against right" />
            <Card padded={false} style={styles.card}>
              {symmetry.map((note, index) => (
                <View key={note.label}>
                  {index > 0 && <Divider inset={spacing.lg} />}
                  <View
                    accessible
                    accessibilityLabel={`${note.label}, ${note.summary}`}
                    style={styles.figureRow}
                  >
                    <Text variant="bodyMedium" style={styles.flex}>
                      {note.label}
                    </Text>
                    <Text
                      variant="numeric"
                      color={note.notable ? 'warning' : 'textSecondary'}
                      numberOfLines={1}
                    >
                      {note.summary}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
            <Text variant="caption" color="textTertiary" style={styles.footnote}>
              A couple of percent between sides is ordinary. A gap that holds for months is the kind
              of thing single-arm and single-leg work is for.
            </Text>
          </>
        )}

        {MEASUREMENT_GROUPS.map((group) => (
          <View key={group}>
            <SectionHeader title={MEASUREMENT_GROUP_LABELS[group]} />
            <Card padded={false} style={styles.card}>
              {MEASUREMENT_GROUP_KINDS[group].map((kind, index) => (
                <View key={kind}>
                  {index > 0 && <Divider inset={spacing.lg} />}
                  <MeasurementRow
                    kind={kind}
                    summary={summaries.get(kind) ?? null}
                    prefs={prefs}
                    onOpen={() =>
                      router.push({ pathname: '/measurement/[kind]', params: { kind } })
                    }
                    onLog={() => setSheet({ mode: 'single', kind })}
                  />
                </View>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>

      <EntrySheet
        sheet={sheet}
        kind={activeKind}
        log={log}
        onCancel={() => setSheet(null)}
        onSkip={advance}
        onSubmit={submit}
      />
    </Screen>
  );
}

/** The figure itself, or an invitation when there is nothing to print. */
function Masthead({
  summary,
  prefs,
}: {
  summary: KindSummary | null;
  prefs: MeasurementUnitPreferences;
}) {
  if (!summary) {
    return (
      <>
        <Text variant="heading" color="textTertiary">
          —
        </Text>
        <Text variant="caption" color="textSecondary">
          {`Not logged yet · tap to add one in ${measurementUnitLabel('bodyweight', prefs)}`}
        </Text>
      </>
    );
  }

  const [value, unit] = splitMeasure(
    formatMeasurementValue('bodyweight', summary.latest.value, prefs),
  );

  const rate = describeRate('bodyweight', summary.stats, prefs);
  const month =
    summary.sinceMonth == null
      ? null
      : `${formatMeasurementDelta('bodyweight', summary.sinceMonth, prefs)} in 30 days`;

  // Three facts at most, and never a bare date: what it is, where it is going,
  // and how old the reading is.
  const line = [month, rate, describeRecency(summary.daysAgo)].filter(Boolean).join(' · ');

  return (
    <>
      <Text variant="heading" numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {unit ? (
          <Text variant="label" color="textTertiary">
            {` ${unit}`}
          </Text>
        ) : null}
      </Text>
      <Text variant="caption" color="textSecondary">
        {line}
      </Text>
    </>
  );
}

/**
 * One measurement: its shape, its current value and how it got there.
 *
 * Two siblings under a plain View, not a Pressable inside a Pressable.
 * Android's touch handling gives the whole area to the outer one, so a nested
 * button is unreachable there and works only on iOS. Each half carries its own
 * 44pt, which also avoids the overlapping hitSlop the two would otherwise need.
 */
function MeasurementRow({
  kind,
  summary,
  prefs,
  onOpen,
  onLog,
}: {
  kind: MeasurementKind;
  summary: KindSummary | null;
  prefs: MeasurementUnitPreferences;
  onOpen: () => void;
  onLog: () => void;
}) {
  const colors = useColors();
  const label = MEASUREMENT_KIND_LABELS[kind];

  // Deliberately not colour-coded. Whether a waist going up is good news
  // depends on what the person is training for, and an app that paints one
  // direction red has decided that for them.
  const detail = summary
    ? [
        summary.sinceLast == null
          ? 'First reading'
          : formatMeasurementDelta(kind, summary.sinceLast, prefs),
        describeRecency(summary.daysAgo),
      ].join(' · ')
    : 'Not tracked';

  const stale = summary != null && summary.daysAgo > STALE_AFTER_DAYS;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={summary ? onOpen : onLog}
        accessibilityRole="button"
        accessibilityLabel={summary ? describeSummary(summary, prefs) : `${label}, not tracked`}
        accessibilityHint={summary ? 'Opens the trend and full history.' : 'Logs a first reading.'}
        style={({ pressed }) => [
          styles.rowMain,
          pressed && { backgroundColor: colors.surfacePressed },
        ]}
      >
        <View style={styles.rowText}>
          <Text variant="body" numberOfLines={1}>
            {label}
          </Text>
          <Text variant="caption" color={stale ? 'warning' : 'textTertiary'} numberOfLines={1}>
            {detail}
          </Text>
        </View>

        {summary && summary.spark.length > 1 && (
          <Sparkline values={summary.spark} color={colors.textTertiary} />
        )}

        <Text variant="numeric" color={summary ? 'text' : 'textTertiary'}>
          {summary ? formatMeasurementValue(kind, summary.latest.value, prefs) : '—'}
        </Text>
      </Pressable>

      <Pressable
        onPress={onLog}
        accessibilityRole="button"
        accessibilityLabel={`Log ${label}`}
        style={({ pressed }) => [styles.add, pressed && { backgroundColor: colors.surfacePressed }]}
      >
        <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
      </Pressable>
    </View>
  );
}

/** Wires the shared sheet to whichever mode the screen is in. */
function EntrySheet({
  sheet,
  kind,
  log,
  onCancel,
  onSkip,
  onSubmit,
}: {
  sheet: SheetState;
  kind: MeasurementKind | null;
  log: MeasurementLog;
  onCancel: () => void;
  onSkip: () => void;
  onSubmit: (input: MeasurementEntryInput) => void;
}) {
  const rows = kind ? log.get(kind) : undefined;

  return (
    <MeasurementEntrySheet
      visible={sheet !== null}
      kind={kind}
      previous={rows && rows.length > 0 ? rows[rows.length - 1]! : null}
      progress={
        sheet?.mode === 'session'
          ? { index: sheet.index, total: sheet.kinds.length }
          : null
      }
      onCancel={onCancel}
      onSkip={onSkip}
      onSubmit={onSubmit}
    />
  );
}

/**
 * The three figures under the masthead, taken from whatever can be computed.
 *
 * A band of "—" would be three columns of nothing; taking the first three of an
 * ordered list of candidates means the row is always full and always says
 * something, whether the log holds one bodyweight or a decade of tape readings.
 */
function buildBand(
  bodyweight: KindSummary | null,
  figures: BodyFigure[],
  prefs: MeasurementUnitPreferences,
  summaries: Map<MeasurementKind, KindSummary>,
): StatFigure[] {
  const candidates: StatFigure[] = [];

  if (bodyweight && bodyweight.stats.count > 1) {
    const [value, unit] = splitMeasure(
      formatMeasurementValue('bodyweight', bodyweight.stats.trend, prefs),
    );
    // The smoothed figure, not the last reading. A scale swings a kilo on salt
    // and sleep, so the newest number is the noisiest estimate of where someone
    // actually is. This is the one to compare month to month.
    candidates.push({ label: 'Trend', value, unit, lead: true });

    const rate = describeRate('bodyweight', bodyweight.stats, prefs);
    if (rate) {
      const [magnitude, rateUnit] = splitMeasure(
        formatMeasurementDelta('bodyweight', bodyweight.stats.changePerWeek!, prefs),
      );
      candidates.push({ label: 'Per week', value: magnitude, unit: rateUnit });
    }
  }

  for (const figure of figures) {
    const [value, unit] = splitMeasure(figure.value);
    candidates.push({ label: figure.label, value, unit });
  }

  candidates.push({ label: 'Tracked', value: String(summaries.size) });

  return candidates.slice(0, 3);
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  masthead: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  band: { marginHorizontal: spacing.lg },
  session: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  card: { marginHorizontal: spacing.lg },
  flex: { flex: 1 },
  figureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  figureText: { flex: 1, gap: 2 },
  figureLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: MIN_TOUCH_SIZE,
  },
  footnote: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_SIZE,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    paddingVertical: spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  add: {
    minWidth: MIN_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: spacing.lg - spacing.sm,
  },
});
