import { Ionicons } from '@expo/vector-icons';
import {
  buildWarmupRamp,
  calculatePlates,
  defaultPlates,
  DISTANCE_UNITS,
  formatDuration,
  formatWeight,
  isWorkingSet,
  nearestLoadable,
  POSITION_STEP,
  TRACKING_FIELDS,
  WEIGHT_UNITS,
  type DistanceUnit,
  type SetType,
  type Suggestion,
  type SupersetPlacement,
  type WarmupSet,
  type WeightUnit,
} from '@lift/shared';
import { useMemo, type ComponentProps, Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import type { WorkoutSet } from '@/db/schema';
import { useExerciseUnits } from '@/features/exercises/units';
import { haptics } from '@/features/feedback/haptics';
import { showConfirm, showDialog } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { radius, spacing, stroke, useColors } from '@/theme';

import { ExerciseThumbnail } from '@/features/exercises/exercise-thumbnail';

import { pairWithPrevious } from './previous';
import { SetRow } from './set-row';
import { SupersetChip } from './superset';
import {
  addSet,
  hasRestOverride,
  resolveRestSeconds,
  type WorkoutExerciseDetail,
} from './repository';
import { suggestForExercise, type ProgressionInput } from './suggestion';

export interface ExerciseBlockProps {
  detail: WorkoutExerciseDetail;
  previousSets: WorkoutSet[];
  /**
   * The most recent note written against this exercise in an earlier session.
   * Shown only when this block has no note of its own.
   */
  previousNote?: string | null;
  /**
   * What the progression engine gets to read: this exercise's recent sessions,
   * plus the routine's prescription if the session came from one.
   *
   * Optional, and that is the whole opt-in. A session being planned is offered
   * a target; a session being *corrected* (the editor, months later) is not,
   * because it is a record of what happened rather than a plan, and there is
   * nothing left to progress into. That screen passes nothing and no line
   * renders. See `suggestion.ts`.
   */
  /** Sets that took a personal record, marked with a trophy. */
  recordSetIds?: ReadonlySet<string>;
  /**
   * Where this exercise sits in the superset it belongs to, if it is in one.
   *
   * Derived by the screen rather than read off `workoutExercise.supersetGroup`,
   * because the letter is positional and a row cannot see the list it is in:
   * see `runLabel` in `@lift/shared`.
   */
  superset?: SupersetPlacement;
  /**
   * Opens the superset menu. **Absent means no control is drawn**, which is
   * how a session holding one exercise avoids offering a pairing it has
   * nothing to pair with. Same rule the routine editor applies to its reorder
   * action, for the same reason.
   */
  onEditSuperset?: () => void;
  /** Opens the demonstration still/clip without leaving the session. */
  onOpenDemo?: () => void;
  progression?: ProgressionInput;
  onAddSet: (type?: SetType) => void;
  onUpdateSet: (setId: string, patch: Partial<WorkoutSet>) => void;
  onToggleSet: (set: WorkoutSet) => void;
  onDeleteSet: (setId: string) => void;
  onChangeSetType: (setId: string, setType: SetType) => void;
  onRemoveExercise: () => void;
  /** Swaps this slot for another exercise. The bench is taken, the pin is missing. */
  onReplaceExercise: () => void;
  /**
   * Opens the reorder sheet for the whole session.
   *
   * A list-level action reached from a per-exercise menu, deliberately: the
   * moment you want it is the moment you are looking at the block that is in
   * the wrong place, and that block's menu is already under your thumb.
   */
  onReorder: () => void;
  /** `seed` prefills the editor; recalling last session's note must not overwrite it in place. */
  onEditNotes: (seed?: string) => void;
  onEditRest: () => void;
  /**
   * Changes the units this exercise is read in: see `setExerciseUnits`. It
   * goes out through the screen rather than being written from here, so the
   * write joins every other one on the logging screen in the guard that
   * notices when the disk stops accepting them.
   */
  onChangeUnits: (units: { weightUnit?: WeightUnit; distanceUnit?: DistanceUnit }) => void;
  /** Opens the exercise's own page: history, records and charts. */
  onOpenExercise: () => void;
}

/**
 * Asymmetric on purpose, and never mirrored between horizontal neighbours.
 * Overlapping slop is not shared: the later sibling wins the hit test, so two
 * controls that both reach 8pt toward each other turn the band between them
 * into a silent thief. Each chip reaches back into the gap it owns; the menu
 * takes the whole right margin, where nothing else is.
 */
const REST_SLOP = { top: 8, bottom: 8, left: 6, right: 4 };
const NOTE_SLOP = { top: 8, bottom: 8, left: 6, right: 4 };
const MENU_SLOP = { top: 8, bottom: 8, left: 4, right: 16 };
const THUMB_SLOP = { top: 8, bottom: 8, left: 8, right: 4 };
const THUMBNAIL_SIZE = 40;
/** The unit headings are 11px type in a 62pt cell; the target is the slop. */
const UNIT_SLOP = { top: 10, bottom: 10, left: 4, right: 4 };
const ADD_SET_SLOP = { top: 8, bottom: 8 };

export function ExerciseBlock({
  detail,
  previousSets,
  previousNote,
  recordSetIds,
  superset,
  onEditSuperset,
  onOpenDemo,
  progression,
  onAddSet,
  onUpdateSet,
  onToggleSet,
  onDeleteSet,
  onChangeSetType,
  onRemoveExercise,
  onReplaceExercise,
  onReorder,
  onEditNotes,
  onEditRest,
  onChangeUnits,
  onOpenExercise,
}: ExerciseBlockProps) {
  const colors = useColors();
  // This exercise's units, which are the app's until the user says otherwise.
  const { weightUnit, distanceUnit } = useExerciseUnits(detail.exercise);
  const barWeightKg = useSettings((state) => state.barWeightKg);
  const defaultRestSeconds = useSettings((state) => state.defaultRestSeconds);
  const restTimerEnabled = useSettings((state) => state.restTimerEnabled);

  const restSeconds = resolveRestSeconds(detail, defaultRestSeconds);
  // A rest the user chose is stated in the accent; one that is merely the app
  // default stays quiet, so the header reads as "set" versus "inherited".
  const restIsExplicit = hasRestOverride(detail);
  const chipVisible = onEditSuperset != null;
  const hasSessionNote = Boolean(detail.workoutExercise.notes);

  const fields = TRACKING_FIELDS[detail.exercise.trackingType];

  // Every set checked off. This used to raise a card over the whole screen; now
  // the block says it itself, in the header, and the user carries on.
  const allComplete =
    detail.sets.length > 0 && detail.sets.every((set) => set.isCompleted);

  const rows = pairWithPrevious(detail.sets, previousSets);

  /*
   * What to lift next, from the sessions behind this one.
   *
   * `suggestForExercise` resolves the load step, the rep range and the tracking
   * type, calls the engine, and swallows anything the engine throws, so this
   * is a suggestion or it is nothing, and the logging screen cannot be taken
   * down by an opinion about a set. The guard and its reasoning live there,
   * next to the call it protects.
   */
  const suggestion = useMemo(
    () => (progression ? suggestForExercise(detail, progression) : null),
    [detail, progression],
  );

  /*
   * The sets the suggestion would fill, and the reason the line is tappable
   * rather than decorative.
   *
   * Open working sets only, and only the ordinals the engine spoke about: a set
   * already checked off is a record and is never rewritten, and a fifth set the
   * engine said nothing about has no target. Inventing one is the mistake
   * `pairWithPrevious` refuses to make one column over.
   *
   * In render rather than memoised, because it also decides whether the line
   * appears at all: a block with every set logged has nothing left to fill, and
   * a control that does nothing when pressed is worse than no control.
   */
  const suggestedPatches: { setId: string; patch: Partial<WorkoutSet> }[] = [];

  if (suggestion) {
    const byWorkingIndex = new Map(suggestion.sets.map((entry) => [entry.workingIndex, entry]));

    for (const row of rows) {
      if (row.set.isCompleted || !isWorkingSet(row.set.setType)) continue;

      const entry = byWorkingIndex.get(row.workingIndex);
      if (!entry) continue;

      // Only the fields this exercise tracks, and only the ones the engine put
      // a number in: the same rule `handleCopyPrevious` follows, for the same
      // reason: a blanket patch writes nulls over what is already typed.
      const patch: Partial<WorkoutSet> = {};
      if (fields.weight && entry.weightKg != null) patch.weightKg = entry.weightKg;
      if (fields.reps && entry.reps != null) patch.reps = entry.reps;
      if (Object.keys(patch).length === 0) continue;

      suggestedPatches.push({ setId: row.set.id, patch });
    }
  }

  const suggestionLine =
    suggestion && suggestedPatches.length > 0
      ? describeSuggestion(suggestion, fields, weightUnit)
      : null;

  /**
   * The only way a suggested number reaches a set: an explicit press.
   *
   * Nothing is pre-filled and no placeholder changes. The Previous column and
   * the field placeholders still say what was lifted last time, and a bare
   * check-off still commits exactly that: see `ghostFill`. A heavier weight
   * sitting in a placeholder would be committed by that same tap, and the log
   * would then hold a lift nobody performed.
   */
  const applySuggestion = () => {
    haptics.selection();
    for (const { setId, patch } of suggestedPatches) onUpdateSet(setId, patch);
  };

  // What to load for the set the user is walking to the rack to do. Barbells
  // only: a dumbbell has no per-side arithmetic, and the Smith machine is left
  // out on purpose because its counterbalance runs anywhere from 0 to 20 kg
  // between machines, so a confident number at the rack would be wrong more
  // often than right. The app has had this engine since launch, three
  // navigations and a retyped weight away under the Profile tab.
  const plateLine = useMemo(() => {
    if (detail.exercise.equipment !== 'barbell') return null;

    const next = detail.sets.find((set) => !set.isCompleted);
    if (next?.weightKg == null || next.weightKg <= 0) return null;

    return describePlates(next.weightKg, barWeightKg, weightUnit);
  }, [detail.exercise.equipment, detail.sets, barWeightKg, weightUnit]);

  /*
   * The ramp up to that weight, and the reason there is one tap here instead of
   * four rows of typing.
   *
   * Offered only while the block is untouched: nothing logged and no warm-up in
   * it already. A block holding warm-ups has a ramp, and a block with a set
   * checked off has started, so pushing three rows in above a set the user has
   * already performed would reorder the session under their thumb for no gain.
   * That also makes the control self-retiring, which is why it needs no dismiss
   * affordance and no stored preference: it disappears the moment it is used
   * or the moment the session moves past it.
   *
   * `buildWarmupRamp` says no far more often than it says yes: five of the
   * eight tracking types have no ramp to build, both bodyweight variants are
   * refused on purpose, and equipment without a load step gets nothing. None of
   * that is decided here. An empty ramp draws no line, and the reasoning for
   * each refusal lives in one place, next to the arithmetic it guards.
   *
   * The style is fixed at `standard` because there is nowhere honest to keep a
   * choice yet: a per-user preference belongs in the settings blob, and until
   * it is there, a picker on this line would ask the same question before every
   * exercise of every session.
   */
  const warmup = useMemo(() => {
    if (detail.sets.some((set) => set.isCompleted || !isWorkingSet(set.setType))) return null;

    const working = detail.sets.find((set) => set.weightKg != null && set.weightKg > 0);
    if (working?.weightKg == null) return null;

    return buildWarmupRamp({
      workingKg: working.weightKg,
      workingReps: working.reps,
      barKg: barWeightKg,
      inventory: defaultPlates(weightUnit),
      trackingType: detail.exercise.trackingType,
      equipment: detail.exercise.equipment,
    });
  }, [
    detail.exercise.equipment,
    detail.exercise.trackingType,
    detail.sets,
    barWeightKg,
    weightUnit,
  ]);

  /**
   * Writes the ramp as `warmup` rows, above the sets already in the block.
   *
   * Fractional positions, which is exactly what the REAL column is for: the
   * warm-ups have to render *before* the working sets and `addSet` with no
   * position appends to the end. Renumbering the working sets down instead
   * would be an oplog entry and a row on the wire per set, to say something
   * about sets that did not change, which is the cost `ordering.ts` was written
   * to avoid. So the gap below the first set is divided and nothing already on
   * disk is touched.
   *
   * `setType: 'warmup'` is the whole reason this is safe to write in bulk:
   * `isWorkingSet` keeps these rows out of volume, PR detection and every 1RM
   * estimate, so a ramp cannot flatter a chart or invent a record.
   *
   * This is the one write in this file that does not leave through a callback,
   * and the exception is deliberate rather than tidy. Both screens that render
   * this block funnel their writes through `useWriteGuard`, and reaching that
   * from here would mean a new prop on a component neither screen can be edited
   * to pass right now. The cost is that a failure does not join their count of
   * lost writes, so it is reported here instead, as a dialog, rather than
   * failing silently: a warm-up that never reached the disk is a set the user
   * will do and not have.
   */
  const addWarmup = () => {
    if (!warmup?.sets.length) return;
    haptics.added();

    const rungs = warmup.sets;
    const first = detail.sets[0]?.position ?? POSITION_STEP;
    const gap = POSITION_STEP / (rungs.length + 1);

    void (async () => {
      try {
        // Sequential rather than `Promise.all`, so a disk that has already
        // refused one row is not handed two more. Every position is computed
        // before the loop starts, so no step here reads what the last wrote,
        // which is the usual reason to await in a loop and not the reason here.
        for (const [index, rung] of rungs.entries()) {
          await addSet(detail.workoutExercise.id, {
            position: first - (rungs.length - index) * gap,
            setType: 'warmup',
            weightKg: rung.weightKg,
            reps: rung.reps,
          });
        }
      } catch {
        haptics.rejected();
        void showDialog({
          title: 'Warm-up not added',
          message:
            'The device would not accept the write. ' +
            'Any rows that did arrive can be deleted from the list below.',
        });
      }
    })();
  };

  const confirmRemove = () => {
    void (async () => {
      const confirmed = await showConfirm({
        title: 'Remove exercise',
        message: `Remove ${detail.exercise.name} from this workout?`,
        confirmLabel: 'Remove',
      });
      if (confirmed) onRemoveExercise();
    })();
  };

  // Replace joined the menu when substitution stopped meaning "delete and
  // re-add". Rest, pairing and notes have their own chips on the row below
  // the name, so they stay out of this list. The in-app dialog stacks however
  // many actions it is handed and floats Cancel to the bottom itself.
  const openMenu = () => {
    void showDialog({
      title: detail.exercise.name,
      actions: [
        { label: 'Reorder exercises', onPress: onReorder },
        { label: 'Replace exercise', onPress: onReplaceExercise },
        {
          label: hasSessionNote ? 'Edit note' : 'Add note',
          onPress: () => onEditNotes(),
        },
        { label: 'Remove exercise', style: 'destructive', onPress: confirmRemove },
        { label: 'Cancel', style: 'cancel' },
      ],
    });
  };

  const openNote = () => {
    if (hasSessionNote) onEditNotes();
    else if (previousNote) onEditNotes(previousNote);
    else onEditNotes();
  };

  const noteChipColor = hasSessionNote ? colors.textSecondary : colors.textTertiary;

  return (
    <View style={styles.block}>
      <View style={styles.header}>
        <View style={styles.titleBar}>
          {onOpenDemo ? (
            <Pressable
              onPress={onOpenDemo}
              hitSlop={THUMB_SLOP}
              accessibilityRole="button"
              accessibilityLabel={`Show ${detail.exercise.name} demonstration`}
            >
              <ExerciseThumbnail
                name={detail.exercise.name}
                url={detail.exercise.thumbnailUrl}
                size={THUMBNAIL_SIZE}
                style={styles.thumbnail}
              />
            </Pressable>
          ) : (
            <ExerciseThumbnail
              name={detail.exercise.name}
              url={detail.exercise.thumbnailUrl}
              size={THUMBNAIL_SIZE}
              style={styles.thumbnail}
            />
          )}
          <Pressable
            style={({ pressed }) => [styles.titlePress, pressed && styles.pressed]}
            onPress={onOpenExercise}
            accessibilityRole="link"
            // The badge is decorative; the state it reports has to reach a screen
            // reader through the label of the control it sits in.
            accessibilityLabel={
              `${detail.exercise.name}.` +
              `${allComplete ? ' Complete.' : ''} View history and records`
            }
          >
            {/* Subheading, and no accent. This is the only heading on the screen
                that names what you are doing, and at body size it was lighter
                than the numbers inside its own set rows, which is why six
                exercises scrolled as one undifferentiated column. The accent is
                budgeted at roughly one element per view (`theme/tokens.ts`) and
                this screen was spending it once per exercise. */}
            <Text variant="subheading" color="text" numberOfLines={1} style={styles.title}>
              {detail.exercise.name}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />

            {/* The slot is always laid out, so the badge arriving mid-session
                doesn't shove the rest of the header sideways under the user's
                thumb. It sits with the name because that is what it is about. */}
            <View style={styles.doneSlot}>
              {allComplete && (
                <Animated.View
                  entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
                  exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)}
                >
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                </Animated.View>
              )}
            </View>
          </Pressable>
          <Pressable
            onPress={openMenu}
            hitSlop={MENU_SLOP}
            accessibilityRole="button"
            accessibilityLabel={`More options for ${detail.exercise.name}`}
          >
            <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.chipRow}>
          {restTimerEnabled && (
            <Pressable
              onPress={onEditRest}
              hitSlop={REST_SLOP}
              accessibilityRole="button"
              accessibilityLabel={`Rest after ${detail.exercise.name}, ${formatDuration(restSeconds)}. Edit`}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted,
                },
              ]}
            >
              <Ionicons
                name="timer-outline"
                size={12}
                color={restIsExplicit ? colors.accent : colors.textTertiary}
              />
              <Text
                variant="caption"
                style={{ color: restIsExplicit ? colors.accent : colors.textTertiary }}
              >
                {formatDuration(restSeconds)}
              </Text>
            </Pressable>
          )}

          {chipVisible && onEditSuperset && (
            <SupersetChip
              placement={superset}
              exerciseName={detail.exercise.name}
              onPress={onEditSuperset}
            />
          )}

          <Pressable
            onPress={openNote}
            hitSlop={NOTE_SLOP}
            accessibilityRole="button"
            accessibilityLabel={
              hasSessionNote
                ? `Note: ${detail.workoutExercise.notes}. Edit`
                : previousNote
                  ? `Note from last time: ${previousNote}. Edit`
                  : `Add a note for ${detail.exercise.name}`
            }
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted,
              },
            ]}
          >
            <Ionicons name="document-text-outline" size={12} color={noteChipColor} />
            <Text variant="caption" style={{ color: noteChipColor }}>
              Note
            </Text>
          </Pressable>
        </View>
      </View>

      {hasSessionNote ? (
        <CueCard
          icon="document-text-outline"
          kicker="Note"
          text={detail.workoutExercise.notes!}
          tone="secondary"
          onPress={() => onEditNotes()}
          accessibilityLabel={`Note: ${detail.workoutExercise.notes}`}
          accessibilityHint="Edits this note"
        />
      ) : previousNote ? (
        /* A cue is sticky ("pin 4, not 5" stays true until it doesn't) so the
           standing instruction is put back in front of the user instead of
           being retyped from memory. Dimmer than a note written today, and it
           stays a quotation until the user accepts it: tapping seeds the editor
           rather than writing it onto this session behind their back. Upright,
           not italic; only upright cuts are loaded, so an italic
           style would synthesise or fall back. */
        <CueCard
          icon="time-outline"
          kicker="Last time"
          text={previousNote}
          tone="tertiary"
          onPress={() => onEditNotes(previousNote)}
          accessibilityLabel={`Note from last time: ${previousNote}`}
          accessibilityHint="Opens the note editor with this text"
        />
      ) : null}

      {/* What to lift, and why: under the notes and above the table, which is
          the order the block is read in: what this exercise is, what you told
          yourself about it, what to aim for, then the numbers.

          Same muted card as a recalled note, not accented: the accent is
          budgeted at roughly one element per view (`theme/tokens.ts`) and this
          screen already spends it on the progress rule and the rest countdown.
          A suggestion is the app having an opinion, and an opinion should be
          offered at the volume of a note. */}
      {suggestionLine && (
        <CueCard
          icon="sparkles-outline"
          kicker="Target"
          text={suggestionLine.text}
          detail={suggestionLine.detail}
          compact
          tone="tertiary"
          onPress={applySuggestion}
          accessibilityLabel={suggestionLine.label}
          accessibilityHint="Fills these numbers into the sets you have not logged yet"
        />
      )}

      {warmup && warmup.sets.length > 0 && (
        <WarmupCard sets={warmup.sets} unit={weightUnit} onPress={addWarmup} />
      )}

      {/* Column headings. `overline` uppercases and adds tracking, so these are
          written in sentence case: the same rule every other heading follows.

          The two that name a unit are also the control for it: see `UnitHeader`.
          Time and Reps are not units the user has an opinion about, so they stay
          plain text and the rule reads as "if the heading is a unit, it is a
          button". */}
      <View style={[styles.columnHeader, { borderBottomColor: colors.border }]}>
        <Text variant="overline" color="textTertiary" style={styles.indexCell}>
          Set
        </Text>
        <Text variant="overline" color="textTertiary" style={styles.previousCell}>
          Previous
        </Text>
        {fields.weight && (
          <UnitHeader
            name="Weight"
            value={weightUnit}
            options={WEIGHT_UNITS}
            onChange={(next) => onChangeUnits({ weightUnit: next })}
          />
        )}
        {fields.duration && (
          <Text variant="overline" color="textTertiary" style={styles.unitCell}>
            Time
          </Text>
        )}
        {fields.distance && (
          <UnitHeader
            name="Distance"
            value={distanceUnit}
            options={DISTANCE_UNITS}
            onChange={(next) => onChangeUnits({ distanceUnit: next })}
          />
        )}
        {fields.reps && (
          <Text variant="overline" color="textTertiary" style={styles.unitCell}>
            Reps
          </Text>
        )}
        {/* Same width as the RIR chip in `SetRow`. Effort is not a heading —
            most rows never log one — but the chip still occupies a column, and
            without this spacer kg/reps sit to the left of the labels above them. */}
        {fields.reps && <View style={styles.effortSpacer} accessibilityElementsHidden />}
        <View style={styles.checkSpacer} />
      </View>

      {plateLine && (
        <Text
          variant="numeric"
          color="textTertiary"
          style={styles.plateLine}
          accessibilityLabel={plateLine.label}
        >
          {plateLine.text}
        </Text>
      )}

      {rows.map(({ set, workingIndex, previous }) => (
        <SetRow
          key={set.id}
          set={set}
          workingIndex={workingIndex}
          isPr={recordSetIds?.has(set.id)}
          trackingType={detail.exercise.trackingType}
          // Handed down rather than read from settings inside the row: the row
          // has to agree with the heading directly above it, and the heading is
          // this exercise's, not the app's.
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          previous={previous}
          onChange={(patch) => onUpdateSet(set.id, patch)}
          onToggleComplete={() => onToggleSet(set)}
          onDelete={() => onDeleteSet(set.id)}
          onChangeSetType={(setType) => onChangeSetType(set.id, setType)}
        />
      ))}

      <View style={styles.addSetRow}>
        <Pressable
          onPress={() => onAddSet('warmup')}
          hitSlop={ADD_SET_SLOP}
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
          onPress={() => onAddSet('normal')}
          hitSlop={ADD_SET_SLOP}
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
      </View>
    </View>
  );
}

