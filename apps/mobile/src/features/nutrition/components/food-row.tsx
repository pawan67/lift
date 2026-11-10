/**
 * One food in a list: name, what one serving is, its calories, and its macros
 * as three small coloured figures. The same row in the diary, search results,
 * recents, favourites and templates, so a food looks the same wherever it is.
 *
 * The optional trailing button is the fast path. In the add screen it logs the
 * food at its last-used amount in one tap without opening the portion screen,
 * which is how "add foods easily" is actually met for the foods eaten daily.
 */

import { Ionicons } from '@expo/vector-icons';
import { formatCalories, type NutrientValues } from '@lift/shared';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PressableScale, Text } from '@/components/ui';
import { HIT_SLOP, radius, spacing, useColors } from '@/theme';

import { macroColors } from './summary';

export interface FoodRowProps {
  name: string;
  /** "Amul · 1 cup (240 g)", "2 × 1 medium", "3 items". */
  detail?: string;
  /** Figures for what the row stands for (already multiplied by quantity). */
  nutrients: NutrientValues;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Shown before the name: a star for favourites, a sparkle for AI. */
  badge?: ReactNode;
  trailing?: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; done?: boolean };
  accessibilityHint?: string;
}

function Macro({ value, color, letter }: { value: number | undefined; color: string; letter: string }) {
  return (
    <View style={styles.macro}>
      <View style={[styles.macroDot, { backgroundColor: color }]} />
      <Text variant="caption" color="textSecondary" style={styles.macroText}>
        {value === undefined ? '–' : Math.round(value)}
        {letter}
      </Text>
    </View>
  );
}

export function FoodRow({ name, detail, nutrients, onPress, onLongPress, badge, trailing, accessibilityHint }: FoodRowProps) {
  const colors = useColors();
  const tint = macroColors(colors);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [styles.row, pressed && onPress && { backgroundColor: colors.surfacePressed }]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${name}, ${formatCalories(nutrients.calories)} calories${detail ? `, ${detail}` : ''}`}
      accessibilityHint={accessibilityHint}
    >
      <View style={styles.body}>
        <View style={styles.titleLine}>
          {badge}
          <Text variant="bodyMedium" numberOfLines={1} style={styles.name}>
            {name}
          </Text>
        </View>
        <View style={styles.metaLine}>
          {detail ? (
            <Text variant="caption" color="textTertiary" numberOfLines={1} style={styles.detail}>
              {detail}
            </Text>
          ) : null}
          <View style={styles.macros}>
            <Macro value={nutrients.protein} color={tint.protein} letter="P" />
            <Macro value={nutrients.carbs} color={tint.carbs} letter="C" />
            <Macro value={nutrients.fat} color={tint.fat} letter="F" />
          </View>
        </View>
      </View>

      <View style={styles.kcal}>
        <Text variant="numeric" style={styles.kcalValue}>
          {formatCalories(nutrients.calories)}
        </Text>
        <Text variant="caption" color="textTertiary">
          kcal
        </Text>
      </View>

      {trailing ? (
        <PressableScale
          onPress={trailing.onPress}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={trailing.label}
          style={[
            styles.trailing,
            { backgroundColor: trailing.done ? colors.successSurface : colors.accentSurface },
          ]}
        >
          <Ionicons
            name={trailing.done ? 'checkmark' : trailing.icon}
            size={20}
            color={trailing.done ? colors.success : colors.accent}
          />
        </PressableScale>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  body: { flex: 1, gap: 3 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { flexShrink: 1 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detail: { flexShrink: 1 },
  macros: { flexDirection: 'row', gap: spacing.sm },
  macro: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  macroDot: { width: 5, height: 5, borderRadius: 3 },
  macroText: { fontVariant: ['tabular-nums'] },
  kcal: { alignItems: 'flex-end', minWidth: 44 },
  kcalValue: { lineHeight: 20 },
  trailing: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
