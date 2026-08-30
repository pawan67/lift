import { Ionicons } from '@expo/vector-icons';
import {
  formatDistance,
  formatDuration,
  formatWeight,
  fromDisplayDistance,
  fromDisplayWeight,
  parseDuration,
  toDisplayDistance,
  SET_TYPE_BADGE,
  SET_TYPE_LABELS,
  TRACKING_FIELDS,
  trimZeros,
  type DistanceUnit,
  type SetType,
  type TrackingType,
  type WeightUnit,
} from '@lift/shared';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Button, NumericField, Text } from '@/components/ui';
import type { WorkoutSet } from '@/db/schema';
import { haptics } from '@/features/feedback/haptics';
import { canLogSet } from '@/features/workouts/repository';
import { showConfirm } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { font, fontSize, radius, spacing, useColors, type Palette } from '@/theme';

export interface SetRowProps {
  set: WorkoutSet;
  /** 1-based index among working sets; warm-ups show a badge instead. */
  workingIndex: number;
  trackingType: TrackingType;
  /**
   * The units this exercise reads in, resolved by the block above (see
   * `useExerciseUnits`). Not read from settings here: the row types into the
   * column its heading names, and that heading belongs to one exercise.
   */
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  /** Whether this set broke a personal record. */
  isPr?: boolean;
  /** Same-position set from the previous session, shown as a ghost target. */
  previous?: WorkoutSet;
  onChange: (patch: Partial<WorkoutSet>) => void;
  /**
   * Resolves `false` when the write was refused or lost, so the row can take
   * its optimistic check back down. A caller with nothing to report may return
   * nothing, and the row then keeps the state the press asserted.
   */
  onToggleComplete: () => void | Promise<boolean>;
  onDelete: () => void;
  onChangeSetType: (setType: SetType) => void;
}

/** Formats the "previous" column, e.g. "100 kg × 5" or "—". */
function formatPrevious(
  previous: WorkoutSet | undefined,
  trackingType: TrackingType,
  unit: WeightUnit,
  distanceUnit: DistanceUnit,
): string {
  if (!previous) return '—';

  const fields = TRACKING_FIELDS[trackingType];
  const parts: string[] = [];

  if (fields.weight && previous.weightKg != null) {
    parts.push(formatWeight(previous.weightKg, unit));
  }
  if (fields.duration && previous.durationSeconds != null) {
    parts.push(formatDuration(previous.durationSeconds));
  }
  if (fields.distance && previous.distanceKm != null) {
    parts.push(formatDistance(previous.distanceKm, distanceUnit));
  }
  if (fields.reps && previous.reps != null) {
    parts.push(parts.length > 0 ? `× ${previous.reps}` : `${previous.reps} reps`);
  }
  // Effort last, and only where there is one. This column is read at a glance
  // between sets, so the ninety-odd percent of rows that carry no RPE have to
  // read exactly as they always have. `@8` is how the number is written
  // everywhere else in lifting, and it is what this row's own chip says two
  // columns to the right, so the two never have to be reconciled by the reader.
  //
  // It is the only reason an imported history shows an effort at all before the
  // user has logged one of their own: years of Hevy rows land in the previous
  // column long before they land under a chip.
  if (fields.reps && previous.rpe != null && parts.length > 0) {
    parts.push(`@${formatRpe(previous.rpe)}`);
  }

  return parts.length > 0 ? parts.join(' ') : '—';
}

/** `8.5` stays; `8.0` reads as `8`. The same rule the coach prompt prints by. */
function formatRpe(rpe: number): string {
  return trimZeros(rpe.toFixed(1));
}

/**
 * How a stored distance is spelled back into its field.
 *
 * Two decimals and trimmed zeros, for the same reason `formatWeight` uses them
 * on the weight field: the value now makes a unit round trip on every keystroke,
 * and that leaves float noise. A mile-entered 3 comes back as 2.999999999999,
 * while an untrimmed "3.00" would reappear in the field as characters the
 * user has to delete before typing.
 */
function asDistanceField(km: number, unit: DistanceUnit): string {
  return trimZeros(toDisplayDistance(km, unit).toFixed(2));
}

/**
 * How a typed time comes back out of storage, for the duration field's own
 * echo check. Nothing else in a set row needs one: a weight, a rep count and a
 * distance render back as they were typed. The two that convert do so through
 * a formatter that absorbs the round trip, but seconds are always re-spelled
 * as M:SS, so "4" returns as "0:04". Module scope so every row shares the one
 * function and the field is not handed a new prop on each render.
 *
 * An unparseable string maps to '' to agree with `handleDurationChange`, which
 * writes null only for the empty string.
 */
