import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, PressableScale, Text } from '@/components/ui';
import { useTicker } from '@/hooks/use-ticker';
import { readRest, useTimer } from '@/store/timer';
import {
  duration,
  easing,
  fontSize,
  MIN_TOUCH_SIZE,
  PRESS_SCALE_SMALL,
  radius,
  spacing,
  stroke,
  timing,
  useColors,
} from '@/theme';

import { ADJUST_SECONDS, describeRest, useRestControls, useRestProgress } from './rest-controls';

/**
 * The progress line's thickness.
 *
 * Not `stroke.rule`, which is one physical pixel and belongs to dividers. This
 * line carries the whole state of the countdown at a glance from across the
 * gym, and a hairline of it disappears against the surface it sits on.
 */
const TRACK_HEIGHT = 3;

/** The control row. Every target in it is a real 44, so nothing needs hit slop. */
const ROW_HEIGHT = MIN_TOUCH_SIZE;

/**
 * The bar's height, excluding the safe-area inset it adds underneath itself.
 *
 * Exported because the bar is `position: 'absolute'` and therefore invisible to
 * layout: the screen that mounts it has to reserve this much at the bottom of
 * its scroll or the last set row spends the whole rest period underneath the
 * countdown. The row's height is fixed rather than intrinsic for exactly this
 * reason: a promise the caller reserves against cannot be "however tall the
 * readout came out this time".
 */
export const REST_BAR_HEIGHT = stroke.rule + TRACK_HEIGHT + spacing.sm + ROW_HEIGHT + spacing.sm;

export interface RestTimerBarProps {
  /**
   * Opens the expanded timer. The caller owns the sheet's visibility, because
   * the sheet is also reachable from the header while nothing is resting: a
   * bar that owned it would have to be mounted, and visible, to be asked.
   *
   * Nothing else is passed in. The rest-duration chip and the exercise name
   * live in the sheet: this row has space for a countdown and four controls,
   * and everything that was competing for that space was a thing to read
   * rather than a thing to press.
   */
  onExpand?: () => void;
}

/**
 * The countdown between sets, docked to the bottom of the screen.
 *
 * It is deliberately one row and nothing more. The previous version was a card
 * in the flow of the workout that grew and collapsed the layout under a thumb
 * already travelling towards the next checkbox: ninety points of movement that
 * is how a mis-tap completes the wrong set. Pinning it to the bottom edge takes
 * it out of layout entirely: the list above never moves, and the bar arrives and
 * leaves by sliding past the edge of the screen rather than by pushing anything.
 *
 * Everything the compact row has no space for. The exercise it belongs to, the
 * rest-duration chip, pause, start: lives in the sheet behind `onExpand`.
 */