/** A muted callout under the chips: a session note, last time's cue, or a suggestion. */
function CueCard({
  icon,
  kicker,
  text,
  detail,
  compact = false,
  tone,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  kicker: string;
  text: string;
  detail?: string;
  /** One row: icon, the numbers, then the reason truncated. The suggestion. */
  compact?: boolean;
  tone: 'secondary' | 'tertiary';
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint: string;
}) {
  const colors = useColors();
  const ink = tone === 'secondary' ? colors.textSecondary : colors.textTertiary;
  const inkToken = tone === 'secondary' ? 'textSecondary' : 'textTertiary';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        compact ? styles.cueChip : styles.cueNote,
        { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted },
      ]}
    >
      <Ionicons name={icon} size={14} color={ink} />
      {compact ? (
        <>
          <Text variant="caption" color={inkToken} numberOfLines={1}>
            {kicker}
          </Text>
          <Text variant="label" color={inkToken} numberOfLines={1}>
            {text}
          </Text>
          {detail ? (
            <Text variant="caption" color="textTertiary" numberOfLines={1} style={styles.cueChipDetail}>
              {detail}
            </Text>
          ) : null}
        </>
      ) : (
        <View style={styles.cueCopy}>
          <Text variant="overline" color={inkToken}>
            {kicker}
          </Text>
          <Text variant="label" color={inkToken} numberOfLines={3}>
            {text}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * The ramp as equal chips across one row.
 *
 * `flex: 1` on each rung fills the card; the gaps stay `xs`. Space-between
 * would park three numbers on a large phone with a desert between them.
 */
function WarmupCard({
  sets,
  unit,
  onPress,
}: {
  sets: readonly WarmupSet[];
  unit: WeightUnit;
  onPress: () => void;
}) {
  const colors = useColors();
  const described = describeWarmup(sets, unit);
  const show = (kg: number) => formatWeight(kg, unit, { withUnit: false });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={described.label}
      accessibilityHint="Adds these as warm-up sets above the sets below"
      style={({ pressed }) => [
        styles.cue,
        { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceMuted },
      ]}
    >
      <View style={styles.cueHead}>
        <Ionicons name="flame-outline" size={14} color={colors.warning} />
        <Text variant="overline" color="textSecondary" style={styles.cueHeadLabel}>
          Warm-up
        </Text>
        <Text variant="caption" color="textTertiary">
          Tap to add
        </Text>
        <Ionicons name="add" size={16} color={colors.textTertiary} />
      </View>
      <View style={styles.warmupRungs}>
        {sets.map((set, index) => (
          <Fragment key={`${set.weightKg}-${set.reps}-${index}`}>
            {index > 0 && (
              <Ionicons name="chevron-forward" size={12} color={colors.textTertiary} />
            )}
            <View style={[styles.warmupRung, { backgroundColor: colors.surface }]}>
              <Text variant="numeric" color="textSecondary" align="center" numberOfLines={1}>
                {show(set.weightKg)} × {set.reps}
              </Text>
            </View>
          </Fragment>
        ))}
      </View>
    </Pressable>
  );
}

/**
 * A column heading that is also the switch for the unit it names.
 *
 * Changing units used to mean leaving the session for Settings, which is four
 * taps and a scroll at the moment you have a dumbbell in one hand and the rack
 * says 55 and your app says kilograms. The heading was already printing the
 * answer (`kg`, `km`) so it becomes the control rather than gaining one: no
 * new row, no sheet, and the affordance is discoverable because the current
 * state is what you tap.
 *
 * A tap cycles rather than opening a picker. Both dimensions have exactly two
 * options, so a picker would be a modal to choose between the thing you can see
 * and the only alternative. That also makes a mis-tap free: every number on
 * screen converts instantly, nothing is written to the sets themselves, and
 * tapping again puts it back.
 *
 * It changes **this exercise's** unit and nothing else's. It used to write the
 * app-wide preference, on the argument that a unit is only a lens over numbers
 * stored in kilograms either way (`packages/shared/src/units.ts`), and that a
 * per-exercise lens would leave "which unit was this row under?" unanswerable.
 * The second half was the real objection and it is gone: the exercise row
 * carries the answer now (`exercises.weight_unit`), so every set under this
 * heading is read in the unit the heading names.
 *
 * The first half was never the user's problem. Switching the dumbbell press to
 * pounds re-labelled the squat, the leg press and every figure on the history
 * screen with it: a whole-app decision taken from a heading that sits above
 * one exercise's four rows. What was meant was "this rack is in pounds".
 */
function UnitHeader<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  /** The dimension, for the screen reader: "Weight", "Distance". */
  name: string;
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
}) {
  const colors = useColors();
  const next = options[(options.indexOf(value) + 1) % options.length] ?? value;

  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        onChange(next);
      }}
      accessibilityRole="button"
      // Names the dimension, because "kg" alone out of context is not a control
      // anyone can act on, and the hint is what makes it one rather than a
      // heading a screen reader user is left guessing about.
      accessibilityLabel={`${name} unit: ${value}`}
      accessibilityHint={`Switches to ${next}`}
      hitSlop={UNIT_SLOP}
      style={({ pressed }) => [styles.unitCell, styles.unitHeader, pressed && styles.pressed]}
    >
      <Text variant="overline" color="textTertiary">
        {value}
      </Text>
      {/* Overlay, not a sibling in the row. In-flow it stole ~11pt from the
          62pt cell and shifted "kg" off the numbers sitting in the same
          column. The glyph still marks the heading as tappable. */}
      <View pointerEvents="none" style={styles.unitSwap}>
        <Ionicons name="swap-horizontal" size={9} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