const normalizeDuration = (text: string) => {
  const seconds = parseDuration(text);
  return seconds == null ? '' : formatDuration(seconds);
};

/**
 * Motion for the check-off, which is the gesture this app exists to perform.
 *
 * Everything here is driven by shared values rather than React state, so the
 * animation runs on the UI thread and never contends with the set row's
 * controlled text inputs. The row can be mid-transition while a weight is
 * being typed and neither notices the other. `ReduceMotion.System` is passed on
 * each config rather than checked once in JS, so the OS setting is honoured
 * without a re-render to observe it.
 */
const TINT = {
  duration: 170,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
};

const SQUASH = {
  duration: 90,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
};

const RELEASE = {
  damping: 11,
  stiffness: 340,
  mass: 0.5,
  reduceMotion: ReduceMotion.System,
};

/**
 * Asymmetric on purpose, and not the shared `HIT_SLOP` token.
 *
 * Rows are 44 tall with 4pt of vertical padding, so the 30pt check plates of
 * two stacked rows sit 14pt apart: a symmetric 8pt slop overlaps by 2pt, and
 * iOS hit-tests siblings in reverse order, which hands that overlap to the
 * *lower* row. A near-miss would complete the wrong set and start its rest
 * timer. 7 tiles the gap exactly and still reaches the 44pt minimum. The left
 * edge stays inside the row's 8pt column gap because this Pressable is the last
 * child and would win any overlap against the reps field beside it. Only the
 * right edge, which faces the screen margin, is free to be generous.
 */
const CHECK_HIT_SLOP = { top: 7, bottom: 7, left: 6, right: spacing.lg };

/**
 * Mirrors CHECK_HIT_SLOP at the other end of the row.
 *
 * `alignSelf: 'stretch'` only reaches 36pt. `minHeight: 44` is border-box and
 * the row carries 4pt of vertical padding, so 4pt of slop tiles the remainder
 * exactly: 44pt of target inside a 44pt row, with no overlap for the row below
 * to steal. The left edge faces the row's 16pt margin, which holds nothing
 * pressable, so it can be generous. The right edge stays at 0, because the
 * previous-set cell is the next sibling and would win any overlap anyway.
 */
const INDEX_HIT_SLOP = { top: 4, bottom: 4, left: spacing.lg, right: 0 };

/**
 * Mirrors CHECK_HIT_SLOP for the effort chip, which is the same 30pt plate one
 * column to the left. The right edge is 0 rather than generous: it faces the
 * check plate's own 6pt of left slop across an 8pt gap, and a slop that reached
 * into it would be handed to the later sibling anyway. Which is the check
 * plate, and that is the direction a near-miss should fall.
 */
const EFFORT_HIT_SLOP = { top: 7, bottom: 7, left: spacing.xs, right: 0 };

/**
 * Deleting a set is a swipe, and a screen reader cannot swipe. The action hangs
 * off the two controls a user lands on when they reach the row.
 */
const DELETE_ACTIONS = [{ name: 'delete', label: 'Delete set' }];

/**
 * The check plate carries one more, because rating a set is a long press and a
 * screen reader cannot long-press either.
 *
 * Offered whether or not the set is checked off, where the long press is not:
 * an action chosen from a menu cannot misfire, so there is nothing to protect
 * here, and a user driving the app by rotor should not be the one who has to
 * complete the set first.
 */
const CHECK_ACTIONS = [...DELETE_ACTIONS, { name: 'effort', label: 'Rate effort' }];

// ---------------------------------------------------------------------------
// Effort
// ---------------------------------------------------------------------------

/**
 * The scale the app stores, matching `parseRpe` in the CSV importer so a value
 * that survived an import is a value this dialog can show and step.
 */
const MIN_RPE = 1;
const MAX_RPE = 10;

/**
 * Half a point, which is the finest anybody rates a set to. The scale below 6
 * is reachable by stepping down or by typing, and it is where an imported RIR
 * column lands, but it is not where the button is aimed: eight presses from the
 * seed down to RPE 6 would be a control nobody used twice.
 */
const RPE_STEP = 0.5;

/**
 * Where the dialog opens on a set that carries no effort yet.
 * What a screen reader gets instead of the two buttons, exactly as
 * `TimePickerModal` and the measurement sheet do it: one `adjustable` element,
 * because announcing "minus button, 8, plus button" makes the user hunt for the
 * step, where `adjustable` puts it on the gesture the platform already reserves.
 */
const RPE_ACTIONS: AccessibilityActionInfo[] = [
  { name: 'increment', label: 'Harder' },
  { name: 'decrement', label: 'Easier' },
];