export function RestTimerBar({ onExpand }: RestTimerBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const controls = useRestControls();

  const restEndsAt = useTimer((state) => state.restEndsAt);
  const restPausedSeconds = useTimer((state) => state.restPausedSeconds);
  const restTotalSeconds = useTimer((state) => state.restTotalSeconds);
  const restKind = useTimer((state) => state.restKind);

  const resting = restEndsAt !== null || restPausedSeconds !== null;

  // Only tick while the clock is actually moving. A paused timer shows a frozen
  // number, and an idle one is off the bottom of the screen.
  const now = useTicker(1000, restEndsAt !== null);

  /*
   * The store's rest fields, mirrored, and *not* cleared when the store clears.
   *
   * The bar is still on screen for the length of its slide-out, so it needs
   * something to draw during it. Reading the store directly would blank the
   * row on the frame the timer stops and leave an empty bar sliding away. This
   * mirror keeps the final reading, and the slide is driven off `resting`
   * instead. The re-seed happens during render against the values it was last
   * seeded from, the same shape `rest-duration-sheet` uses: an effect would do
   * the same job a commit later, showing the stale number for a frame.
   */
  const [held, setHeld] = useState({ restEndsAt, restPausedSeconds, restTotalSeconds, restKind });

  if (
    resting &&
    (held.restEndsAt !== restEndsAt ||
      held.restPausedSeconds !== restPausedSeconds ||
      held.restTotalSeconds !== restTotalSeconds ||
      held.restKind !== restKind)
  ) {
    setHeld({ restEndsAt, restPausedSeconds, restTotalSeconds, restKind });
  }

  const rest = readRest(held, now);
  const frame = rest === null ? null : describeRest(rest, held.restKind, colors);

  const remaining = useRestProgress();

  // The line is drawn full-width and slid left by however much of the period has
  // gone, so its left edge stays put and its right edge is the clock hand. Slid
  // rather than scaled: `scaleX` grows from the centre, and correcting that needs
  // `transformOrigin`, which not every surface this runs on honours. A full-width
  // layer translated out to the left is the same animation with none of that risk.
  const [trackWidth, setTrackWidth] = useState(0);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(1 - remaining.value) * trackWidth }],
  }));

  /*
   * 0 docked, 1 parked below the screen. A shared value rather than a mounted or
   * unmounted subtree, so the bar can finish its exit with its last reading
   * still drawn, and on the UI thread, because the JS thread is busy with a
   * controlled text input every time the user types a weight while resting.
   */
  const parked = useSharedValue(1);

  /*
   * In on `content`, out on `press`, rather than `travel` both ways.
   *
   * `travel` is `inOut`, which is the curve for something crossing the screen
   * under a watched start and a watched finish. This is neither: arriving, the
   * bar is a consequence of the check the user just tapped, and an `inOut`
   * spends its first frames barely moving, which is exactly the window where
   * the eye is asking whether the tap registered. `out` starts at speed and
   * settles, so the bar is legibly present sooner without being any faster on
   * paper.
   *
   * Leaving, the reading is spent. The user has hit Skip, or the countdown has
   * run out and been dismissed, and the only thing 200ms of exit buys is 200ms
   * before the list underneath is reachable again. `press` is the shortest
   * duration in the file and the right one for a control clearing itself out
   * of the way.
   */
  useEffect(() => {
    parked.value = withTiming(resting ? 0 : 1, resting ? timing.content : timing.press);
  }, [parked, resting]);

  const lift = useKeyboardLift(insets.bottom);
  const travel = REST_BAR_HEIGHT + insets.bottom;

  const barStyle = useAnimatedStyle(() => {
    const gone = parked.value;

    // The lift is faded out with the bar rather than applied flat: at rest the
    // parked position is a full `travel` below the screen, and subtracting a
    // 300pt keyboard from that would slide an idle bar back into view on top of
    // the keyboard it was hiding from.
    return { transform: [{ translateY: gone * travel - (1 - gone) * lift.value }] };
  });

  return (
    <Animated.View
      style={[
        styles.bar,
        barStyle,
        {
          backgroundColor: colors.surfaceElevated,
          borderTopColor: colors.border,
          paddingBottom: spacing.sm + insets.bottom,
        },
      ]}
      onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
      // Idle, the bar is still mounted and still drawn. It is simply below the
      // fold. None of it may be touched or reached by a swipe of the screen
      // reader while it is down there.
      pointerEvents={resting ? 'auto' : 'none'}
      accessibilityElementsHidden={!resting}
      importantForAccessibility={resting ? 'auto' : 'no-hide-descendants'}
    >
      <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
        {frame !== null && trackWidth > 0 && (
          <Animated.View style={[styles.fill, fillStyle, { backgroundColor: frame.tone }]} />
        )}
      </View>

      {frame !== null && (
        <View style={styles.row}>
          <PressableScale
            onPress={() => controls.adjust(-ADJUST_SECONDS)}
            accessibilityRole="button"
            accessibilityLabel={`Subtract ${ADJUST_SECONDS} seconds`}
            fill={colors.surfaceMuted}
            fillPressed={colors.surfacePressed}
            scaleTo={PRESS_SCALE_SMALL}
            style={[styles.control, { backgroundColor: colors.surfaceMuted }]}
          >
            <Text variant="label" color="textSecondary">
              −{ADJUST_SECONDS}
            </Text>
          </PressableScale>

          {/*
            The expand target, and it is the readout rather than the whole bar.
            Wrapping everything in one pressable would mean `accessible={false}`
            on it to stop the row collapsing into a single element (see the
            sheets for what that looks like), which leaves the expand gesture
            with no accessible element of its own. This way it has a label and a
            hint, and it still spans the full height of the row and everything
            between the two adjusters: most of the bar, without claiming the
            edges around the controls.
          */}
          <PressableScale
            onPress={onExpand}
            disabled={onExpand === undefined}
            accessibilityRole="button"
            accessibilityState={{ disabled: onExpand === undefined }}
            accessibilityLabel={frame.readoutLabel}
            accessibilityHint="Opens the rest timer"
            scaleTo={1}
            dimTo={0.6}
            style={styles.readoutTap}
          >
            {/* Paused and complete are otherwise carried by the readout's colour
                alone, which is not a state anyone can read if the difference
                between amber and grey is not available to them. */}
            <Ionicons name={frame.icon} size={14} color={frame.tone} />

            {/*
              One of the two figures in the app that stays big, and it asks
              explicitly rather than inheriting it. `numericLarge` came down to
              20px when the stat surfaces stopped announcing themselves, and this
              is not a stat. It is a countdown read from wherever the phone was
              put down between sets, which is usually the floor. The other
              exception is the plate calculator, for the same reason and with the
              same explicitness. Tabular figures matter at this size too: a colon
              shifting every second is very hard to ignore.
            */}
            <Text
              variant="numericLarge"
              numberOfLines={1}
              // 32px of tabular figures, two controls and a Skip button all fit
              // across a 390pt phone with room to spare and do not across a
              // 320pt one. Shrinking the number is the only one of those four
              // that degrades gracefully. The alternative is "02:…", which is
              // the countdown failing at its one job.
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={[styles.readout, { color: frame.tone }]}
            >
              {frame.readout}
            </Text>
          </PressableScale>

          <PressableScale
            onPress={() => controls.adjust(ADJUST_SECONDS)}
            accessibilityRole="button"
            accessibilityLabel={`Add ${ADJUST_SECONDS} seconds`}
            fill={colors.surfaceMuted}
            fillPressed={colors.surfacePressed}
            scaleTo={PRESS_SCALE_SMALL}
            style={[styles.control, { backgroundColor: colors.surfaceMuted }]}
          >
            <Text variant="label" color="textSecondary">
              +{ADJUST_SECONDS}
            </Text>
          </PressableScale>

          {/*
            Filled but neutral, not accent. The readout beside it is already
            wearing the app's one saturated colour, and a lime Skip would be the
            loudest thing on a screen whose actual subject is the set list above
            it. It carries no hit slop either, deliberately: slop here would have
            to come out of the readout's tap area, and turning a near-miss on
            Skip into a *skipped rest* rather than an opened sheet is the wrong
            way round. Its 44 is real height instead.
          */}
          <Button
            title={frame.finished ? 'Dismiss' : 'Skip'}
            variant="secondary"
            size="sm"
            accessibilityLabel={frame.finished ? 'Dismiss rest timer' : 'Skip rest'}
            onPress={controls.stop}
            style={styles.skip}
          />
        </View>
      )}
    </Animated.View>
  );
}