/**
 * One line for a suggestion: the target, then the sentence that justifies it.
 *
 * `82.5 kg × 8`, then the sentence that justifies it.
 *
 * The kicker on the card already says this is a suggestion, so the numbers
 * are not prefixed with "Target". The reason is the engine's own words and
 * arrives sentence case with no trailing period, so it is printed as given
 * rather than reworded here: one place decides how the app explains itself.
 *
 * The weight is read in the exercise's unit, never in kilograms, because the
 * whole point of the line is a number the user can walk to the rack and load.
 * The spoken label is built alongside the printed one rather than derived from
 * it, for the reason `describePlates` gives: `×` is read out inconsistently, so
 * a screen reader hears "for 8 reps".
 *
 * Null when the target is empty. An engine that has a kind and a reason but no
 * numbers has nothing to put in front of anyone.
 */
function describeSuggestion(
  suggestion: Suggestion,
  fields: { weight: boolean; reps: boolean },
  unit: WeightUnit,
): { text: string; detail: string; label: string } | null {
  // The first working set is the target. The engine may taper the ones after
  // it, and a heading that recited four sets would be the table below it.
  const target = suggestion.sets[0];
  if (!target) return null;

  const parts: string[] = [];
  const spoken: string[] = [];

  if (fields.weight && target.weightKg != null) {
    parts.push(formatWeight(target.weightKg, unit));
    spoken.push(formatWeight(target.weightKg, unit));
  }
  if (fields.reps && target.reps != null) {
    parts.push(parts.length > 0 ? `× ${target.reps}` : `${target.reps} reps`);
    spoken.push(spoken.length > 0 ? `for ${target.reps} reps` : `${target.reps} reps`);
  }

  if (parts.length === 0) return null;

  return {
    text: parts.join(' '),
    detail: suggestion.reason,
    label: `Suggested target, ${spoken.join(' ')}. ${suggestion.reason}`,
  };
}