/**
 * The scale said back in the units it is actually defined in.
 *
 * RPE is reps in reserve and then almost never taught that way, so half the
 * people who log it are guessing at what an 8 is. One line under the figure is
 * cheaper than a help screen nobody opens, and it moves as the stepper moves,
 * which is what makes it teach rather than decorate.
 */
function describeReserve(rpe: number): string {
  const reserve = MAX_RPE - rpe;
  if (reserve <= 0) return 'Nothing left in reserve';
  if (reserve === 0.5) return 'Half a rep in reserve';
  return `${trimZeros(reserve.toFixed(1))} ${reserve === 1 ? 'rep' : 'reps'} in reserve`;
}

/** What the dialog is holding. Null while it is closed, which is nearly always. */
interface EffortDraft {
  /** What Save would write. Always a number inside the scale. */
  rpe: number;
  /**
   * What the field shows, which is a different thing while somebody is typing
   * in it: an empty field is a number being replaced rather than a zero, and
   * "1" is both a valid effort and the first keystroke of "10". Carried beside
   * the value rather than derived from it, for the reason `TimeField` spells
   * out: deriving fills the field back in under the cursor.
   */
  text: string;
}

function seedEffort(rpe: number | null, defaultRpe: number): EffortDraft {
  const value = rpe ?? defaultRpe;
  return { rpe: value, text: formatRpe(value) };
}

interface EffortDialogProps {
  /** "Set 3", "Warm-up". Named in the dialog and in every label inside it. */
  setName: string;
  colors: Palette;
  draft: EffortDraft;
  /** Whether the set already carries an effort, so there is something to clear. */
  clearable: boolean;
  defaultRpe: number;
  onStep: (delta: 1 | -1) => void;
  onChangeText: (text: string) => void;
  /** The field lost the cursor: re-spell whatever is stored. */
  onSettleText: () => void;
  onCancel: () => void;
  /** Null takes the effort back off the set. */
  onSubmit: (rpe: number | null) => void;
}

/**
 * A stepper and a field, never a wheel.
 *
 * Same card, backdrop and button row as `TimePickerModal`, and the same reason
 * for the control inside it: swipe and scroll gestures do not work inside a
 * React Native `Modal` here, so a picker that cannot fail to scroll is one that
 * does not scroll. The header of `components/ui/time-picker` records that whole
 * investigation. This file does not repeat it, it obeys it.
 *
 * Called as a function and named in lower case to say so, rather than mounted
 * as `<EffortDialog />`, which is what it plainly wants to be. The React
 * Compiler's `react-hooks/immutability` rule starts reporting this file's
 * Reanimated shared values (`done.value`, `pop.value`, assigned from the
 * check-off handler exactly as Reanimated documents) as illegal mutations the
 * moment a second capitalised, JSX-returning function appears anywhere in the
 * module. One component in the file and it says nothing; two and it fails the
 * build over code neither of them touches. The choice was between silencing a
 * false positive on the most delicate function in the app and keeping this a
 * plain call, which is what `renderRightActions` above already is, so it is a
 * plain call. It holds no state and calls no hook, so there is nothing here
 * that needs a component to be correct.
 *
 * The right home is `components/ui`, beside the time picker, where it would be
 * a component again and reusable by the routine editor's target RPE. It is here
 * because this change was scoped to one file.
 */
