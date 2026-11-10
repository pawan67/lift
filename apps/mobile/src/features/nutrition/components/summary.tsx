/**
 * The day at a glance: a calorie ring and three macro bars, each against its
 * goal when there is one.
 *
 * The ring answers the only question most people open a food diary to ask
 * ("how much is left?") so the number in its middle is what remains, not what
 * was eaten. Over the goal it says so in the danger colour rather than going
 * negative, because "-240 remaining" makes the reader do arithmetic on a sign.
 */

import { formatCalories, type NutrientValues } from '@lift/shared';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Text } from '@/components/ui';
import { font, fontSize, radius, spacing, timing, useColors, type Palette } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type MacroKey = 'protein' | 'carbs' | 'fat';

export const MACROS: readonly { key: MacroKey; label: string }[] = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
];

/**
 * One colour per macro, from the palette's roles so every theme gets three it
 * can tell apart. Accent for protein because it is the macro this app's users
 * chase; the two warm roles for the other two.
 */
export function macroColors(colors: Palette): Record<MacroKey, string> {
  return { protein: colors.accent, carbs: colors.record, fat: colors.warning };
}

interface RingProps {
  eaten: number;
  goal: number | undefined;
  size?: number;
}

export function CalorieRing({ eaten, goal, size = 132 }: RingProps) {
  const colors = useColors();
  const stroke = 11;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  const fraction = goal && goal > 0 ? Math.min(eaten / goal, 1) : eaten > 0 ? 1 : 0;
  const over = !!goal && eaten > goal;

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(fraction, timing.travel);
  }, [fraction, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  const remaining = goal ? Math.round(goal - eaten) : null;

  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={ringLabel(eaten, goal)}>
      <Svg width={size} height={size} style={styles.ringSvg}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceMuted} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={over ? colors.danger : colors.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
          // Start at twelve o'clock rather than three.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringCenter} pointerEvents="none">
        {remaining === null ? (
          <>
            <Text variant="numericLarge" style={styles.ringNumber}>
              {formatCalories(eaten)}
            </Text>
            <Text variant="caption" color="textSecondary">
              kcal eaten
            </Text>
          </>
        ) : (
          <>
            <Text variant="numericLarge" color={over ? 'danger' : 'text'} style={styles.ringNumber}>
              {formatCalories(Math.abs(remaining))}
            </Text>
            <Text variant="caption" color="textSecondary">
              {over ? 'kcal over' : 'kcal left'}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

function ringLabel(eaten: number, goal: number | undefined): string {
  if (!goal) return `${formatCalories(eaten)} calories eaten`;
  const remaining = Math.round(goal - eaten);
  return remaining >= 0
    ? `${formatCalories(eaten)} of ${formatCalories(goal)} calories eaten, ${formatCalories(remaining)} left`
    : `${formatCalories(eaten)} of ${formatCalories(goal)} calories eaten, ${formatCalories(-remaining)} over`;
}

interface BarProps {
  label: string;
  value: number;
  goal: number | undefined;
  color: string;
}

export function MacroBar({ label, value, goal, color }: BarProps) {
  const colors = useColors();
  const fraction = goal && goal > 0 ? Math.min(value / goal, 1) : 0;
  const over = !!goal && value > goal * 1.05;

  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming(fraction, timing.travel);
  }, [fraction, width]);

  return (
    <View style={styles.bar} accessible accessibilityLabel={`${label} ${Math.round(value)} grams${goal ? ` of ${Math.round(goal)}` : ''}`}>
      <View style={styles.barHead}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text variant="label" color="textSecondary" style={styles.barLabel}>
          {label}
        </Text>
        <Text variant="numeric" color={over ? 'danger' : 'text'} style={styles.barValue}>
          {Math.round(value)}
          <Text variant="caption" color="textTertiary">
            {goal ? ` / ${Math.round(goal)} g` : ' g'}
          </Text>
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
        <AnimatedFill fraction={width} color={over ? colors.danger : color} />
      </View>
    </View>
  );
}

function AnimatedFill({ fraction, color }: { fraction: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => ({ width: `${fraction.value * 100}%` }));
  return <Animated.View style={[styles.fill, { backgroundColor: color }, style]} />;
}

/** Ring on the left, bars on the right: the head of the food tab. */
export function DaySummaryPanel({ totals, targets }: { totals: NutrientValues; targets: NutrientValues }) {
  const colors = useColors();
  const tint = macroColors(colors);
  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <CalorieRing eaten={totals.calories ?? 0} goal={targets.calories} />
      <View style={styles.bars}>
        {MACROS.map((macro) => (
          <MacroBar
            key={macro.key}
            label={macro.label}
            value={totals[macro.key] ?? 0}
            goal={targets[macro.key]}
            color={tint[macro.key]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ringSvg: { position: 'absolute' },
  ringCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ringNumber: { fontSize: fontSize.xxl, ...font('bold') },
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  bars: { flex: 1, gap: spacing.md },
  bar: { gap: 6 },
  barHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  barLabel: { flex: 1 },
  barValue: { fontSize: fontSize.sm },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
});
