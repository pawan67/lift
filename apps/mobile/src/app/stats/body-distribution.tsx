import { Ionicons } from '@expo/vector-icons';
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, type MuscleGroup } from '@lift/shared';
import { Stack } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BodyMap } from '@/components/charts/body-map';
import { Card, Divider, Screen, Text, useScrollEdge } from '@/components/ui';
import { DayStrip } from '@/features/analytics/day-strip';
import { formatSets } from '@/features/analytics/format';
import { getMuscleBoard, type MuscleBoard } from '@/features/analytics/muscle-stats';
import { VolumeLegend } from '@/features/analytics/volume-legend';
import { addDays, startOfDay, startOfWeek } from '@/features/analytics/windows';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { HIT_SLOP, MIN_TOUCH_SIZE, radius, spacing, stroke, useColors, useContentWidth } from '@/theme';

export default function BodyDistributionScreen() {
  const scrollEdge = useScrollEdge();

  // The column this screen is drawn in, not the window: see `useContentWidth`.
  const width = useContentWidth();
  const colors = useColors();
  const firstDayOfWeek = useSettings((state) => state.firstDayOfWeek);

  // Weeks back from the current one. An offset rather than a stored date so the
  // week the screen opens on cannot go stale while it sits in the background
  // over midnight on a Sunday.
  const [weeksBack, setWeeksBack] = useState(0);
  const [board, setBoard] = useState<MuscleBoard | null>(null);

  const week = useMemo(() => {
    const current = startOfWeek(startOfDay(new Date()), firstDayOfWeek);
    const from = addDays(current, -weeksBack * 7);
    return { from, to: addDays(from, 7) };
  }, [weeksBack, firstDayOfWeek]);

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const next = await getMuscleBoard(week.from, week.to).catch(() => null);
        if (!cancelled) setBoard(next);
      })();

      return () => {
        cancelled = true;
      };
    }, [week]),
  );

  // Only render figures that belong to the week on screen. The query is
  // asynchronous, and last week's map left up under this week's date range is
  // read as this week's.
  const current = board?.from === week.from.getTime() ? board : null;

  const mapWidth = width - spacing.lg * 2 - spacing.lg * 2;
  const setsByMuscle = useMemo(() => {
    const out = new Map<MuscleGroup, number>();
    for (const entry of current?.muscles ?? []) out.set(entry.muscle, entry.directSets);
    return out;
  }, [current]);

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Body distribution' }} />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        <View style={styles.nav}>
          <NavButton
            icon="chevron-back"
            label="Previous week"
            onPress={() => setWeeksBack((weeks) => weeks + 1)}
          />
          <Text variant="bodyMedium" align="center" numberOfLines={1} style={styles.navTitle}>
            {formatWeek(week.from, week.to)}
          </Text>
          <NavButton
            icon="chevron-forward"
            label="Next week"
            // The current week is the end of the road: there is nothing after
            // it to show, and a live arrow that does nothing reads as broken.
            disabled={weeksBack === 0}
            onPress={() => setWeeksBack((weeks) => Math.max(0, weeks - 1))}
          />
        </View>

        <Card style={styles.mapCard}>
          {current ? (
            <>
              <DayStrip days={current.days} />
              <BodyMap width={mapWidth} setsPerWeek={current.setsPerWeek} maxHeight={280} />
              <VolumeLegend />
            </>
          ) : (
            <View style={styles.pending}>
              <Text variant="label" color="textTertiary">
                —
              </Text>
            </View>
          )}
        </Card>

        {/* The full table, not just the muscles that were trained.
            A zero is the answer to "did I do any calves this week", and a table
            that only lists what happened cannot answer it. The reader is left
            scanning for a row that was never printed. */}
        <Card padded={false}>
          <View
            style={[
              styles.tableHead,
              { backgroundColor: colors.surfaceMuted, borderBottomColor: colors.border },
            ]}
          >
            <Text variant="overline" color="textSecondary" style={styles.flex}>
              Muscle
            </Text>
            <Text variant="overline" color="textSecondary">
              Sets
            </Text>
          </View>

          <Row label="Total" value={current ? String(current.totalSets) : '—'} emphasised />

          {MUSCLE_GROUPS.map((muscle) => (
            <View key={muscle}>
              <Divider />
              <Row
                label={MUSCLE_GROUP_LABELS[muscle]}
                value={current ? String(setsByMuscle.get(muscle) ?? 0) : '—'}
                muted={current ? (setsByMuscle.get(muscle) ?? 0) === 0 : false}
              />
            </View>
          ))}
        </Card>

        <Text variant="caption" color="textTertiary" style={styles.footnote}>
          The table counts sets by their target muscle, so the rows add up to the total. The
          figures are shaded on the body above using a weekly rate that also credits assisting
          muscles at half a set{current ? `: ${assistNote(current)}` : ''}.
        </Text>
      </ScrollView>
    </Screen>
  );
}

/**
 * How much of the week's colour came from assistance.
 *
 * Stated as a number rather than left implicit, because the map and the table
 * disagreeing is the first thing anyone notices on this screen.
 */
function assistNote(board: MuscleBoard): string {
  const weighted = board.muscles.reduce((sum, entry) => sum + entry.sets, 0);
  const indirect = weighted - board.totalSets;
  if (indirect <= 0) return 'nothing this week was credited indirectly';
  return `${formatSets(indirect)} set-equivalents this week came that way`;
}

function formatWeek(from: Date, to: Date): string {
  const last = addDays(to, -1);
  const sameMonth = from.getMonth() === last.getMonth() && from.getFullYear() === last.getFullYear();

  const start = from.toLocaleDateString(
    undefined,
    sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' },
  );
  const end = last.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `${start}–${end}`;
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
      hitSlop={HIT_SLOP}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navButton,
        pressed && !disabled ? { backgroundColor: colors.surfacePressed } : null,
      ]}
    >
      <Ionicons
        name={icon}
        size={22}
        color={disabled ? colors.border : colors.textSecondary}
      />
    </Pressable>
  );
}

function Row({
  label,
  value,
  emphasised = false,
  muted = false,
}: {
  label: string;
  value: string;
  emphasised?: boolean;
  muted?: boolean;
}) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value} sets`} style={styles.row}>
      <Text
        variant={emphasised ? 'bodyMedium' : 'body'}
        color={muted ? 'textTertiary' : 'text'}
        numberOfLines={1}
        style={styles.flex}
      >
        {label}
      </Text>
      {/* Emphasis is carried by the label's `bodyMedium` beside it, not by a
          hue on the figure. There is nothing above `text` to emphasise *with*
          now, which is the honest constraint: weight is the channel. */}
      <Text variant="numeric" color={muted ? 'textTertiary' : 'text'}>
        {value}
      </Text>
    </View>
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
  mapCard: { gap: spacing.md },
  pending: { height: 260, alignItems: 'center', justifyContent: 'center' },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: stroke.rule,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  flex: { flex: 1 },
  footnote: { paddingHorizontal: spacing.xs },
});