function renderEffortDialog({
  setName,
  colors,
  draft,
  clearable,
  defaultRpe,
  onStep,
  onChangeText,
  onSettleText,
  onCancel,
  onSubmit,
}: EffortDialogProps) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      {/*
        `accessible={false}` on both Pressables, deliberately: Pressable
        defaults to accessible, which would collapse the whole dialog into one
        element and take the stepper and the buttons away from a screen reader.
        See `PromptModal` and `TimePickerModal`, which carry the same pair for
        the same reason.
      */}
      <Pressable
        accessible={false}
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onCancel}
      >
        {/* Swallows taps inside the card so they don't dismiss the dialog. */}
        <Pressable
          accessible={false}
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.surfaceElevated }]}
          onPress={(event) => event.stopPropagation()}
        >
          <Text variant="subheading" accessibilityRole="header">
            Effort
          </Text>
          <Text variant="label" color="textSecondary">
            {setName}
          </Text>

          <View style={styles.effortField}>
            <Text variant="overline" color="textTertiary">
              RPE
            </Text>

            <View
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Effort"
              accessibilityValue={{ text: `RPE ${formatRpe(draft.rpe)}` }}
              accessibilityActions={RPE_ACTIONS}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'increment') onStep(1);
                if (event.nativeEvent.actionName === 'decrement') onStep(-1);
              }}
              style={[styles.stepper, { backgroundColor: colors.surfaceMuted }]}
            >
              {renderStepperButton({
                label: 'Easier',
                glyph: '−',
                colors,
                onPress: () => onStep(-1),
              })}

              <TextInput
                value={draft.text}
                onChangeText={onChangeText}
                // Settles how a half-typed figure is written once the cursor
                // leaves. The value is already committed; this is spelling.
                onBlur={onSettleText}
                keyboardType="decimal-pad"
                selectTextOnFocus
                maxLength={4}
                placeholder={formatRpe(defaultRpe)}
                placeholderTextColor={colors.textTertiary}
                // Hidden from the screen reader: the adjustable wrapper above
                // announces the same value, and reaching the raw field would
                // announce it twice under two different roles.
                accessibilityElementsHidden
                importantForAccessibility="no"
                returnKeyType="done"
                style={[styles.stepperValue, { color: colors.text }]}
              />

              {renderStepperButton({
                label: 'Harder',
                glyph: '+',
                colors,
                onPress: () => onStep(1),
              })}
            </View>

            <Text variant="caption" color="textTertiary">
              {describeReserve(draft.rpe)}
            </Text>
          </View>

          {/* Every button names what it acts on: out of context a screen reader
              announces the visible word alone, and "Save" with no object is the
              same announcement in every dialog the app has. */}
          <View style={styles.dialogActions}>
            {clearable && (
              <Button
                title="Clear"
                accessibilityLabel={`Clear effort, ${setName}`}
                variant="ghost"
                onPress={() => onSubmit(null)}
                style={styles.dialogAction}
              />
            )}
            <Button
              title="Cancel"
              accessibilityLabel={`Cancel, ${setName} effort`}
              variant="ghost"
              onPress={onCancel}
              style={styles.dialogAction}
            />
            <Button
              title="Save"
              accessibilityLabel={`Save effort, ${setName}`}
              onPress={() => onSubmit(draft.rpe)}
              style={styles.dialogAction}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * One end of the stepper. A local copy of the button `TimePickerModal` and the
 * measurement sheet each carry, because neither exports theirs and this is the
 * third place to want one. It takes its palette as an argument for the same
 * reason the dialog above does: it is a call, not a component.
 */
function renderStepperButton({
  label,
  glyph,
  colors,
  onPress,
}: {
  label: string;
  glyph: string;
  colors: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.stepperButton,
        { backgroundColor: pressed ? colors.surfacePressed : 'transparent' },
      ]}
    >
      <Text variant="subheading" color="textSecondary">
        {glyph}
      </Text>
    </Pressable>
  );
}

