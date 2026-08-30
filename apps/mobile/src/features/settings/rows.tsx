/**
 * The five shapes a settings row comes in.
 *
 * They exist as one file, and are not `ListRow`, because a settings row differs
 * from a navigation row in the one place that cannot be papered over: what it
 * *is* to a screen reader. A toggle row is a switch, a choice row is a button
 * that opens a picker, and a segmented row is not a control at all. It is a
 * label sitting beside two of them. `ListRow` is a button, always, and it wraps
 * its subtree in one accessibility element; a `SegmentedControl` handed to it as
 * an accessory would be swallowed whole and unreachable.
 *
 * What they do share is geometry, and that is deliberate: the 34pt glyph, the
 * 12pt gap, the 56pt minimum and the 16pt gutter are `ListRow`'s, to the point,
 * so a settings card and the navigation card above it on the profile screen sit
 * on the same grid.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  FilterSheet,
  OptionList,
  PressableScale,
  SegmentedControl,
  Text,
  Toggle,
  type ListPickerOption,
  type PressableScaleProps,
  type SegmentOption,
} from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { hoverFill, radius, spacing, useColors } from '@/theme';

/**
 * Every control on this screen buzzes the same way, and it is `selection`:
 * documented in `features/feedback/haptics.ts` as "a value moved between
 * discrete states", which is what these rows do and the only thing they do. A
 * settings screen is the one place in the app where the tap *is* the outcome:
 * nothing navigates, nothing loads, a switch simply becomes the other switch,
 * and without a cue the only confirmation is the 180ms the thumb takes to
 * slide. It is a no-op when the user has haptics off.
 */
function acknowledge(): void {
  haptics.selection();
}

/** Matches `ListRow`. A settings card and a navigation card are the same object. */
const ROW_MIN_HEIGHT = 56;

/**
 * How wide an inline segmented control draws.
 *
 * Fixed, because the control positions its sliding thumb from a measured track
 * divided evenly. Segments that size to their own labels would put the thumb
 * under the wrong one. 104 is two 52pt halves, which is comfortable for the
 * two-letter unit abbreviations this row is for and nothing wider. A choice
 * whose options are *words* belongs in `SettingChoice`, where the sheet gives
 * them a full line each.
 */
const SEGMENT_WIDTH = 104;

export type SettingIcon = keyof typeof Ionicons.glyphMap;

// ---------------------------------------------------------------------------
// Shared face
// ---------------------------------------------------------------------------

interface RowFaceProps {
  icon: SettingIcon;
  label: string;
  /** The second line. What the setting does, or why the row is dead. */
  description?: string;
  /** Caps a wrapping description. Unset means the caption can run as long as it needs. */
  descriptionLines?: number;
  /** Caps the title. Unset means it can wrap with the description. */
  labelLines?: number;
  /**
   * Dims the glyph and the label only.
   *
   * Never the whole row: `Toggle` dims itself when disabled, and nesting that
   * inside a dimmed row multiplies the two into near-invisibility.
   */
  dimmed?: boolean;
  /** Danger paints the glyph and title, for a row that still needs a decision. */
  tone?: 'danger' | 'neutral';
}

function RowFace({
  icon,
  label,
  description,
  descriptionLines,
  labelLines,
  dimmed = false,
  tone = 'neutral',
}: RowFaceProps) {
  const colors = useColors();
  const danger = tone === 'danger';

  return (
    <>
      <View
        style={[
          styles.glyph,
          { backgroundColor: danger ? colors.dangerSurface : colors.surfaceMuted },
          dimmed && styles.dimmed,
        ]}
      >
        <Ionicons name={icon} size={17} color={danger ? colors.danger : colors.textSecondary} />
      </View>
      {/*
        `collapsable={false}` for the same reason `Button`'s label wrapper has
        it, and see that file for the crash. `styles.body` is layout only, so
        Fabric flattens it out of the native tree and the label below becomes a
        direct child of the row. Adding an opacity when the row dims needs a
        real view, so the wrapper materialises and the already-mounted label has
        to move into it, which Android's `addView` rejects while it still has a
        parent. Pinning it means dimming only ever changes an opacity.
      */}
      <View collapsable={false} style={[styles.body, dimmed && styles.dimmed]}>
        <Text
          variant="bodyMedium"
          numberOfLines={labelLines}
          style={danger ? { color: colors.danger } : undefined}
        >
          {label}
        </Text>
        {description && (
          <Text
            variant="caption"
            color={danger ? 'danger' : 'textTertiary'}
            numberOfLines={descriptionLines}
          >
            {description}
          </Text>
        )}
      </View>
    </>
  );
}

