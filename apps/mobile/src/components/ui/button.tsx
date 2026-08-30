import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type PressableProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  controlHeight,
  duration,
  font,
  fontSize,
  hoverFill,
  radius,
  scaleAlpha,
  spacing,
  stroke,
  useColors,
  type Palette,
} from '@/theme';

import { PressableScale } from './motion';
import { Text } from './text';

export type ButtonVariant =
  /** The one action a screen most wants you to take. At most one per view. */
  | 'primary'
  /** Filled but neutral: the companion action next to a primary. */
  | 'secondary'
  /** Outlined and transparent, for actions on top of a card or image. */
  | 'outline'
  /** Text only. Lowest weight; use inside rows and headers. */
  | 'ghost'
  /** Destructive and irreversible: delete a workout, discard a session. */
  | 'danger'
  /** Confirms and completes: finish workout, save. */
  | 'success';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  fullWidth?: boolean;
  /**
   * Scroll a label that does not fit, instead of ellipsising it.
   *
   * Dialog actions that name an exercise are the reason: the name is the
   * choice, and a truncated verb is worse than watching it travel. Short
   * labels do not move. Reduce Motion keeps the ellipsis.
   */
  marquee?: boolean;
  style?: ViewStyle;
}

interface SizeSpec {
  height: number;
  paddingHorizontal: number;
  fontSize: number;
  iconSize: number;
  radius: number;
}

const SIZES: Record<ButtonSize, SizeSpec> = {
  sm: {
    height: controlHeight.sm,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    iconSize: 16,
    radius: radius.sm,
  },
  md: {
    height: controlHeight.md,
    paddingHorizontal: spacing.lg,
    fontSize: fontSize.md,
    iconSize: 18,
    radius: radius.md,
  },
  lg: {
    height: controlHeight.lg,
    paddingHorizontal: spacing.xl,
    fontSize: fontSize.lg,
    iconSize: 20,
    radius: radius.md,
  },
};

interface VariantSpec {
  bg: string;
  bgHover: string;
  bgPressed: string;
  fg: string;
  /**
   * An outline, for the one variant that is nothing without it.
   *
   * `outline` only. Every other variant is a filled shape, and a filled shape
   * with a line around it is two statements of the same edge: the fill already
   * says where the button stops. Left off, the border is not drawn at all.
   */
  border?: string;
  /**
   * Outline at full press, for a border that carries the press itself.
   *
   * Unused today, and deliberately kept: `PressableScale` only interpolates the
   * outline when it is given two ends to travel between, so a variant that names
   * a static border keeps it from the stylesheet below and pays for no extra
   * colour interpolation.
   */
  borderPressed?: string;
}

/**
 * Every variant names its own pressed colour rather than leaning on opacity.
 *
 * Dimming works on a filled button and does nothing legible on a transparent
 * one, which is how ghost and outline ended up feeling dead to the touch while
 * primary felt fine. A colour per state makes all six respond identically.
 *
 * `bgHover` is the desktop addition, and it is derived rather than chosen: see
 * `hoverFill` in the theme for the rule and why it stops halfway.
 *
 * The two transparent variants are the exception and take the pressed fill
 * outright. There is nothing to blend from: `transparent` is not a colour, and
 * blending from a guess at whatever is behind the button would be wrong on
 * exactly the surfaces these two are for. They still answer a click, through
 * the scale rather than the fill.
 */