/**
 * How far the bar has to rise to clear the software keyboard, on the UI thread.
 *
 * Android does not need this: `softwareKeyboardLayoutMode: "resize"` in app.json
 * shrinks the window when the keyboard opens, so anything pinned to the bottom
 * of it comes along for free. iOS does not resize, and the bar would sit behind
 * the keyboard at exactly the moment the countdown matters most. The user is
 * typing the next set's weight while resting.
 *
 * Reanimated ships `useAnimatedKeyboard`, which reads the keyboard on the UI
 * thread and would be the obvious answer, but on Android it calls
 * `setDecorFitsSystemWindows(false)` and takes over the window's insets for as
 * long as it is subscribed, which is precisely the resize behaviour this app
 * relies on, switched off app-wide by a hook mounted for the benefit of the
 * other platform. Two `Keyboard` listeners that are only ever registered on iOS
 * cannot do that. They cost one JS event per keyboard transition, at a moment
 * when a focus change is re-rendering anyway; the movement itself still runs on
 * the UI thread.
 */
function useKeyboardLift(bottomInset: number) {
  const lift = useSharedValue(0);
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const settle = (overlap: number, eventDuration: number) => {
      // The keyboard covers the home-indicator inset, so the bar's own bottom
      // padding is already accounted for in the overlap: lifting by the full
      // keyboard height would leave a gap the width of that inset above it.
      lift.value = withTiming(Math.max(0, overlap - bottomInset), {
        // UIKit hands us the duration of its own animation, so the bar travels
        // with the keyboard rather than chasing it. Zero shows up for keyboards
        // that appear without animating (a hardware keyboard connecting), and
        // the token is the fallback for those.
        duration: eventDuration > 0 ? eventDuration : duration.base,
        easing: easing.inOut,
        reduceMotion: ReduceMotion.System,
      });
    };

    const changed = Keyboard.addListener('keyboardWillChangeFrame', (event) =>
      settle(windowHeight - event.endCoordinates.screenY, event.duration),
    );
    // `keyboardWillChangeFrame` already reports the dismissal, but the
    // interactive drag-to-dismiss the workout screen enables does not always
    // end in one. Both handlers settle on the same target, so the overlap
    // between them is a no-op rather than a fight.
    const hidden = Keyboard.addListener('keyboardWillHide', (event) => settle(0, event.duration));

    return () => {
      changed.remove();
      hidden.remove();
    };
  }, [bottomInset, lift, windowHeight]);

  return lift;
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: stroke.rule,
  },
  /** Flush against the top edge, so it reads as the bar's own boundary. */
  track: {
    height: TRACK_HEIGHT,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  row: {
    height: ROW_HEIGHT,
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  control: {
    width: MIN_TOUCH_SIZE,
    height: MIN_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  readoutTap: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  readout: { fontSize: fontSize.xxxl, letterSpacing: -0.6 },
  /**
   * `size="sm"` for the label and the padding, overridden back to a full touch
   * target in height. The small size exists for controls inside an
   * already-tappable row, and this row is not one.
   */
  skip: { height: MIN_TOUCH_SIZE, borderRadius: radius.md },
});