/**
 * The pressable frame.
 *
 * No scale. A row runs the full width of its card, so shrinking it pulls both
 * edges off the margin at once and reads as the row lifting away from the page
 * rather than being pressed into it. See `PRESS_SCALE` in the motion tokens.
 */
type PressableRowProps = Omit<
  PressableScaleProps,
  'style' | 'fill' | 'fillPressed' | 'hoverFill' | 'scaleTo' | 'dimTo' | 'children'
> & {
  onPress: () => void;
  children: ReactNode;
};

function PressableRow({ disabled = false, onPress, children, ...rest }: PressableRowProps) {
  const colors = useColors();

  return (
    <PressableScale
      disabled={disabled}
      onPress={onPress}
      fill={colors.surface}
      fillPressed={disabled ? colors.surface : colors.surfacePressed}
      hoverFill={disabled ? colors.surface : hoverFill(colors.surface, colors.surfacePressed)}
      scaleTo={1}
      style={styles.row}
      {...rest}
    >
      {children}
    </PressableScale>
  );
}

// ---------------------------------------------------------------------------
// SettingToggle
// ---------------------------------------------------------------------------

export interface SettingToggleProps {
  icon: SettingIcon;
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** Why the row is dead. Replaces the description, and is read out with the label. */
  disabledReason?: string;
}

export function SettingToggle({
  icon,
  label,
  description,
  value,
  onChange,
  disabled = false,
  disabledReason,
}: SettingToggleProps) {
  // A disabled row describes behaviour that is not happening, so the reason it
  // is dead is the more useful of the two lines, and the only one that tells
  // the user which switch above to turn back on.
  const detail = disabled ? disabledReason : description;

  return (
    <PressableRow
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      // The reason is folded in rather than left to the visual line beside it,
      // because a screen reader announcing a disabled switch with no explanation
      // is a dead end.
      accessibilityLabel={disabled && disabledReason ? `${label}. ${disabledReason}` : label}
      accessibilityHint={disabled ? undefined : description}
      disabled={disabled}
      onPress={() => {
        acknowledge();
        onChange(!value);
      }}
    >
      <RowFace icon={icon} label={label} description={detail} dimmed={disabled} />
      {/* The row is the 44pt target; the switch is only its readout. */}
      <Toggle presentational value={value} onValueChange={onChange} disabled={disabled} />
    </PressableRow>
  );
}

// ---------------------------------------------------------------------------
// SettingValue
// ---------------------------------------------------------------------------

export interface SettingValueProps {
  icon: SettingIcon;
  label: string;
  /** Already formatted, unit included. "Not set" is a legitimate value. */
  value: string;
  hint: string;
  onPress: () => void;
}

/** A number the user types, shown in place and edited in a dialog. */
export function SettingValue({ icon, label, value, hint, onPress }: SettingValueProps) {
  const colors = useColors();

  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityHint={hint}
      onPress={onPress}
    >
      <RowFace icon={icon} label={label} />
      <Text variant="numeric" color="textSecondary" numberOfLines={1} style={styles.trailing}>
        {value}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </PressableRow>
  );
}

// ---------------------------------------------------------------------------
// SettingChoice
// ---------------------------------------------------------------------------

export interface SettingChoiceProps<T extends string> {
  icon: SettingIcon;
  label: string;
  /** The second line. What the setting does, or why the row is dead. */
  description?: string;
  options: readonly ListPickerOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Why the row is dead. Replaces the description, and is read out with the label. */
  disabledReason?: string;
  /**
   * Put the chosen option under the label instead of beside it.
   *
   * For a choice whose options are themselves long names: a trailing value of
   * similar length cramps both onto one line. Underneath, each gets a full row.
   */
  valueBelow?: boolean;
  /** Danger for a choice that is still unresolved. */
  tone?: 'danger' | 'neutral';
}

/**
 * One of several named options, chosen in a sheet.
 *
 * The default for anything whose options are words rather than abbreviations.
 * Six formulas or two weekdays both fit here and neither fits across a phone,
 * and the row stays one line however many options exist, which is the property
 * that lets a settings card hold ten of these and still be scannable.
 */
