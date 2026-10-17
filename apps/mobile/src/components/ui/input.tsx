import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  controlHeight,
  font,
  fontSize,
  HIT_SLOP,
  radius,
  spacing,
  stroke,
  useColors,
} from '@/theme';

import { Text } from './text';

// Derived from the prop rather than imported by name: React Native has renamed
// these payload types across versions, and deriving keeps this compiling
// through the next rename.
type FocusHandler = NonNullable<TextInputProps['onFocus']>;
type BlurHandler = NonNullable<TextInputProps['onBlur']>;

/**
 * Tracks focus while still forwarding whatever `onFocus`/`onBlur` the caller
 * passed, so a focus ring never costs a component its own handlers.
 */
function useFocusRing(props: Pick<TextInputProps, 'onFocus' | 'onBlur'>) {
  const [focused, setFocused] = useState(false);

  const onFocus: FocusHandler = (event) => {
    setFocused(true);
    props.onFocus?.(event);
  };

  const onBlur: BlurHandler = (event) => {
    setFocused(false);
    props.onBlur?.(event);
  };

  return { focused, onFocus, onBlur };
}

// ---------------------------------------------------------------------------
// SearchBar
// ---------------------------------------------------------------------------

export interface SearchBarProps extends Omit<TextInputProps, 'style'> {
  onClear?: () => void;
  style?: ViewStyle;
}

