/**
 * A lift (or a whole superset) with its table put away.
 *
 * The still is the demo: tapping it opens the clip without expanding. The rest
 * of the row opens the table. Progress is the only number, because a collapsed
 * row that restates weight and reps is a second table in miniature.
 */

import type { ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { ExerciseThumbnail } from '@/features/exercises/exercise-thumbnail';
import { HIT_SLOP, MIN_TOUCH_SIZE, spacing, useColors } from '@/theme';

import { unitSetProgress, type LiftUnit } from './lift-units';

const THUMBNAIL_SIZE = 40;

export function CollapsedLift({
  unit,
  onExpand,
  onOpenDemo,
}: {
  unit: LiftUnit;
  onExpand: () => void;
  onOpenDemo: () => void;
}) {
  const colors = useColors();
  const lead = unit.members[0]!.exercise;
  const names = unit.members.map((member) => member.exercise.name).join(' + ');
  const { done, total } = unitSetProgress(unit);
  const complete = total > 0 && done === total;

  return (
    <Pressable
      onPress={onExpand}
      accessibilityRole="button"
      accessibilityLabel={
        unit.label
          ? `Superset ${unit.label}, ${names}, ${done} of ${total} sets. Expand`
          : `${names}, ${done} of ${total} sets. Expand`
      }
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: colors.surfacePressed },
      ]}
    >
      <Pressable
        onPress={onOpenDemo}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={`Show ${lead.name} demonstration`}
      >
        <ExerciseThumbnail
          name={lead.name}
          url={lead.thumbnailUrl}
          size={THUMBNAIL_SIZE}
          style={styles.thumbnail}
        />
      </Pressable>

      <View style={styles.body}>
        {unit.label ? (
          <Text variant="overline" color="accent">
            Superset {unit.label}
          </Text>
        ) : null}
        <Text variant="bodyMedium" numberOfLines={2}>
          {names}
        </Text>
      </View>

      <Text
        variant="numeric"
        color={complete ? 'success' : 'textTertiary'}
        accessibilityLabel={`${done} of ${total} sets`}
      >
        {done}/{total}
      </Text>
      {complete ? (
        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
      ) : (
        <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
      )}
    </Pressable>
  );
}

/** The open pair: one label, both tables, no rule between them. */
export function SupersetGroup({ label, children }: { label: string; children: ReactNode }) {
  const colors = useColors();

  return (
    <View>
      <View style={styles.groupLabel}>
        <View style={[styles.groupRule, { backgroundColor: colors.accent }]} />
        <Text variant="overline" color="accent">
          Superset {label}
        </Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_SIZE,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  thumbnail: { borderRadius: 20 },
  body: { flex: 1, gap: 2 },
  groupLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  groupRule: { width: 2, height: 12, borderRadius: 1 },
});
