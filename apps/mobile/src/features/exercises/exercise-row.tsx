import { Ionicons } from '@expo/vector-icons';
import { EQUIPMENT_LABELS, MUSCLE_GROUP_LABELS } from '@lift/shared';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale, Text } from '@/components/ui';
import type { ExerciseListItem } from '@/features/exercises/repository';
import { ExerciseThumbnail } from '@/features/exercises/exercise-thumbnail';
import { font, radius, spacing, translucent, useColors } from '@/theme';

export interface ExerciseRowProps {
  // Narrowed to what the row draws, so list screens can select those columns
  // alone. A full `Exercise` still satisfies it.
  exercise: ExerciseListItem;
  onPress?: (exercise: ExerciseListItem) => void;
  /** Shows a checkbox instead of a chevron, for multi-select pickers. */
  selectable?: boolean;
  selected?: boolean;
  /**
   * Where this row sits in the selection, from 1, drawn in the check's place.
   *
   * A multi-select picker adds what was chosen in the order it was tapped, so
   * picking a superset or a whole session is a sequence, and a column of
   * identical ticks hid the one thing about the selection that was going to
   * shape the workout. Numbered, the order is on screen before it is committed.
   * Omitted, a selected row shows the plain tick as before.
   */
  order?: number;
  /** Small badge on the right, e.g. how many times it's already been added. */
  badge?: string;
}

export const ExerciseRow = memo(function ExerciseRow({
  exercise,
  onPress,
  selectable = false,
  selected = false,
  order,
  badge,
}: ExerciseRowProps) {
  const colors = useColors();

  const subtitle = `${MUSCLE_GROUP_LABELS[exercise.primaryMuscle]} · ${
    EQUIPMENT_LABELS[exercise.equipment]
  }`;

  // Spelled out rather than left to the reading order of the children. The
  // middle dot in the subtitle is announced literally by both platforms, and
  // the "Custom" tag would otherwise land between the name and its muscle.
  const label = [
    exercise.name,
    MUSCLE_GROUP_LABELS[exercise.primaryMuscle],
    EQUIPMENT_LABELS[exercise.equipment],
    exercise.isCustom ? 'Custom exercise' : null,
    badge,
    selected && order ? `number ${order} in the selection` : null,
  ]
    .filter((part): part is string => part !== null && part !== undefined)
    .join(', ');

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selectable ? { selected } : undefined}
      onPress={() => onPress?.(exercise)}
      /*
       * The crossfade alone, and it is worth the hook even here.
       *
       * This row is the one the catalog is drawn from, so the instinct is to
       * keep it as cheap as a `Pressable` and leave the fill swapping
       * instantly. That reasoning does not survive the list it sits in: both
       * screens render it inside a `FlashList`, which mounts what fits on
       * screen and recycles those views down the whole 6,800 rows. The cost is
       * a dozen shared values, not six thousand, and it is paid once per
       * visible slot rather than once per exercise.
       *
       * What it buys is the case the instant swap is worst at. Picking is
       * multi-select: a tap toggles a checkbox rather than leaving the screen,
       * so the row stays under the thumb and the press state is the only thing
       * that reports on the tap itself. `translucent(..., 0)` for the resting
       * fill so the interpolation moves alpha alone and never walks a light
       * row through a dark smear on the way. No scale: full-bleed rows get the
       * crossfade alone (`motion.ts`).
       */
      scaleTo={1}
      fill={translucent(colors.surfacePressed, 0)}
      fillPressed={colors.surfacePressed}
      style={styles.row}
    >
      <ExerciseThumbnail
        name={exercise.name}
        url={exercise.thumbnailUrl}
        selected={selected}
        size={44}
      />

      <View style={styles.body}>
        <View style={styles.titleLine}>
          <Text variant="bodyMedium" numberOfLines={1} style={styles.title}>
            {exercise.name}
          </Text>
          {/* Neutral, not the accent. "Custom" is a category, and a lime pill
              on it made every hand-made exercise the loudest row in a 6,800-row
              list. */}
          {exercise.isCustom && (
            <View style={[styles.customTag, { backgroundColor: colors.surfaceMuted }]}>
              <Text variant="caption" color="textSecondary">
                Custom
              </Text>
            </View>
          )}
        </View>
        <Text variant="label" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      {badge ? (
        <View style={[styles.badge, { backgroundColor: colors.surfaceMuted }]}>
          <Text variant="caption" color="textSecondary">
            {badge}
          </Text>
        </View>
      ) : null}

      {selectable && selected && order ? (
        <View style={[styles.order, { backgroundColor: colors.accent }]}>
          <Text variant="caption" style={[styles.orderText, { color: colors.textOnAccent }]}>
            {order}
          </Text>
        </View>
      ) : selectable ? (
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={selected ? colors.accent : colors.textTertiary}
        />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      )}
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  body: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flexShrink: 1 },
  customTag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  // The 22pt the tick glyph it replaces occupies, so selecting a row moves
  // nothing beside it.
  order: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderText: { ...font('bold'), fontVariant: ['tabular-nums'] },
  badge: {
    minWidth: 24,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
});
