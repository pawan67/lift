/**
 * Calories in the middle, and where they come from around it.
 *
 * A donut split three ways by each macro's share of the calories (protein and
 * carbs at 4 kcal a gram, fat at 9), so a fried snack reads as mostly fat at a
 * glance even when its fat grams look small beside the carbs. Beside it, each
 * macro's grams and share. Static: the figures change as the amount is typed,
 * and a ring that animates on every keystroke is a ring that is never still.
 */

import { formatCalories, formatNutrientValue, macroEnergySplit, type NutrientValues } from '@lift/shared';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { Card, Text } from '@/components/ui';
import { font, fontSize, spacing, useColors } from '@/theme';

import { macroColors } from './summary';

const MACROS = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
] as const;

/** Space between segments, in degrees, so three touching colours still read as three. */
const GAP_DEGREES = 3;

export function MacroRing({ totals, size = 132 }: { totals: NutrientValues; size?: number }) {
  const colors = useColors();
  const tint = macroColors(colors);
  const split = macroEnergySplit(totals);

  const stroke = 14;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const shown = MACROS.filter((macro) => (split?.[macro.key] ?? 0) > 0);
  const gap = shown.length > 1 ? (GAP_DEGREES / 360) * circumference : 0;

  const lengths = shown.map((macro) => split![macro.key] * circumference);
  const segments = shown.map((macro, index) => ({
    key: macro.key,
    dash: Math.max(lengths[index]! - gap, 0.5),
    // Each segment starts where the ones before it end.
    offset: lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  }));

  const summary = MACROS.map(
    (macro) => `${macro.label} ${formatNutrientValue(macro.key, totals[macro.key] ?? 0)} grams`,
  ).join(', ');

  return (
    <Card style={styles.card}>
      <View
        style={{ width: size, height: size }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${formatCalories(totals.calories)} calories. ${summary}.`}
      >
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceMuted} strokeWidth={stroke} fill="none" />
          {/* Rotated so the first segment starts at twelve o'clock. */}
          <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
            {segments.map((segment) => (
              <Circle
                key={segment.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={tint[segment.key]}
                strokeWidth={stroke}
                fill="none"
                strokeDasharray={`${segment.dash} ${circumference}`}
                strokeDashoffset={-segment.offset}
              />
            ))}
          </G>
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.centre]} pointerEvents="none">
          <Text style={styles.kcal}>{formatCalories(totals.calories)}</Text>
          <Text variant="caption" color="textSecondary">
            kcal
          </Text>
        </View>
      </View>

      <View style={styles.legend} importantForAccessibility="no-hide-descendants">
        {MACROS.map((macro) => (
          <View key={macro.key} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: tint[macro.key] }]} />
            <View style={styles.legendText}>
              <Text variant="caption" color="textSecondary">
                {macro.label}
              </Text>
              <Text variant="numeric">
                {totals[macro.key] === undefined ? '–' : formatNutrientValue(macro.key, totals[macro.key]!)}
                <Text variant="caption" color="textTertiary">
                  {' g'}
                </Text>
              </Text>
            </View>
            <Text variant="caption" color="textTertiary" style={styles.percent}>
              {split ? `${Math.round(split[macro.key] * 100)}%` : ''}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  centre: { alignItems: 'center', justifyContent: 'center' },
  kcal: { fontSize: fontSize.xxl, ...font('bold'), fontVariant: ['tabular-nums'] },
  legend: { flex: 1, gap: spacing.md },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { flex: 1 },
  percent: { minWidth: 36, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