function variantSpecs(c: Palette): Record<ButtonVariant, VariantSpec> {
  return {
    primary: {
      bg: c.accent,
      bgHover: hoverFill(c.accent, c.accentPressed),
      bgPressed: c.accentPressed,
      fg: c.textOnAccent,
    },
    secondary: {
      bg: c.surfaceMuted,
      bgHover: hoverFill(c.surfaceMuted, c.surfacePressed),
      bgPressed: c.surfacePressed,
      fg: c.text,
    },
    outline: {
      bg: 'transparent',
      bgHover: c.surfaceMuted,
      bgPressed: c.surfaceMuted,
      fg: c.text,
      border: c.borderStrong,
    },
    ghost: {
      bg: 'transparent',
      bgHover: c.surfaceMuted,
      bgPressed: c.surfaceMuted,
      fg: c.accent,
    },
    /*
     * A red tint carrying red text. No outline, and no solid fill either.
     *
     * The solid version was unreadable: its label was `textOnDanger`, which on
     * the old red measured 3.06 against a 4.5 requirement, and no red bright
     * enough for an AMOLED palette can carry white text (see `danger` in the
     * tokens). Printing the role colour on a tint of itself reads 5.38 on the
     * canvas and 4.87 on a card instead. A solid red slab was also the loudest
     * object on any screen it appeared on, spent on the action the user least
     * wants to take.
     *
     * It used to be outlined in its own role colour on top of that, and the
     * outline is gone: a tint this far from the surface behind it already draws
     * its own edge, and a line around it only made the button look like a
     * warning banner. What still reads as destructive is the colour, which is
     * unique in the app: nothing else here is red.
     *
     * That leaves the press to the fill and the scale. The fill moves 1.25× and
     * no further, and this is the one variant where that ceiling is measured
     * rather than chosen: deepening a tint that its own label is printed on
     * closes the gap between the two, and at 1.5× the label goes under AA on a
     * card. `PressableScale` carries the rest of the gesture.
     */
    danger: {
      bg: c.dangerSurface,
      bgHover: scaleAlpha(c.dangerSurface, 1.125),
      bgPressed: scaleAlpha(c.dangerSurface, 1.25),
      fg: c.danger,
    },
    success: {
      bg: c.success,
      bgHover: hoverFill(c.success, c.successPressed),
      bgPressed: c.successPressed,
      fg: c.textOnSuccess,
    },
  };
}

/**
 * Built once per palette, of which there are two.
 *
 * `variantSpecs` used to run on every render of every button, which was six
 * object literals and no arithmetic. It now also runs four sRGB blends, and a
 * button is a common enough leaf that recomputing a constant on every render of
 * it is not worth the simplicity. Same shape as `makeStyles` in the theme.
 */
const specCache = new Map<Palette, Record<ButtonVariant, VariantSpec>>();

function useVariantSpecs(colors: Palette): Record<ButtonVariant, VariantSpec> {
  let specs = specCache.get(colors);
  if (!specs) {
    specs = variantSpecs(colors);
    specCache.set(colors, specs);
  }
  return specs;
}

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  loading = false,
  fullWidth = false,
  marquee = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const colors = useColors();
  const dimensions = SIZES[size];
  const { bg, bgHover, bgPressed, fg, border, borderPressed } = useVariantSpecs(colors)[variant];

  const isDisabled = disabled || loading;
  const labelStyle = { color: fg, fontSize: dimensions.fontSize, ...font('semibold') };

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      // The fill crossfade and the scale are one gesture read two ways: colour
      // says the control acknowledged the touch, size says it moved under it.
      // Neither can fire while disabled. The press handlers are not wired at
      // all then, so the 40% in `styles.disabled` is the whole story there.
      fill={bg}
      fillPressed={bgPressed}
      hoverFill={bgHover}
      // Both or neither: `PressableScale` only drives the outline when it has
      // two ends to travel between, so the variants that name a static border
      // keep it from the stylesheet below.
      border={border}
      borderPressed={borderPressed}
      style={[
        styles.base,
        {
          height: dimensions.height,
          paddingHorizontal: dimensions.paddingHorizontal,
          borderRadius: dimensions.radius,
          backgroundColor: bg,
          borderColor: border ?? 'transparent',
          borderWidth: border ? stroke.outline : 0,
        },
        fullWidth && styles.fullWidth,
        marquee && styles.marqueeHost,
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {/*
        The label stays mounted while loading and is hidden with opacity, so the
        button keeps its width instead of collapsing to spinner-size and shoving
        whatever sits beside it sideways for the length of the request.

        **`collapsable={false}` is load-bearing and this button crashes the app
        without it.** `styles.content` is nothing but layout: a row, centred,
        with a gap. Fabric flattens a view like that out of the native tree
        entirely, so the label normally sits as a direct child of the pressable.
        Then `loading` goes true, `styles.hidden` adds an opacity, and opacity is
        a property that needs a real view: the same commit that adds the spinner
        also has to materialise this wrapper and move the already-mounted label
        into it. Android's `ViewGroup.addView` refuses a child that still has a
        parent, and `SurfaceMountingManager` cannot always detach it in time:

            addViewAt: cannot insert view [1102] into parent [1104]:
            View already has a parent: [1106]

        which is fatal, and on a release build the app simply closes. Pinning the
        view into existence means the tree shape never changes on this toggle:
        the wrapper is always there and only its opacity moves, which is what
        the comment above always claimed was happening.
      */}
      <View
        collapsable={false}
        style={[styles.content, marquee && styles.marqueeContent, loading && styles.hidden]}
      >
        {icon && iconPosition === 'left' && (
          <Ionicons name={icon} size={dimensions.iconSize} color={fg} />
        )}
        {marquee ? (
          <MarqueeLabel title={title} style={labelStyle} />
        ) : (
          <Text numberOfLines={1} style={labelStyle}>
            {title}
          </Text>
        )}
        {icon && iconPosition === 'right' && (
          <Ionicons name={icon} size={dimensions.iconSize} color={fg} />
        )}
      </View>

      {loading && (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={fg} size="small" />
        </View>
      )}
    </PressableScale>
  );
}