/**
 * One line of plate maths: the bar, then what goes on each side.
 *
 * Two shapes, because the honest answer has two shapes. When the weight can be
 * made, it is the loading: `20 + 25 · 10 · 2.5 per side`. When it can't, it is
 * the two weights either side of it (`102.5 → 100 / 105`) which is the only
 * question `nearestLoadable` was ever written to answer.
 *
 * The spoken label is built alongside the printed one rather than derived from
 * it, because `·` and `×` are read out inconsistently and a screen reader
 * should hear "25 times 2" rather than "25 multiplication sign 2".
 */
function describePlates(
  targetKg: number,
  barKg: number,
  unit: WeightUnit,
): { text: string; label: string } | null {
  const inventory = defaultPlates(unit);
  const show = (kg: number) => formatWeight(kg, unit, { withUnit: false });
  const result = calculatePlates(targetKg, barKg, inventory);

  // Under the bar means the user is on a bar this app doesn't know about: a
  // 15 kg women's bar, a fixed EZ curl bar, and every number that follows
  // would be built on the wrong one. Same rule as the Smith machine: silence.
  if (result.belowBar) return null;

  if (!result.exact) {
    const { below, above } = nearestLoadable(targetKg, barKg, inventory);
    return {
      text: `${show(targetKg)} → ${show(below)} / ${show(above)}`,
      label: `${show(targetKg)} ${unit} is not loadable. Nearest are ${show(below)} and ${show(above)} ${unit}.`,
    };
  }

  if (result.plates.length === 0) {
    return { text: 'Empty bar', label: `Empty bar, ${show(barKg)} ${unit}.` };
  }

  const parts = result.plates.map((plate) => {
    const weight = show(plate.weightKg);
    if (plate.perSide === 1) return { text: weight, spoken: weight };
    return { text: `${weight} × ${plate.perSide}`, spoken: `${weight} times ${plate.perSide}` };
  });

  return {
    text: `${show(barKg)} + ${parts.map((part) => part.text).join(' · ')} per side`,
    label: `Bar ${show(barKg)} ${unit}, plus ${parts.map((part) => part.spoken).join(', ')} per side.`,
  };
}

