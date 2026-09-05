import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { radius, readableOn, spacing, useColors } from '@/theme';

import type { DayActivity } from './muscle-stats';

export interface DayStripProps {
  days: DayActivity[];
}

/**
 * A week at a glance: one cell per day, filled on the days that were trained.
 *
 * Read-only, and that is the design rather than an omission. Every colour on
 * the body map below it comes from weekly volume landmarks. How many sets a
 * muscle needs in a *week* to grow, so filtering the map down to a single day
 * would leave the ramp measuring a rate against a window a seventh of its
 * length. Eight sets of chest in one session is a good chest day and would
 * paint as deep overreach. The strip therefore says which days were trained,
 * and the map keeps answering the question the landmarks can actually answer.
 */
export function DayStrip({ days }: DayStripProps) {
  const colors = useColors();

  return (
    <View style={styles.strip}>
      {days.map((day) => {
        const trained = day.workouts > 0;

        return (
          <View
            key={day.key}
            accessible
            accessibilityLabel={dayLabel(day)}
            style={[styles.cell, { backgroundColor: colors.surfaceMuted }]}
          >
            <Text variant="caption" color="textTertiary">
              {day.date.toLocaleDateString(undefined, { weekday: 'narrow' })}
            </Text>
            {/* A trained day fills in ink, the same as a square in the
                training-days grid and the month view. It was the accent, which
                made a full week of training the brightest object on whatever
                screen this strip appeared on. `readableOn` picks the foreground
                rather than a fixed token, because `text` is near-white on the
                dark palettes and near-black on the light ones. */}
            <View
              style={[
                styles.date,
                trained ? { backgroundColor: colors.text } : null,
              ]}
            >
              <Text
                variant="label"
                style={{ color: trained ? readableOn(colors.text, colors) : colors.textSecondary }}
              >
                {day.date.getDate()}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function dayLabel(day: DayActivity): string {
  const date = day.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  if (day.workouts === 0) return `${date}, rest day`;
  return `${date}, ${day.workouts === 1 ? '1 workout' : `${day.workouts} workouts`}, ${day.sets} sets`;
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: spacing.xs },
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  // A circle rather than the cell's own rounded rect, so the filled state reads
  // as a marked date rather than as a selected button.
  date: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