/**
 * A label that travels when it cannot fit, and sits still when it can.
 *
 * The copy is measured in a 10000pt lane. Measuring with `onLayout` inside
 * the clip reports the clip's width, which is already the truncated size,
 * so overflow never trips and `numberOfLines={1}` keeps drawing an ellipsis.
 * `onTextLayout` in a lane wider than any label is the actual string.
 * Reduce Motion keeps the ellipsis: a name sliding past is decoration.
 */
function MarqueeLabel({ title, style }: { title: string; style: TextStyle }) {
  const reduceMotion = useReduceMotion();
  const offset = useSharedValue(0);
  const [box, setBox] = useState(0);
  const [copy, setCopy] = useState(0);

  const overflow = box > 0 && copy > box + 1;
  const run = overflow && !reduceMotion;

  useEffect(() => {
    cancelAnimation(offset);
    offset.value = 0;
    if (!run) return;

    const travel = copy - box;
    const scrollMs = Math.max(duration.slow, Math.round(travel / 0.04));

    offset.value = withRepeat(
      withSequence(
        withTiming(0, { duration: duration.count }),
        withTiming(-travel, { duration: scrollMs, easing: Easing.linear }),
        withTiming(-travel, { duration: duration.base }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
    );

    return () => {
      cancelAnimation(offset);
    };
  }, [run, copy, box, offset, title]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  if (reduceMotion) {
    return (
      <Text numberOfLines={1} style={[style, styles.marqueeReduced]}>
        {title}
      </Text>
    );
  }

  return (
    <View
      collapsable={false}
      style={[styles.marqueeClip, overflow || box === 0 ? styles.marqueeStart : styles.marqueeCenter]}
      onLayout={(event) => setBox(event.nativeEvent.layout.width)}
    >
      <Text
        pointerEvents="none"
        style={[style, styles.marqueeMeasure]}
        onTextLayout={(event) => {
          const line = event.nativeEvent.lines[0];
          if (line) setCopy(line.width);
        }}
      >
        {title}
      </Text>
      <Animated.View style={[styles.marqueeTrack, animated]}>
        <Text
          numberOfLines={1}
          ellipsizeMode="clip"
          style={[style, styles.marqueeLabel, copy > 0 ? { width: copy } : null]}
        >
          {title}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  hidden: { opacity: 0 },
  spinner: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.4 },
  marqueeHost: { overflow: 'hidden', minWidth: 0 },
  marqueeContent: { flex: 1, alignSelf: 'stretch', minWidth: 0, width: '100%' },
  marqueeClip: { flex: 1, minWidth: 0, overflow: 'hidden' },
  marqueeTrack: { flexDirection: 'row' },
  marqueeLabel: { flexShrink: 0 },
  marqueeReduced: { flex: 1, minWidth: 0 },
  marqueeMeasure: { position: 'absolute', opacity: 0, width: 10000 },
  marqueeStart: { alignItems: 'flex-start' },
  marqueeCenter: { alignItems: 'center' },
});