export function SettingChoice<T extends string>({
  icon,
  label,
  description,
  options,
  value,
  onChange,
  disabled = false,
  disabledReason,
  valueBelow = false,
  tone = 'neutral',
}: SettingChoiceProps<T>) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  const current = options.find((option) => option.value === value) ?? options[0];

  // Same rule as `SettingToggle`: a dead row is better spent saying which
  // switch above to turn back on than describing behaviour that is not running.
  const detail = disabled
    ? disabledReason
    : valueBelow
      ? current?.label
      : description;

  return (
    <>
      <PressableRow
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled }}
        accessibilityLabel={
          disabled && disabledReason
            ? `${label}, ${current?.label ?? ''}. ${disabledReason}`
            : `${label}, ${current?.label ?? ''}`
        }
        accessibilityHint={disabled ? undefined : `Opens the ${label.toLowerCase()} picker`}
        disabled={disabled}
        onPress={() => setOpen(true)}
      >
        <RowFace
          icon={icon}
          label={label}
          description={detail}
          descriptionLines={valueBelow ? 2 : undefined}
          labelLines={valueBelow ? 2 : undefined}
          dimmed={disabled}
          tone={tone}
        />
        {!valueBelow && (
          <Text
            variant="label"
            color={tone === 'danger' ? 'danger' : 'textSecondary'}
            numberOfLines={1}
            style={[styles.trailing, disabled && styles.dimmed]}
          >
            {current?.label}
          </Text>
        )}
        <Ionicons
          name="chevron-forward"
          size={18}
          color={tone === 'danger' ? colors.danger : colors.textTertiary}
        />
      </PressableRow>

      <FilterSheet visible={open} label={label} onClose={() => setOpen(false)}>
        <OptionList
          options={options}
          value={value}
          onChange={(next) => {
            // Only when it actually moves. Re-picking the option already in
            // force is how people confirm they read the sheet correctly, and
            // buzzing for it says something changed when nothing did.
            if (next !== value) acknowledge();
            onChange(next);
            setOpen(false);
          }}
        />
      </FilterSheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// SettingSegmented
// ---------------------------------------------------------------------------

export interface SettingSegmentedProps<T extends string> {
  icon: SettingIcon;
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A two-way switch between abbreviations, answered without leaving the screen.
 *
 * KG or LB is the setting people come to this screen to change, and routing a
 * two-option choice through a sheet costs two taps and a modal to move one
 * letter. The track is short enough to sit at the row's trailing edge where a
 * chevron would be, so the row still reads as a row.
 *
 * A plain `View`, not a `Pressable`: the segments are the controls, and a
 * pressable parent would collapse them into a single accessibility element and
 * take both of them away from a screen reader.
 */
export function SettingSegmented<T extends string>({
  icon,
  label,
  options,
  value,
  onChange,
}: SettingSegmentedProps<T>) {
  return (
    <View style={styles.row}>
      <RowFace icon={icon} label={label} />
      <SegmentedControl
        size="sm"
        label={label}
        options={options}
        value={value}
        onChange={(next) => {
          // Same guard as `SettingChoice`: the segment already under the thumb
          // is a live target and tapping it changes nothing.
          if (next !== value) acknowledge();
          onChange(next);
        }}
        style={styles.segments}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// SettingAction
// ---------------------------------------------------------------------------

export interface SettingActionProps {
  icon: SettingIcon;
  label: string;
  description?: string;
  onPress: () => void;
  /**
   * `danger` by default, because for a long time Reset was the only row of this
   * shape and the colour *was* the warning. A row that does something ordinary
   * and reversible passes `neutral` and reads like the rest of the card.
   */
  tone?: 'danger' | 'neutral';
  /**
   * Dead but still legible, for a row whose action is not available yet rather
   * than not permitted. Dims the same two elements `RowFace` does.
   */
  disabled?: boolean;
  /** A readout at the trailing edge, where `SettingValue` puts its value. */
  trailing?: ReactNode;
}

/**
 * A row that does something rather than holding a value.
 *
 * Reset is the danger-coloured one, and it is coloured because that is the
 * whole warning a settings screen gets to give before the dialog: every other
 * row on this screen is reversible by tapping it again, and that one is not.
 */
export function SettingAction({
  icon,
  label,
  description,
  onPress,
  tone = 'danger',
  disabled = false,
  trailing,
}: SettingActionProps) {
  const colors = useColors();
  const danger = tone === 'danger';

  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      <View
        style={[
          styles.glyph,
          { backgroundColor: danger ? colors.dangerSurface : colors.surfaceMuted },
          disabled && styles.dimmed,
        ]}
      >
        <Ionicons name={icon} size={17} color={danger ? colors.danger : colors.textSecondary} />
      </View>
      {/* Pinned against flattening, as above. */}
      <View collapsable={false} style={[styles.body, disabled && styles.dimmed]}>
        <Text variant="bodyMedium" style={danger ? { color: colors.danger } : undefined}>
          {label}
        </Text>
        {description && (
          <Text variant="caption" color="textTertiary">
            {description}
          </Text>
        )}
      </View>
      {trailing}
    </PressableRow>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: ROW_MIN_HEIGHT,
  },
  glyph: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  dimmed: { opacity: 0.4 },
  // Shrinks before the label does, and never wraps: a trailing value is a
  // readout of the row, so a two-line one would make the row taller than the
  // thing it is reporting.
  trailing: { flexShrink: 1, textAlign: 'right' },
  segments: { width: SEGMENT_WIDTH },
});
