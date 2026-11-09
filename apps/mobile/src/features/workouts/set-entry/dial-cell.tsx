import { Pressable, StyleSheet, Text as RNText, type StyleProp, type ViewStyle } from 'react-native';

import { font, fontSize, radius, spacing, stroke, useColors } from '@/theme';

interface DialCellProps {
  /** What the set holds, as the field would show it. Empty when null. */
  text: string;
  /** Last session's number, shown when `text` is empty. */
  placeholder: string;
  /** The docked panel is on this cell. */
  selected: boolean;
  onPress: () => void;
  /** Swaps in a text field, for a number no dial step lands on. */
  onLongPress: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The weight or reps cell when entry is a docked dial.
 *
 * Drawn to match `NumericField` exactly (fill, height, radius, type) so a
 * table looks the same in every entry mode. A tap opens the panel rather than
 * the keyboard; a long press types, which is the way to an 83.75 that no step
 * lands on.
 */
export function DialCell({
  text,
  placeholder,
  selected,
  onPress,
  onLongPress,
  accessibilityLabel,
  style,
}: DialCellProps) {
  const colors = useColors();
  const empty = text === '';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: empty ? `empty, last time ${placeholder}` : text }}
      accessibilityHint="Opens the dial. Long press to type."
      style={({ pressed }) => [
        styles.cell,
        {
          backgroundColor: selected
            ? colors.accentSurface
            : pressed
              ? colors.surfacePressed
              : colors.surfaceMuted,
          borderColor: selected ? colors.accent : colors.surfaceMuted,
        },
        style,
      ]}
    >
      <RNText
        numberOfLines={1}
        style={[
          styles.text,
          { color: selected ? colors.accent : empty ? colors.textSecondary : colors.text },
        ]}
      >
        {empty ? placeholder : text}
      </RNText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // `numericField` in `components/ui/input.tsx`, less the TextInput padding fixes.
  cell: {
    minWidth: 62,
    height: 34,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    borderWidth: stroke.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: fontSize.md,
    ...font('semibold'),
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
});
