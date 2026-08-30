import { Ionicons } from '@expo/vector-icons';
import {
  formatDuration,
  fromDisplayDistance,
  fromDisplayWeight,
  isWorkingSet,
  parseDuration,
  SET_TYPE_BADGE,
  toDisplayDistance,
  toDisplayWeight,
  TRACKING_FIELDS,
  trimZeros,
  type DistanceUnit,
  type SupersetPlacement,
  type WeightUnit,
} from '@lift/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { NumericField, Text } from '@/components/ui';
import type { RoutineSet } from '@/db/schema';
import { useExerciseUnits } from '@/features/exercises/units';
import { haptics } from '@/features/feedback/haptics';
import {
  addRoutineSet,
  deleteRoutineSet,
  removeExerciseFromRoutine,
  updateRoutineExercise,
  updateRoutineSet,
  type RoutineExerciseDetail,
} from '@/features/routines/repository';
import { supersetColor } from '@/features/workouts/superset';
import { showConfirm, showDialog } from '@/store/dialog';
import { HIT_SLOP, radius, spacing, stroke, useColors } from '@/theme';

/**
 * Matches the identical control in the logging block: 34pt of row plus 8pt
 * above and below is 50pt of target. No horizontal slop. The row is full
 * width, so there is nothing either side of it to reach into or steal from.
 */
const ADD_SET_SLOP = { top: 8, bottom: 8 };

/**
 * Asymmetric on purpose, and never mirrored between horizontal neighbours.
 * Overlapping slop is not shared: the later sibling wins the hit test.
 */
const MENU_SLOP = { top: 12, bottom: 12, left: 4, right: 16 };

/**
 * How a stored distance and a stored time are spelled back into their fields.
 *
 * Both mirror the pair `set-row.tsx` keeps module-private, and they have to: a
 * target typed here and the number typed against it in the gym are the same
 * number, so a routine that rendered 2000 m differently from the logging screen
 * would be prescribing something the logger cannot agree it did.
 */
const asDistanceField = (km: number, unit: DistanceUnit) =>
  trimZeros(toDisplayDistance(km, unit).toFixed(2));

const normalizeDuration = (text: string) => {
  const seconds = parseDuration(text);
  return seconds == null ? '' : formatDuration(seconds);
};

export interface RoutineExerciseBlockProps {
  entry: RoutineExerciseDetail;
  /**
   * Where this exercise sits in the superset it belongs to, if it is in one.
   *
   * Derived by the screen rather than read off the row, because the letter is
   * positional and a row cannot see the list it is in.
   */
  superset?: SupersetPlacement;
  /**
   * Opens the superset menu. **Absent means no control is drawn**, which is
   * how a routine holding one exercise avoids offering a pairing it has
   * nothing to pair with. Same rule the reorder action applies.
   */
  onEditSuperset?: () => void;
  /** Opens the reorder sheet for the whole routine. */
  onReorder?: () => void;
  onEditNotes: () => void;
  onReload: () => Promise<void>;
}

/**
 * One prescribed exercise: name, optional note, target table.
 *
 * The logging screen's block is the visual family this belongs to. A card per
 * exercise would box a table whose job is to scan as a column of figures, so
 * the structure is the heading, a hairline under the column labels, and the
 * rows. Empty notes draw nothing: a placeholder field on every block was the
 * noise that made six exercises read as one undifferentiated stack.
 */
