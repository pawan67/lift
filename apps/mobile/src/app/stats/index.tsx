import { router, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BodyMap } from '@/components/charts/body-map';
import { Card, Divider, ListRow, Reveal, Screen, Text, useScrollEdge } from '@/components/ui';
import { DayStrip } from '@/features/analytics/day-strip';
import { VolumeAdviceSection } from '@/features/ai/volume-advice-section';
import { getMuscleBoard, type MuscleBoard } from '@/features/analytics/muscle-stats';
import { VolumeLegend } from '@/features/analytics/volume-legend';
import { addDays, startOfDay } from '@/features/analytics/windows';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { spacing, useContentWidth } from '@/theme';

/** Days the body graph at the top of this screen covers. */
const GRAPH_DAYS = 7;

/**
 * The screens this one leads to.
 *
 * Held as data rather than written out as seven `ListRow`s so the order, the
 * icons and the one-line descriptions live in one place. This list is the only
 * explanation most of these screens will ever get, and a description that
 * drifts from what the screen does is worse than none.
 *
 * Each row also names a `tone`, and there are exactly as many rows as there are
 * category hues. Six identical grey glyphs down a card is a list you have to
 * read end to end every time to find the screen you wanted; six different ones
 * is a list you navigate by shape after the second visit, which is the whole
 * argument for the pattern iOS uses in Settings. The tone is written beside the
 * entry rather than derived from its index for the reason `tones.ts` gives
 * about body parts: a row inserted in the middle would otherwise recolour every
 * row under it, and the colour someone had learned would move.
 */
const ADVANCED = [
  {
    href: '/stats/muscle-sets',
    tone: 'category0',
    icon: 'stats-chart-outline',
    title: 'Set count per muscle group',
    subtitle: 'How many sets each muscle got, period by period.',
  },
  {
    href: '/stats/muscle-distribution',
    tone: 'category1',
    icon: 'git-network-outline',
    title: 'Muscle distribution (chart)',
    subtitle: 'This window against the one before it.',
  },
  {
    href: '/stats/body-distribution',
    tone: 'category2',
    icon: 'body-outline',
    title: 'Muscle distribution (body)',
    subtitle: 'A week of sets, drawn on the figures.',
  },
  {
    href: '/stats/main-exercises',
    tone: 'category3',
    icon: 'barbell-outline',
    title: 'Main exercises',
    subtitle: 'The lifts your training is actually made of.',
  },
  {
    href: '/stats/leaderboard',
    tone: 'category4',
    icon: 'trophy-outline',
    title: 'Leaderboard exercises',
    subtitle: 'Which lifts your log can be ranked on.',
  },
  {
    href: '/stats/monthly-report',
    tone: 'category5',
    icon: 'calendar-outline',
    title: 'Monthly report',
    subtitle: 'A recap of one month, against the year around it.',
  },
] as const;

export default function StatisticsScreen() {
  const scrollEdge = useScrollEdge();

  // The column this screen is drawn in, not the window: see `useContentWidth`.
  const width = useContentWidth();
  const [board, setBoard] = useState<MuscleBoard | null>(null);

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        // The window ends at tomorrow's midnight rather than now, so a session
        // finished this evening lands on today's cell instead of just past the
        // edge of the graph that is meant to be showing it.
        const to = addDays(startOfDay(new Date()), 1);
        const from = addDays(to, -GRAPH_DAYS);

        // A rejection leaves the graph unknown rather than the screen broken:
        // everything below it is navigation and has to keep working.
        const next = await getMuscleBoard(from, to).catch(() => null);
        if (!cancelled) setBoard(next);
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  const mapWidth = width - spacing.lg * 2 - spacing.lg * 2;

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Statistics' }} />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        <Card style={styles.graph}>
          <View style={styles.graphHeader}>
            <Text variant="overline" color="textSecondary">
              Last {GRAPH_DAYS} days
            </Text>
            <Text variant="caption" color="textTertiary">
              {board ? summarise(board) : ' '}
            </Text>
          </View>

          {/* Nothing at all until the window has been counted. A body map drawn
              from an empty board is a figure with every muscle cold, which is a
              claim about the user's training and the wrong one to make on a
              first frame.

              The card around this is drawn from the first frame and only the
              graph inside it waits, so the `Reveal` goes here rather than
              around the screen: what arrives late is the figure, and the figure
              is what should be seen to arrive. The card holding its size around
              an empty space in the meantime is the honest shape of "counting". */}
          {board && (
            <Reveal>
              <DayStrip days={board.days} />
              <BodyMap width={mapWidth} setsPerWeek={board.setsPerWeek} maxHeight={260} />
              <VolumeLegend />
            </Reveal>
          )}
        </Card>

        {/*
         * Under the body map, because it is the same claim in words.
         *
         * The map has coloured a muscle dim for as long as the volume landmarks
         * have existed, and a colour is only legible to somebody who already
         * knows what the ramp means. This says it: four sets a week against a
         * minimum of ten. The window is four weeks rather than the map's seven
         * days and the card says so, because a weekly set count read off a
         * single week mostly reports which day of a split it happens to be.
         *
         * Absent rather than empty when the training is balanced. A card whose
         * good state is a blank space is a card that teaches people to skip it.
         */}
        <VolumeAdviceSection />

        {/* A plain overline rather than `SectionHeader`, whose own 16px indent
            is right on screens that scroll edge to edge and wrong here: this
            scroll view is already inset, so the shared component would put the
            heading 16px to the right of the card it sits above. */}
        <Text variant="overline" color="textSecondary" style={styles.sectionHeader}>
          Advanced statistics
        </Text>
        <Card padded={false}>
          {ADVANCED.map((entry, index) => (
            <View key={entry.href}>
              {index > 0 && <Divider inset={spacing.lg} />}
              <ListRow
                icon={entry.icon}
                tone={entry.tone}
                title={entry.title}
                subtitle={entry.subtitle}
                onPress={() => router.push(entry.href)}
              />
            </View>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function summarise(board: MuscleBoard): string {
  const trained = board.days.filter((day) => day.workouts > 0).length;
  if (trained === 0) return 'No sessions in this window';
  return `${trained} of ${board.days.length} days · ${board.totalSets} sets`;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
  graph: { gap: spacing.md },
  graphHeader: { gap: 2 },
  sectionHeader: { paddingTop: spacing.xl, paddingBottom: spacing.sm },
});