export function SearchBar({ value, onClear, style, onFocus, onBlur, ...rest }: SearchBarProps) {
  const colors = useColors();
  const ring = useFocusRing({ onFocus, onBlur });

  return (
    <View
      style={[
        styles.searchContainer,
        {
          backgroundColor: colors.surfaceMuted,
          // The unfocused ring is the field's own fill, not `transparent`: the
          // border is drawn either way, so the field cannot change width when
          // it takes focus, and a see-through stroke around a radius leaves a
          // seam on Android. See `stroke` in the tokens.
          borderColor: ring.focused ? colors.accent : colors.surfaceMuted,
        },
        style,
      ]}
    >
      <Ionicons
        name="search"
        size={17}
        color={ring.focused ? colors.accent : colors.textTertiary}
      />
      <TextInput
        value={value}
        placeholderTextColor={colors.textTertiary}
        style={[styles.searchInput, { color: colors.text }]}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        {...rest}
      />
      {value ? (
        <Pressable onPress={onClear} hitSlop={HIT_SLOP} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={17} color={colors.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// TextField
// ---------------------------------------------------------------------------

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  hint?: string;
  containerStyle?: ViewStyle;
  /** Styles the input itself. A `TextInput` takes text styles, not view styles. */
  style?: StyleProp<TextStyle>;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, containerStyle, style, onFocus, onBlur, ...rest },
  ref,
) {
  const colors = useColors();
  const ring = useFocusRing({ onFocus, onBlur });

  // Error outranks focus: a field you are typing into is still the field that
  // is wrong, and swapping red for blue on focus hides that until you leave.
  const borderColor = error ? colors.danger : ring.focused ? colors.accent : colors.border;

  return (
    <View style={[styles.fieldContainer, containerStyle]}>
      {label && (
        <Text variant="label" color="textSecondary">
          {label}
        </Text>
      )}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textTertiary}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        style={[
          styles.field,
          { backgroundColor: colors.surfaceMuted, color: colors.text, borderColor },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textTertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

// ---------------------------------------------------------------------------
// NumericField. Used by set rows
// ---------------------------------------------------------------------------

export interface NumericFieldProps extends Omit<TextInputProps, 'style' | 'value'> {
  value: string;
  /**
   * Maps an emitted string to the `value` it will come back as. Default
   * identity, which is correct wherever storage renders back exactly what was
   * typed (weight, reps, distance). Duration re-spells every emission as M:SS,
   * so without this its echoes never match and the buffer is inert.
   */
  normalize?: (emitted: string) => string;
  /**
   * Re-spells the field's text as it is typed, before it is shown or emitted.
   * Default identity. Duration uses it to insert colons under a number pad,
   * which has no colon key: see `formatDurationDraft`.
   */
  format?: (text: string) => string;
  align?: 'left' | 'center' | 'right';
  style?: StyleProp<TextStyle>;
}

/**
 * A numeric field that owns its text while you are typing in it.
 *
 * Everywhere this is used the `value` prop is a *formatted view of storage*:
 * the set row writes every keystroke to SQLite and reads the number back
 * through a live query and a kilogram conversion. Rendering that echo directly
 * makes the field fight the user. 225 entered in pounds returns as "225.0", a
 * typed "." disappears because it parses to nothing new, and a half-typed "290"
 * can be rewritten between two keystrokes. So the raw string lives here while
 * the field is focused, and the echo is ignored.
 *
 * Re-sync happens on blur, and while focused whenever an incoming `value`
 * matches none of the strings this field still has in flight. That second
 * clause is what makes the set row's Previous column work: the scroll view it
 * sits in sets `keyboardShouldPersistTaps="handled"`, so tapping Previous
 * copies last session's numbers in *without* blurring the field, and a
 * blur-only re-sync would quietly drop them. `selectTextOnFocus` makes a re-sync invisible on the
 * way in, since the text is being replaced while it is selected anyway.
 *
 * There is deliberately no debounce on the write this buffer feeds. `Finish`
 * lives in the header outside the scroll view and does not reliably blur the
 * focused field, and a swipe-delete can destroy the row before any blur, so a
 * pending keystroke would be the last weight of the session. The buffer already
 * removes the reason anyone wanted a debounce, which was latency, not writes.
 */
export const NumericField = forwardRef<TextInput, NumericFieldProps>(function NumericField(
  {
    value,
    normalize = (text: string) => text,
    format = (text: string) => text,
    align = 'center',
    style,
    onChangeText,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const colors = useColors();
  const ring = useFocusRing({ onFocus, onBlur });

  // `draft` is what the field shows, `seen` the last `value` it reacted to, and
  // `pending` every string still on its way to storage, oldest first. The three
  // are one state object because they only ever change together, and because
  // comparing against a ref would mean reading a ref during render.
  const [buffer, setBuffer] = useState(() => ({
    draft: value,
    seen: value,
    pending: [] as string[],
  }));

  // Adjusted during render rather than from an effect, which would paint the
  // stale draft for a frame before correcting it.
  if (value !== buffer.seen) {
    /*
     * An echo that matches something still in flight is this field's own write
     * coming back (possibly several keystrokes late) rather than somebody
     * else writing the row, so the draft stands. Keeping only the newest
     * emission was not enough: two keystrokes inside one write's latency made
     * the first echo look foreign, and the field threw away the digit that had
     * just been typed.
     *
     * The first match, not the last: "5" then "50" then "5" again puts the same
     * string in twice, and draining to the last one would strand the entries
     * before it. Everything up to and including the match goes, which is what
     * makes an emission that never echoes. A trailing "." formats back to what
     * was already stored: harmless rather than permanent.
     *
     * The queue holds what was typed, so each entry is compared through
     * `normalize`: a duration field never gets "2:0" back, it gets "2:00".
     */
    const index = ring.focused
      ? buffer.pending.findIndex((entry) => normalize(entry) === value)
      : -1;
    setBuffer(
      index === -1
        ? { draft: value, seen: value, pending: [] }
        : { ...buffer, seen: value, pending: buffer.pending.slice(index + 1) },
    );
  }

  const handleChangeText = (text: string) => {
    // Re-spelled before it is stored or shown, so a formatted field owns one
    // version of its text: the digits the user typed in, the colon on screen,
    // and what the parent parses all agree. `pending` holds the same string, so
    // the echo it comes back as still matches.
    const emitted = format(text);
    setBuffer((current) => ({
      ...current,
      draft: emitted,
      // Capped, because a keystroke that never echoes only leaves the queue
      // when a later echo matches past it.
      pending: [...current.pending, emitted].slice(-12),
    }));
    onChangeText?.(emitted);
  };

  const handleBlur: BlurHandler = (event) => {
    // Back to the stored truth. A trailing "." or "0" is meaningful only while
    // the number is still being typed.
    setBuffer({ draft: value, seen: value, pending: [] });
    ring.onBlur(event);
  };

  return (
    <TextInput
      ref={ref}
      value={buffer.draft}
      onChangeText={handleChangeText}
      // `decimal-pad` rather than `numeric`: it omits the sign and exponent keys
      // that make no sense for a weight, and keeps a decimal point for plates.
      keyboardType="decimal-pad"
      selectTextOnFocus
      // Not `textTertiary` like the other fields: in a set row the placeholder
      // is last session's weight, which is information rather than a hint, and
      // the third tier only measures 3.30:1 against the field's own fill.
      placeholderTextColor={colors.textSecondary}
      onFocus={ring.onFocus}
      onBlur={handleBlur}
      style={[
        styles.numericField,
        {
          backgroundColor: colors.surfaceMuted,
          color: colors.text,
          // The ring matters more here than anywhere else: set rows put several
          // of these side by side, and mid-set you need to know at a glance
          // which box the keyboard is pointed at. Unfocused it is the fill
          // rather than transparent: see the search field above.
          borderColor: ring.focused ? colors.accent : colors.surfaceMuted,
          textAlign: align,
        },
        style,
      ]}
      {...rest}
    />
  );
});

const styles = StyleSheet.create({
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    /*
     * `controlHeight.md` and `radius.md`, which is what a control is in this
     * app: `Button` at md and lg, `TextField`, `SegmentedControl`'s track,
     * `ListPicker`'s trigger and `HeaderAction` all sit on exactly that pair.
     * `radius.pill` is for the other vocabulary. Chips, badges, progress
     * tracks, and square boxes where a pill is how you draw a circle.
     *
     * The height moved up from `sm`. 36pt is under `MIN_TOUCH_SIZE`, and
     * `FilterTrigger` records leaving `sm` for exactly that reason: nothing
     * around a free-standing filter bar carries its target the way a set row
     * carries its stepper's. Every search field in the app was eight points
     * short of the floor, which only became visible once History put one
     * beside a 44pt trigger.
     */
    height: controlHeight.md,
    borderRadius: radius.md,
    borderWidth: stroke.outline,
  },
  /*
   * Both of these name the family, and it is not optional.
   *
   * A `TextInput` inherits nothing: `Text` gets the bundled face because the
   * `Text` component puts it there per variant, and an input is a different
   * primitive that RN renders in the platform's own UI font unless told
   * otherwise. So every typed field in the app: the search bars, a workout
   * name, an exercise name, a note, a routine title. Was set in Roboto or SF
   * while the label directly above it was set in the bundled family. The
   * numeric field already knew this; these two were the ones that did not.
   *
   * `regular` because these are body text being composed rather than figures
   * being read: the same weight `Text`'s `body` variant uses, so a field and
   * the copy beside it are the same voice. The placeholder inherits it too.
   */
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    ...font('regular'),
    padding: 0,
  },
  fieldContainer: { gap: spacing.xs },
  field: {
    height: controlHeight.md,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
    ...font('regular'),
    borderWidth: stroke.outline,
  },
  numericField: {
    minWidth: 62,
    height: 34,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    // Android clips digits in a fixed-height TextInput without these three.
    //
    // An EditText carries its own default vertical padding *and*, with
    // `includeFontPadding`, reserves extra room above the ascender and below
    // the descender sized from the font's own metrics. Between that band and
    // the default padding, height 34 is overspent and the glyphs get cut off
    // top and bottom, which is exactly what a weight of "50" looked like.
    // Zeroing the padding and dropping the font padding lets
    // `textAlignVertical` centre the real glyph box instead of a padded one.
    //
    // Harmless on iOS: it ignores all three.
    paddingVertical: 0,
    textAlignVertical: 'center',
    includeFontPadding: false,
    fontSize: fontSize.md,
    ...font('semibold'),
    fontVariant: ['tabular-nums'],
    borderWidth: stroke.outline,
  },
});