export function RoutineExerciseBlock({
  entry,
  superset,
  onEditSuperset,
  onReorder,
  onEditNotes,
  onReload,
}: RoutineExerciseBlockProps) {
  const colors = useColors();
  const { weightUnit, distanceUnit } = useExerciseUnits(entry.exercise);
  const fields = TRACKING_FIELDS[entry.exercise.trackingType];
  const notes = entry.routineExercise.notes;
  const tone = superset ? supersetColor(colors, superset.label) : colors.textSecondary;

  const confirmRemove = () => {
    void (async () => {
      const confirmed = await showConfirm({
        title: 'Remove exercise',
        message: `Remove ${entry.exercise.name} from this routine?`,
        confirmLabel: 'Remove',
      });
      if (!confirmed) return;
      await removeExerciseFromRoutine(entry.routineExercise.id);
      await onReload();
    })();
  };

  const openMenu = () => {
    void showDialog({
      title: entry.exercise.name,
      actions: [
        ...(onReorder ? [{ label: 'Reorder exercises', onPress: onReorder }] : []),
        {
          label: notes ? 'Edit note' : 'Add note',
          onPress: onEditNotes,
        },
        { label: 'Remove exercise', style: 'destructive' as const, onPress: confirmRemove },
        { label: 'Cancel', style: 'cancel' as const },
      ],
    });
  };

  const copyLast = () => {
    const last = entry.sets[entry.sets.length - 1];
    return {
      targetReps: last?.targetReps ?? null,
      targetWeightKg: last?.targetWeightKg ?? null,
      targetDurationSeconds: last?.targetDurationSeconds ?? null,
      targetDistanceKm: last?.targetDistanceKm ?? null,
      targetRpe: last?.targetRpe ?? null,
    };
  };

  return (
    <View style={styles.block}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.titleRow, pressed && styles.pressed]}
          onPress={() =>
            router.push({ pathname: '/exercise/[id]', params: { id: entry.exercise.id } })
          }
          accessibilityRole="link"
          accessibilityLabel={`${entry.exercise.name}. View history and records`}
        >
          <Text variant="subheading" color="text" numberOfLines={1} style={styles.title}>
            {entry.exercise.name}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>
        <Pressable
          onPress={openMenu}
          hitSlop={MENU_SLOP}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${entry.exercise.name}`}
          style={styles.menu}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {notes ? (
        <View style={styles.notesRow}>
          <Pressable
            onPress={onEditNotes}
            style={({ pressed }) => [styles.notes, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Note: ${notes}`}
            accessibilityHint="Edits this note"
          >
            <Text variant="label" color="textSecondary" numberOfLines={2}>
              {notes}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              haptics.selection();
              void updateRoutineExercise(entry.routineExercise.id, {
                isNotesPinned: !entry.routineExercise.isNotesPinned,
              }).then(onReload);
            }}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={
              entry.routineExercise.isNotesPinned ? 'Unpin notes' : 'Pin notes'
            }
          >
            <Ionicons
              name={entry.routineExercise.isNotesPinned ? 'pin' : 'pin-outline'}
              size={16}
              color={
                entry.routineExercise.isNotesPinned ? colors.accent : colors.textTertiary
              }
            />
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.columnHeader, { borderBottomColor: colors.border }]}>
        <Text variant="overline" color="textTertiary" style={styles.setCell}>
          Set
        </Text>
        {fields.weight && (
          <Text variant="overline" color="textTertiary" style={styles.targetLabel}>
            {weightUnit}
          </Text>
        )}
        {fields.duration && (
          <Text variant="overline" color="textTertiary" style={styles.targetLabel}>
            Time
          </Text>
        )}
        {fields.distance && (
          <Text variant="overline" color="textTertiary" style={styles.targetLabel}>
            {distanceUnit}
          </Text>
        )}
        {fields.reps && (
          <Text variant="overline" color="textTertiary" style={styles.targetLabel}>
            Reps
          </Text>
        )}
        <Text variant="overline" color="textTertiary" style={styles.targetLabel}>
          RPE
        </Text>
        <View style={styles.removeSpacer} />
      </View>

      {entry.sets.map((set, setIndex) => (
        <SetRow
          key={set.id}
          set={set}
          index={setIndex}
          workingIndex={countWorkingUpTo(entry.sets, setIndex)}
          fields={fields}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          onReload={onReload}
        />
      ))}

      <View style={styles.addSetRow}>
        <Pressable
          hitSlop={ADD_SET_SLOP}
          onPress={() => {
            haptics.selection();
            void addRoutineSet(entry.routineExercise.id, {
              setType: 'warmup',
              ...copyLast(),
            }).then(onReload);
          }}
          style={({ pressed }) => [
            styles.addSet,
            { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted },
          ]}
        >
          <Ionicons name="add" size={16} color={colors.warning} />
          <Text variant="label" color="textSecondary">
            Add warm-up
          </Text>
        </Pressable>

        <Pressable
          hitSlop={ADD_SET_SLOP}
          onPress={() => {
            haptics.selection();
            void addRoutineSet(entry.routineExercise.id, copyLast()).then(onReload);
          }}
          style={({ pressed }) => [
            styles.addSet,
            { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted },
          ]}
        >
          <Ionicons name="add" size={16} color={colors.textSecondary} />
          <Text variant="label" color="textSecondary">
            Add set
          </Text>
        </Pressable>
        {onEditSuperset && (
          <Pressable
            hitSlop={ADD_SET_SLOP}
            onPress={onEditSuperset}
            accessibilityRole="button"
            accessibilityLabel={
              superset
                ? `${entry.exercise.name} is in superset ${superset.label}, ${superset.index} of ${superset.size}`
                : `${entry.exercise.name} is not in a superset`
            }
            accessibilityHint="Pairs this exercise with the one above or below it"
            style={({ pressed }) => [
              styles.superset,
              {
                backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted,
              },
            ]}
          >
            <Ionicons
              name="git-merge-outline"
              size={16}
              color={superset ? tone : colors.textSecondary}
            />
            {superset && (
              <Text variant="label" style={{ color: tone }}>
                {superset.label}
              </Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

function SetRow({
  set,
  index,
  workingIndex,
  fields,
  weightUnit,
  distanceUnit,
  onReload,
}: {
  set: RoutineSet;
  index: number;
  workingIndex: number;
  fields: (typeof TRACKING_FIELDS)[keyof typeof TRACKING_FIELDS];
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  onReload: () => Promise<void>;
}) {
  const colors = useColors();
  const badge = SET_TYPE_BADGE[set.setType];
  const ordinal = index + 1;
  const badgeColor =
    set.setType === 'warmup'
      ? colors.warning
      : set.setType === 'drop'
        ? colors.accent
        : set.setType === 'failure'
          ? colors.danger
          : colors.textSecondary;

  return (
    <View style={styles.setRow}>
      <Text variant="numeric" style={[styles.setCell, { color: badgeColor }]}>
        {badge ?? workingIndex}
      </Text>
      {fields.weight && (
        <View style={styles.targetCell}>
          <NumericField
            value={
              set.targetWeightKg == null
                ? ''
                : String(
                    Math.round(toDisplayWeight(set.targetWeightKg, weightUnit) * 10) / 10,
                  )
            }
            placeholder="—"
            accessibilityLabel={`Set ${ordinal}, target weight in ${weightUnit}`}
            style={styles.field}
            onChangeText={(text) => {
              const parsed = text === '' ? null : Number(text.replace(',', '.'));
              if (parsed !== null && !Number.isFinite(parsed)) return;
              void updateRoutineSet(set.id, {
                targetWeightKg:
                  parsed === null ? null : fromDisplayWeight(parsed, weightUnit),
              }).then(onReload);
            }}
          />
        </View>
      )}
      {fields.duration && (
        <View style={styles.targetCell}>
          <NumericField
            value={
              set.targetDurationSeconds == null
                ? ''
                : formatDuration(set.targetDurationSeconds)
            }
            placeholder="—"
            normalize={normalizeDuration}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel={`Set ${ordinal}, target time`}
            style={styles.field}
            onChangeText={(text) => {
              if (text === '') {
                void updateRoutineSet(set.id, { targetDurationSeconds: null }).then(onReload);
                return;
              }
              const parsed = parseDuration(text);
              if (parsed == null) return;
              void updateRoutineSet(set.id, { targetDurationSeconds: parsed }).then(onReload);
            }}
          />
        </View>
      )}
      {fields.distance && (
        <View style={styles.targetCell}>
          <NumericField
            value={
              set.targetDistanceKm == null
                ? ''
                : asDistanceField(set.targetDistanceKm, distanceUnit)
            }
            placeholder="—"
            accessibilityLabel={`Set ${ordinal}, target distance in ${distanceUnit}`}
            style={styles.field}
            onChangeText={(text) => {
              const parsed = text === '' ? null : Number(text.replace(',', '.'));
              if (parsed !== null && !Number.isFinite(parsed)) return;
              void updateRoutineSet(set.id, {
                targetDistanceKm:
                  parsed === null ? null : fromDisplayDistance(parsed, distanceUnit),
              }).then(onReload);
            }}
          />
        </View>
      )}
      {fields.reps && (
        <View style={styles.targetCell}>
          <NumericField
            value={set.targetReps == null ? '' : String(set.targetReps)}
            placeholder="—"
            keyboardType="number-pad"
            accessibilityLabel={`Set ${ordinal}, target reps`}
            style={styles.field}
            onChangeText={(text) => {
              const parsed = text === '' ? null : Number.parseInt(text, 10);
              if (parsed !== null && !Number.isFinite(parsed)) return;
              void updateRoutineSet(set.id, { targetReps: parsed }).then(onReload);
            }}
          />
        </View>
      )}
      <View style={styles.targetCell}>
        <NumericField
          value={set.targetRpe == null ? '' : trimZeros(set.targetRpe.toFixed(1))}
          placeholder="—"
          accessibilityLabel={`Set ${ordinal}, target RPE`}
          style={styles.field}
          onChangeText={(text) => {
            const parsed = text === '' ? null : Number(text.replace(',', '.'));
            if (parsed !== null && !Number.isFinite(parsed)) return;
            if (parsed !== null && (parsed < 1 || parsed > 10)) return;
            void updateRoutineSet(set.id, { targetRpe: parsed }).then(onReload);
          }}
        />
      </View>
      <Pressable
        hitSlop={8}
        accessibilityLabel={`Delete set ${ordinal}`}
        onPress={() => void deleteRoutineSet(set.id).then(onReload)}
        style={styles.removeSpacer}
      >
        <Ionicons name="remove-circle-outline" size={20} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

/**
 * The working-set ordinal of the row at `index`. Warm-ups are skipped, so a
 * block of two warm-ups and three working sets numbers W, W, 1, 2, 3.
 */
function countWorkingUpTo(sets: readonly RoutineSet[], index: number): number {
  let count = 0;
  for (let i = 0; i <= index; i++) {
    if (isWorkingSet(sets[i]!.setType)) count += 1;
  }
  return count;
}

const styles = StyleSheet.create({
  block: { paddingVertical: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  // `minWidth: 0` is what lets a long name shrink instead of shoving the menu
  // off the row. Yoga will not shrink a flex child below its text's intrinsic
  // width unless the floor is named.
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 0 },
  title: { flexShrink: 1 },
  menu: { flexShrink: 0 },
  notesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  notes: { flex: 1 },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
    borderBottomWidth: stroke.rule,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  setCell: { width: 32, textAlign: 'center' },
  /*
   * Share leftover width. The logging row has a Previous column with `flex: 1`
   * that eats the slack; this table does not, and a fixed 62pt cell left a
   * blank strip after the delete icon on every block.
   */
  targetCell: { flex: 1, minWidth: 62 },
  targetLabel: { flex: 1, minWidth: 62, textAlign: 'center' },
  field: { width: '100%' },
  removeSpacer: { width: 32, alignItems: 'center' },
  addSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  addSet: {
    flex: 1,
    height: 34,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  // Same box as Add set, content-sized. `flex: 1` would make a third full-width
  // control and squeeze the two that actually need the room.
  superset: {
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  pressed: { opacity: 0.6 },
});