export const SetRow = memo(function SetRow({
  set,
  workingIndex,
  trackingType,
  weightUnit,
  distanceUnit,
  isPr,
  previous,
  onChange,
  onToggleComplete,
  onDelete,
  onChangeSetType,
}: SetRowProps) {
  const colors = useColors();
  const defaultRpe = useSettings((state) => state.defaultRpe);

  // Null while the effort dialog is closed, which is the state twenty-five rows
  // on a busy screen are all in: no dialog is rendered until one is asked for,
  // and one piece of state answers both "is it open" and "what is in it".
  const [effort, setEffort] = useState<EffortDraft | null>(null);

  // 0 = open, 1 = checked off. Seeded from the current value so a screen opened
  // on a half-finished workout renders its state rather than animating into it.
  const done = useSharedValue(set.isCompleted ? 1 : 0);
  const pop = useSharedValue(1);
  const settled = useRef(false);

  // What the last press asserted, held until the row agrees. The check-off is
  // driven by the press rather than by the write it starts: that write is four
  // SQLite statements and a live-query re-emit away, and a plate that waits for
  // them reads as a dropped tap on the one control this app exists to press.
  // The latch is what keeps the reconcile effect below from animating a second
  // time when its own echo arrives.
  const pending = useRef<boolean | null>(null);

  useEffect(() => {
    if (pending.current !== null) {
      if (pending.current === set.isCompleted) pending.current = null;
      return;
    }

    done.value = withTiming(set.isCompleted ? 1 : 0, TINT);

    // The squash-and-release belongs to the tap, so it is skipped on the first
    // pass: otherwise every already-completed row bounces when the screen opens.
    if (!settled.current) {
      settled.current = true;
      return;
    }
    if (!set.isCompleted) return;

    pop.value = withSequence(withTiming(0.85, SQUASH), withSpring(1, RELEASE));
  }, [set.isCompleted, done, pop]);

  // A tint layer rather than an animated `backgroundColor`: interpolating out of
  // `transparent` runs through rgba(0,0,0,0) and greys the row on the way past.
  const tintStyle = useAnimatedStyle(() => ({ opacity: done.value }));
  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: done.value }));
  const idleGlyphStyle = useAnimatedStyle(() => ({ opacity: 1 - done.value }));
  const doneGlyphStyle = useAnimatedStyle(() => ({ opacity: done.value }));

  const fields = TRACKING_FIELDS[trackingType];
  const badge = SET_TYPE_BADGE[set.setType];

  // How the row names itself to a screen reader. Warm-ups are left out of the
  // working-set count on purpose, so they answer with their type rather than
  // borrowing the ordinal of the set that follows them.
  const setName =
    set.setType === 'warmup'
      ? SET_TYPE_LABELS.warmup
      : set.setType === 'normal'
        ? `Set ${workingIndex}`
        : `Set ${workingIndex}, ${SET_TYPE_LABELS[set.setType]}`;

  const badgeColor =
    set.setType === 'warmup'
      ? colors.warning
      : set.setType === 'drop'
        ? colors.accent
        : set.setType === 'failure'
          ? colors.danger
          : colors.textSecondary;

  const handleWeightChange = useCallback(
    (text: string) => {
      const parsed = text === '' ? null : Number(text.replace(',', '.'));
      if (parsed !== null && !Number.isFinite(parsed)) return;
      // Inputs are in the user's display unit; storage is always kilograms.
      onChange({ weightKg: parsed === null ? null : fromDisplayWeight(parsed, weightUnit) });
    },
    [onChange, weightUnit],
  );

  const handleRepsChange = useCallback(
    (text: string) => {
      const parsed = text === '' ? null : Number.parseInt(text, 10);
      if (parsed !== null && !Number.isFinite(parsed)) return;
      onChange({ reps: parsed });
    },
    [onChange],
  );

  const handleDurationChange = useCallback(
    (text: string) => {
      if (text === '') {
        onChange({ durationSeconds: null });
        return;
      }
      // A stray "." or a fourth colon is a keystroke on the way somewhere, not
      // an instruction to forget the time that is already logged.
      const parsed = parseDuration(text);
      if (parsed == null) return;
      onChange({ durationSeconds: parsed });
    },
    [onChange],
  );

  const handleDistanceChange = useCallback(
    (text: string) => {
      const parsed = text === '' ? null : Number(text.replace(',', '.'));
      if (parsed !== null && !Number.isFinite(parsed)) return;
      // Same rule as the weight field, and it was missing here: the field is in
      // the user's display unit and storage is always kilometres. Without the
      // conversion a user set to miles typed "3", stored 3 *kilometres*, and
      // then read it back as 1.86 mi on the records screen, which does convert.
      // The set row was the only place in the app that treated the two as the
      // same number.
      onChange({
        distanceKm: parsed === null ? null : fromDisplayDistance(parsed, distanceUnit),
      });
    },
    [onChange, distanceUnit],
  );

  const handleCopyPrevious = useCallback(() => {
    if (!previous) return;

    // Only fields this exercise tracks, and only the ones last session actually
    // holds a number for. A blanket copy writes the previous row's nulls over
    // whatever is already typed here, so tapping this cell for the reps would
    // silently erase the weight you had just entered.
    const patch: Partial<WorkoutSet> = {};
    if (fields.weight && previous.weightKg != null) patch.weightKg = previous.weightKg;
    if (fields.reps && previous.reps != null) patch.reps = previous.reps;
    if (fields.duration && previous.durationSeconds != null) {
      patch.durationSeconds = previous.durationSeconds;
    }
    if (fields.distance && previous.distanceKm != null) patch.distanceKm = previous.distanceKm;
    if (Object.keys(patch).length === 0) return;

    haptics.selection();
    onChange(patch);
  }, [previous, fields, onChange]);

  // A set with nothing in the field it is measured by has nothing to log, and
  // the screen refuses to complete it. Both sides ask the same function rather
  // than each restating the rule, so the press only asserts a state the write
  // can actually reach. The previous session counts, because the screen folds
  // those numbers into the write. Should the two ever part company again, a
  // refused write now reports it and the plate goes back down.
  const loggable = canLogSet(fields, set, previous);

  const handleToggle = useCallback(() => {
    const next = !set.isCompleted;
    const latched = !next || loggable;

    if (latched) {
      pending.current = next;
      done.value = withTiming(next ? 1 : 0, TINT);
      if (next) pop.value = withSequence(withTiming(0.85, SQUASH), withSpring(1, RELEASE));
    }

    // A write that never landed leaves the latch asserting a state the database
    // does not hold, and the row would sit green under the screen's own "not
    // saving" banner until it was unmounted. `false` is the only answer that
    // unwinds it: a caller that reports nothing keeps the old behaviour.
    void Promise.resolve(onToggleComplete()).then((ok) => {
      // Only ever unwind our own latch. A press that arrived while this write
      // was in flight owns `pending` now, and its assertion has to stand.
      if (ok !== false || !latched || pending.current !== next) return;
      pending.current = null;
      done.value = withTiming(set.isCompleted ? 1 : 0, TINT);
    });
  }, [set.isCompleted, loggable, done, pop, onToggleComplete]);

  const confirmDelete = useCallback(() => {
    void (async () => {
      if (await showConfirm({ title: 'Delete set', confirmLabel: 'Delete' })) onDelete();
    })();
  }, [onDelete]);

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'delete') confirmDelete();
    },
    [confirmDelete],
  );

  const openEffort = useCallback(() => setEffort(seedEffort(set.rpe, defaultRpe)), [set.rpe, defaultRpe]);

  const handleCheckAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'effort') openEffort();
      else handleAccessibilityAction(event);
    },
    [handleAccessibilityAction, openEffort],
  );

  /*
   * The dialog's own handlers, and none of them is a `useCallback`.
   *
   * Nothing here crosses a memo boundary: the dialog is rendered by a call
   * inside this component rather than mounted beside it, so a stable identity
   * would save exactly nothing and cost a dependency array per handler. The
   * row's handlers above are memoised because they are props on children that
   * re-render fifty times a session; these exist only while a dialog is open.
   */
  const stepEffort = (delta: 1 | -1) => {
    if (!effort) return;

    // Snapped to the half-point grid rather than added blindly, so an imported
    // 7.3 lands back on it. The field is there for anyone who wants 7.3 and
    // means it, exactly as the minute stepper leaves 07:03 reachable.
    const snapped =
      delta > 0
        ? (Math.floor(effort.rpe / RPE_STEP) + 1) * RPE_STEP
        : (Math.ceil(effort.rpe / RPE_STEP) - 1) * RPE_STEP;

    const next = Math.min(MAX_RPE, Math.max(MIN_RPE, snapped));
    if (next === effort.rpe) return;

    haptics.selection();
    setEffort({ rpe: next, text: formatRpe(next) });
  };

  const typeEffort = (raw: string) => {
    if (!effort) return;

    // A decimal pad still offers a minus sign and a second separator on some
    // keyboards, and neither is part of an effort.
    const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '').slice(0, 4);
    const parsed = Number(cleaned);

    /*
     * The two ends of the scale are not the same kind of wrong, and the
     * argument is `TimeField`'s. Too small is usually a prefix: "1" is both a
     * valid effort and the first keystroke of "10", so it is held on screen
     * uncommitted, and the blur writes back whatever is actually stored. Too
     * big is never a prefix, since no second digit rescues an 11, so it clamps
     * at once rather than sitting there as a figure the dialog has quietly
     * declined to save. An empty field and a stray second "." are the same
     * case: a keystroke on the way somewhere, not an instruction to forget the
     * number already logged.
     */
    if (cleaned === '' || !Number.isFinite(parsed) || parsed < MIN_RPE) {
      setEffort({ ...effort, text: cleaned });
      return;
    }

    const clamped = Math.min(parsed, MAX_RPE);
    setEffort({ rpe: clamped, text: clamped === parsed ? cleaned : formatRpe(clamped) });
  };

  const settleEffort = () => {
    if (effort) setEffort({ ...effort, text: formatRpe(effort.rpe) });
  };

  const submitEffort = (next: number | null) => {
    setEffort(null);
    if (next === set.rpe) return;
    haptics.selection();
    onChange({ rpe: next });
  };

  const weightValue =
    set.weightKg == null ? '' : formatWeight(set.weightKg, weightUnit, { withUnit: false });
  const distanceValue = set.distanceKm == null ? '' : asDistanceField(set.distanceKm, distanceUnit);

  return (
    <Animated.View
      // Added and swiped-away sets fade rather than pop in and out of the list.
      entering={FadeIn.duration(140).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(110).reduceMotion(ReduceMotion.System)}
    >
      <ReanimatedSwipeable
        friction={2}
        rightThreshold={40}
        renderRightActions={() => (
          <Pressable
            onPress={onDelete}
            accessibilityLabel="Delete set"
            // Hidden from the accessibility tree: this button only exists once
            // a swipe has revealed it, but it is mounted the whole time, so a
            // screen reader announced a delete for every set on the screen.
            // Without the gesture, delete arrives through the `accessibilityActions`
            // on the set number and the check plate instead.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.deleteAction, { backgroundColor: colors.danger }]}
          >
            <Ionicons name="trash" size={20} color={colors.textOnDanger} />
          </Pressable>
        )}
      >
        <View style={styles.row}>
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, tintStyle, { backgroundColor: colors.accentSurface }]}
          />

          {/* Set number / type badge */}
          <Pressable
            onPress={() => onChangeSetType(nextSetType(set.setType))}
            onLongPress={confirmDelete}
            hitSlop={INDEX_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={setName}
            accessibilityHint="Changes the set type"
            accessibilityActions={DELETE_ACTIONS}
            onAccessibilityAction={handleAccessibilityAction}
            style={styles.indexCell}
          >
            <Text variant="numeric" style={{ color: badgeColor }}>
              {badge ?? workingIndex}
            </Text>
          </Pressable>

          {/* Previous session. One brightness step and one glyph, not a chip:
              five hairline boxes per exercise would clutter the column whose
              whole job is to sit quietly beside the numbers being typed. */}
          <Pressable
            style={({ pressed }) => [
              styles.previousCell,
              // `surfacePressed`, not `accentSurface`: the accent tint already
              // means "checked off" one row width away.
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            disabled={!previous}
            onPress={handleCopyPrevious}
            accessibilityRole="button"
            accessibilityLabel={
              previous
                ? `Previous, ${formatPrevious(previous, trackingType, weightUnit, distanceUnit)}`
                : 'No previous set'
            }
            accessibilityHint={previous ? 'Copies these numbers into this set' : undefined}
          >
            <Text
              variant="label"
              color={previous ? 'textSecondary' : 'textTertiary'}
              numberOfLines={1}
              style={styles.previousText}
            >
              {formatPrevious(previous, trackingType, weightUnit, distanceUnit)}
            </Text>
            {previous && (
              <Ionicons name="return-down-forward" size={11} color={colors.textTertiary} />
            )}
          </Pressable>

          {fields.weight && (
            <NumericField
              value={weightValue}
              onChangeText={handleWeightChange}
              accessibilityLabel={`${setName}, weight in ${weightUnit}`}
              placeholder={
                previous?.weightKg != null
                  ? formatWeight(previous.weightKg, weightUnit, { withUnit: false })
                  : '0'
              }
              style={styles.input}
            />
          )}

          {fields.duration && (
            <NumericField
              value={set.durationSeconds == null ? '' : formatDuration(set.durationSeconds)}
              onChangeText={handleDurationChange}
              normalize={normalizeDuration}
              accessibilityLabel={`${setName}, time`}
              keyboardType="numbers-and-punctuation"
              placeholder={
                previous?.durationSeconds != null
                  ? formatDuration(previous.durationSeconds)
                  : '0:00'
              }
              style={styles.input}
            />
          )}

          {fields.distance && (
            <NumericField
              value={distanceValue}
              onChangeText={handleDistanceChange}
              accessibilityLabel={`${setName}, distance in ${distanceUnit}`}
              placeholder={
                previous?.distanceKm != null
                  ? asDistanceField(previous.distanceKm, distanceUnit)
                  : '0'
              }
              style={styles.input}
            />
          )}

          {fields.reps && (
            <NumericField
              value={set.reps == null ? '' : String(set.reps)}
              onChangeText={handleRepsChange}
              accessibilityLabel={`${setName}, reps`}
              keyboardType="number-pad"
              placeholder={previous?.reps != null ? String(previous.reps) : '0'}
              style={styles.input}
            />
          )}

          {/*
            The effort chip, and it is here only when the set carries one.

            RPE is not a column. Most people never log it, and a permanent cell
            would spend 38 of a 360dp row's points on a figure that is null on
            nine rows in ten, squeezing the previous column past the width where
            "100 kg × 5" still fits. So there is nothing to see until there is
            something to say, which also makes an imported Hevy history visible
            the first time it is opened rather than only through the previous
            column beside it.

            Gated on `fields.reps` with the entry below it: RPE *is* a rep
            count, it is defined by the reps left in reserve, and a 5 km run has
            none. That the two tracking types carrying three numeric fields are
            exactly the ones where a fourth cell would overflow a narrow row is
            a happy consequence rather than the reason.
          */}
          {fields.reps && (
            <Pressable
              onPress={openEffort}
              hitSlop={EFFORT_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={set.rpe != null ? `${setName}, RPE ${formatRpe(set.rpe)}` : `${setName}, Add RIR`}
              accessibilityHint="Changes the effort"
              style={({ pressed }) => [
                styles.effortCell,
                // `surfaceMuted`, the fill the numeric fields carry: this reads
                // as one more thing logged about the set rather than as a
                // status, which is what an accent tint would claim.
                { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted },
              ]}
            >
              <Text variant="caption" color="textSecondary" style={styles.effortText}>
                {set.rpe != null ? `@${formatRpe(set.rpe)}` : 'RIR'}
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={handleToggle}
            // Rating a set is a long press on the plate that says the set is
            // done, which is the moment the effort is actually known, and it is
            // the gesture this row already spends on secondary actions: the set
            // number deletes the same way.
            //
            // Wired only once the set is checked off, and that is not a nicety.
            // A Pressable carrying an `onLongPress` swallows a press held past
            // half a second, and the check-off is the one gesture this app
            // exists to perform: a slow thumb on an unchecked plate has to log
            // the set, not open a dialog. Completed, the press it could swallow
            // is an un-check, which is a rare deliberate correction and a
            // Cancel away. You cannot rate a set you have not done, so the rule
            // reads the same from the outside as it does from in here.
            onLongPress={fields.reps && set.isCompleted ? openEffort : undefined}
            hitSlop={CHECK_HIT_SLOP}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: set.isCompleted }}
            accessibilityLabel={`Complete ${setName}`}
            accessibilityActions={fields.reps ? CHECK_ACTIONS : DELETE_ACTIONS}
            onAccessibilityAction={handleCheckAccessibilityAction}
          >
            <Animated.View
              style={[styles.checkCell, { backgroundColor: colors.surfaceMuted }, checkStyle]}
            >
              <Animated.View
                style={[StyleSheet.absoluteFill, fillStyle, { backgroundColor: isPr ? colors.record : colors.success }]}
              />
              <Animated.View style={[styles.glyph, idleGlyphStyle]}>
                <Ionicons name="checkmark" size={18} color={colors.textTertiary} />
              </Animated.View>
              <Animated.View style={[styles.glyph, doneGlyphStyle]}>
                {isPr ? (
                  <Ionicons name="trophy" size={16} color={colors.surface} />
                ) : (
                  <Ionicons name="checkmark" size={18} color={colors.textOnSuccess} />
                )}
              </Animated.View>
            </Animated.View>
          </Pressable>
        </View>
      </ReanimatedSwipeable>

      {effort &&
        renderEffortDialog({
          setName,
          colors,
          draft: effort,
          clearable: set.rpe != null,
          defaultRpe,
          onStep: stepEffort,
          onChangeText: typeEffort,
          onSettleText: settleEffort,
          onCancel: () => setEffort(null),
          onSubmit: submitEffort,
        })}
    </Animated.View>
  );
});

/** Cycles set type on tap: normal → warm-up → drop → failure → normal. */
function nextSetType(current: SetType): SetType {
  const order: SetType[] = ['normal', 'warmup', 'drop', 'failure'];
  const index = order.indexOf(current);
  return order[(index + 1) % order.length]!;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    minHeight: 44,
  },
  // Stretched to the row's content box so the tap target is the height of the
  // row rather than of the one glyph inside it. Visually identical: the row
  // centres its children anyway.
  indexCell: {
    width: 32,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Stretched rather than centred so the pressed fill covers the whole cell,
  // and with no padding of its own so the text stays under its column heading.
  previousCell: {
    flex: 1,
    minWidth: 60,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 3,
    borderRadius: radius.sm,
  },
  // Shrinks before the copy glyph does, so a long previous set truncates rather
  // than pushing the affordance out of the cell.
  previousText: { flexShrink: 1 },
  // 62pt to match `unitCell` in the block heading. `flex: 0` alone lets a
  // wide value grow the field and walk kg/reps out from under their labels.
  input: { flex: 0, width: 62 },
  // The same 30pt plate as the check cell beside it, so the two read as one
  // pair rather than as a chip that wandered in. `minWidth` rather than a fixed
  // width: "@10" is a character wider than "@8" and the cell may have it.
  effortCell: {
    minWidth: 36,
    height: 30,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Tabular figures for the same reason every other number in a set row has
  // them: @8 and @10 sit in a column down the block and must not jitter.
  effortText: { fontVariant: ['tabular-nums'] },
  checkCell: {
    width: 38,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    // Keeps the success fill inside the rounded plate.
    overflow: 'hidden',
  },
  glyph: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteAction: {
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  effortField: { gap: spacing.xs },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.xs,
  },
  // Past the touch minimum in both axes on its own frame, exactly as the time
  // picker's and the measurement sheet's are. The buttons sit close enough to
  // the field between them that slop is not available to either: it would
  // overlap, and the later sibling silently wins the hit test.
  stepperButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.xxl,
    ...font('bold'),
    fontVariant: ['tabular-nums'],
    // Android reserves extra room above the ascender and below the descender
    // from the font's own metrics, which at this size pushes the digits off the
    // centre line the buttons beside them sit on. Harmless on iOS.
    paddingVertical: 0,
    includeFontPadding: false,
  },
  dialogActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  dialogAction: { flex: 1 },
});
