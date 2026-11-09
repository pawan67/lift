import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { useSettings } from '@/store/settings';
import { radius, spacing, stroke, useColors } from '@/theme';

import { SetEntryDock } from './dock';
import { useSetEntry } from './store';

const BUBBLE_WIDTH = 156;
/** Clear of the finger on the cell, with the cell's top edge as the anchor. */
const BUBBLE_LIFT = 86;

/**
 * Mounted once per screen that shows set rows, over everything else on it.
 *
 * Holds the two things a row cannot draw inside itself: the docked dial
 * panel, and the bubble that floats above a cell while it is scrubbed (the
 * row's swipeable clips anything that leaves its bounds, and a finger covers
 * the cell itself). It takes no touches outside the panel.
 */
export function SetEntryHost() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const mode = useSettings((state) => state.setEntryMode);
  const target = useSetEntry((state) => state.target);
  const bubble = useSetEntry((state) => state.bubble);

  const hostRef = useRef<View>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  // Leaving the screen, or switching to scrub mode, puts the panel away.
  useEffect(() => () => useSetEntry.getState().close(), []);
  useEffect(() => {
    if (mode === 'scrub') useSetEntry.getState().close();
  }, [mode]);

  return (
    <View
      ref={hostRef}
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={() => hostRef.current?.measureInWindow((x, y) => setOrigin({ x, y }))}
    >
      {bubble && (
        <Animated.View
          pointerEvents="none"
          entering={FadeIn.duration(90).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(90).reduceMotion(ReduceMotion.System)}
          style={[
            styles.bubble,
            {
              left: Math.min(
                width - BUBBLE_WIDTH - spacing.sm,
                Math.max(spacing.sm, bubble.x - origin.x - BUBBLE_WIDTH / 2),
              ),
              top: bubble.y - origin.y - BUBBLE_LIFT,
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.borderStrong,
            },
          ]}
        >
          <Text variant="numericLarge" color="accent" align="center">
            {bubble.text}
          </Text>
          <Text variant="caption" color="textTertiary" align="center">
            {bubble.detail}
          </Text>
        </Animated.View>
      )}

      {target && mode !== 'scrub' && <SetEntryDock target={target} mode={mode} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    width: BUBBLE_WIDTH,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: stroke.outline,
    gap: 2,
  },
});
