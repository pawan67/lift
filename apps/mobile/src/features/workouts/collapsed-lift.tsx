/**
 * A lift (or a whole superset) with its table put away.
 *
 * The still is the demo: tapping it opens the clip without expanding. The rest
 * of the row opens the table. Progress is the only number, because a collapsed
 * row that restates weight and reps is a second table in miniature.
 */

import type { ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { PressableScale, Text } from '@/components/ui';
import { ExerciseThumbnail } from '@/features/exercises/exercise-thumbnail';
import {
  HIT_SLOP,
  MIN_TOUCH_SIZE,
  PRESS_SCALE_SMALL,
  spacing,
  translucent,
  useColors,
} from '@/theme';

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
    <PressableScale
      onPress={onExpand}
      accessibilityRole="button"
      accessibilityLabel={
        unit.label
          ? `Superset ${unit.label}, ${names}, ${done} of ${total} sets. Expand`
          : `${names}, ${done} of ${total} sets. Expand`
      }
      /*
       * The crossfade alone, with no scale.
       *
       * This is a full-bleed row: its edges are the screen's margins, so
       * shrinking it pulls both of them inward at once and reads as the row
       * coming away from the page rather than being pushed into it. The rule
       * is stated in `motion.ts` and this is the case it was written for. The
       * fill still has to be a real transition, though: the row's whole job is
       * to be tapped, and it is the one control between one exercise and the
       * next.
       */
      scaleTo={1}
      fill={translucent(colors.surfacePressed, 0)}
      fillPressed={colors.surfacePressed}
      style={styles.row}
    >
      <PressableScale
        onPress={onOpenDemo}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={`Show ${lead.name} demonstration`}
        scaleTo={PRESS_SCALE_SMALL}
      >
        <ExerciseThumbnail
          name={lead.name}
          url={lead.thumbnailUrl}
          size={THUMBNAIL_SIZE}
          style={styles.thumbnail}
        />
      </PressableScale>

      <View style={styles.body}>
        {/* `textSecondary`, matching `supersetColor`: the letter is the
            identity, so the accent on it was naming A twice. */}
        {unit.label ? (
          <Text variant="overline" color="textSecondary">
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
    </PressableScale>
  );
}

/** The open pair: one label, both tables, no rule between them. */
export function SupersetGroup({ label, children }: { label: string; children: ReactNode }) {
  const colors = useColors();

  return (
    <View>
      <View style={styles.groupLabel}>
        <View style={[styles.groupRule, { backgroundColor: colors.textSecondary }]} />
        <Text variant="overline" color="textSecondary">
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