/**
 * One line for the ramp: every rung, in the order they are walked.
 *
 * `Warm-up 40 × 8 · 60 × 5 · 80 × 3`. The same separators as the plate line
 * directly above it, because it is the same kind of statement: a list of
 * loadings read left to right, not a sentence about them.
 *
 * The spoken label is built alongside the printed one rather than derived from
 * it, for the reason `describePlates` gives: `×` and `·` are read out
 * inconsistently. It also leads with the count, because a control that writes
 * rows into a log has to say how many before it is pressed rather than after.
 */
function describeWarmup(
  sets: readonly WarmupSet[],
  unit: WeightUnit,
): { text: string; label: string } {
  const show = (kg: number) => formatWeight(kg, unit, { withUnit: false });
  const count = `${sets.length} warm-up ${sets.length === 1 ? 'set' : 'sets'}`;

  return {
    text: `Warm-up ${sets.map((set) => `${show(set.weightKg)} × ${set.reps}`).join(' · ')}`,
    label:
      `Add ${count}: ` +
      sets.map((set) => `${show(set.weightKg)} ${unit} for ${set.reps} reps`).join(', '),
  };
}

const styles = StyleSheet.create({
  block: { paddingVertical: spacing.md },
  header: {
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  titlePress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2 },
  thumbnail: { borderRadius: THUMBNAIL_SIZE / 2 },
  doneSlot: { width: 16, alignItems: 'center' },
  // Shrinks before the chevron does, so a long exercise name truncates instead
  // of pushing the affordance off the row. At subheading size a 390pt screen
  // now has the whole width under the name, which takes "Barbell Bulgarian
  // Split Squat" without clipping two variations of the same lift together.
  title: { flexShrink: 1 },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  cue: {
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  cueNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  cueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  cueChipDetail: { flex: 1 },
  cueCopy: { flex: 1, gap: 2 },
  cueHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cueHeadLabel: { flex: 1 },
  warmupRungs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  warmupRung: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  /*
   * One rule, under the headings only.
   *
   * `StatBand` had its rules taken away on the argument that figures in columns
   * under uppercase labels already read as a table without being boxed in, and
   * that is right: for two or three figures on one line. This is a real table:
   * five columns and up to a dozen rows, with editable fields in it. The
   * headings were floating a few points above the first row with nothing to
   * attach them to, so at a glance the top set row read as the heading's
   * content rather than as the first record under it.
   *
   * A rule under the headings is not the grid that was removed. There is
   * nothing between the columns, nothing under the rows and nothing around the
   * outside. The one line says where the header stops, which is the single
   * thing the eye was missing.
   */
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
    borderBottomWidth: stroke.rule,
  },
  indexCell: { width: 32, textAlign: 'center' },
  previousCell: { flex: 1, minWidth: 60 },
  unitCell: { width: 62, textAlign: 'center' },
  // Overlay host for the swap glyph. Width comes from `unitCell` so this row
  // stays the same 62pt the numeric fields use, and `justifyContent: 'center'`
  // keeps "kg" on the figures rather than left of the icon.
  unitHeader: { alignItems: 'center', justifyContent: 'center' },
  unitSwap: { position: 'absolute', right: 2, top: 0, bottom: 0, justifyContent: 'center' },
  // `SetRow` `effortCell.minWidth`. Keep them in lockstep.
  effortSpacer: { minWidth: 36 },
  checkSpacer: { width: 38 },
  plateLine: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  addSetRow: {
    flexDirection: 'row',
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
  pressed: { opacity: 0.6 },
});
