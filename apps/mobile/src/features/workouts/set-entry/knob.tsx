import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale, Text } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { PRESS_SCALE_SMALL, radius, useColors } from '@/theme';

import { formatEntry, stepFrom, type EntryField } from './values';

const SIZE = 236;
const C = SIZE / 2;
const FACE = 176;
/** Degrees of turn per step. A full turn is 30 plates of weight, or 15 reps. */
const DETENT: Record<EntryField, number> = { weight: 12, reps: 24 };
/** Near the hub the angle is noise; a finger there turns nothing. */
const DEAD_ZONE = 22;

interface KnobProps {
  field: EntryField;
  unitLabel: string;
  value: number;
  step: number;
  max: number;
  onDetent: (value: number) => void;
  onSettle: (value: number) => void;
}

const TICKS = Array.from({ length: 60 }, (_, k) => k);
const KNURLS = Array.from({ length: 40 }, (_, k) => k);

/**
 * A rotary knob with detents. Clockwise adds.
 *
 * The finger's angle around the centre is accumulated on the UI thread, and
 * every `DETENT` degrees is one step. The face follows the finger with a little
 * give past the last detent and springs back onto it on release, which is
 * what makes it read as a clicky hardware knob rather than a slider bent into a
 * circle.
 */
export const Knob = memo(function Knob({
  field,
  unitLabel,
  value,
  step,
  max,
  onDetent,
  onSettle,
}: KnobProps) {
  const colors = useColors();
  const detentDeg = DETENT[field];

  // Steps turned this drag, and the leftover angle past the last one.
  const turned = useSharedValue(0);
  const acc = useSharedValue(0);
  const prev = useSharedValue(0);
  const give = useSharedValue(0);
  const base = useSharedValue(value);
  const from = useSharedValue(value);

  const handlers = useRef({ onDetent, onSettle, value });
  useEffect(() => {
    handlers.current = { onDetent, onSettle, value };
  });

  // The value the drag started from, and what it has reached.
  const start = useRef(value);
  const current = useRef(value);

  const begin = useCallback(() => {
    start.current = handlers.current.value;
    current.current = handlers.current.value;
  }, []);
  const moveTo = useCallback(
    (steps: number) => {
      const next = stepFrom(start.current, steps, step, max);
      if (next === current.current) return;
      current.current = next;
      haptics.selection();
      handlers.current.onDetent(next);
    },
    [step, max],
  );
  const end = useCallback(() => {
    handlers.current.onSettle(current.current);
  }, []);

  useEffect(() => {
    base.value = value;
  }, [base, value]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(1)
        .onBegin((event) => {
          prev.value = Math.atan2(event.y - C, event.x - C);
          acc.value = 0;
          turned.value = 0;
          from.value = base.value;
          runOnJS(begin)();
        })
        .onChange((event) => {
          const dx = event.x - C;
          const dy = event.y - C;
          const angle = Math.atan2(dy, dx);
          let delta = ((angle - prev.value) * 180) / Math.PI;
          prev.value = angle;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          if (Math.hypot(dx, dy) < DEAD_ZONE) return;

          acc.value += delta;
          let steps = turned.value;
          while (acc.value >= detentDeg) {
            acc.value -= detentDeg;
            steps += 1;
          }
          while (acc.value <= -detentDeg) {
            acc.value += detentDeg;
            steps -= 1;
          }
          // Stops at either end of the range instead of winding up.
          const reach = from.value + steps * step;
          if (reach < 0 || reach > max) {
            steps = turned.value;
            acc.value = 0;
          }
          if (steps !== turned.value) {
            turned.value = steps;
            runOnJS(moveTo)(steps);
          }
          give.value = acc.value * 0.45;
        })
        .onFinalize(() => {
          give.value = withTiming(0, { duration: 180 });
          runOnJS(end)();
        }),
    [acc, prev, turned, give, base, from, detentDeg, step, max, begin, moveTo, end],
  );

  const faceStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(base.value / step) * detentDeg + give.value}deg` }],
  }));

  const nudge = (dir: 1 | -1) => {
    const next = stepFrom(value, dir, step, max);
    if (next === value) return;
    haptics.selection();
    onDetent(next);
    onSettle(next);
  };

  return (
    <View style={styles.row}>
      {renderNudge('−', `Less ${unitLabel}`, () => nudge(-1), colors)}

      <GestureDetector gesture={gesture}>
        <View
          collapsable={false}
          style={styles.knob}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={unitLabel}
          accessibilityValue={{ text: `${formatEntry(field, value)} ${unitLabel}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) =>
            nudge(event.nativeEvent.actionName === 'increment' ? 1 : -1)
          }
        >
          {TICKS.map((k) => (
            <View
              key={k}
              pointerEvents="none"
              style={[
                styles.tick,
                {
                  height: k % 5 === 0 ? 12 : 7,
                  backgroundColor: k % 5 === 0 ? colors.textTertiary : colors.borderStrong,
                  transform: [{ rotate: `${k * 6}deg` }, { translateY: -(C - 10) }],
                },
              ]}
            />
          ))}

          <Animated.View
            pointerEvents="none"
            style={[
              styles.face,
              { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
              faceStyle,
            ]}
          >
            {KNURLS.map((k) => (
              <View
                key={k}
                style={[
                  styles.knurl,
                  {
                    backgroundColor: colors.surfacePressed,
                    transform: [{ rotate: `${k * 9}deg` }, { translateY: -(FACE / 2 - 7) }],
                  },
                ]}
              />
            ))}
            <View style={[styles.indicator, { backgroundColor: colors.accent }]} />
          </Animated.View>

          <View
            pointerEvents="none"
            style={[styles.hub, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text variant="display" style={styles.value}>
              {formatEntry(field, value)}
            </Text>
            <Text variant="overline" color="textTertiary">
              {unitLabel}
            </Text>
          </View>
        </View>
      </GestureDetector>

      {renderNudge('+', `More ${unitLabel}`, () => nudge(1), colors)}
    </View>
  );
});

/** A call rather than a component: see `renderStepperButton` in `set-row.tsx`. */
function renderNudge(
  glyph: string,
  label: string,
  onPress: () => void,
  colors: ReturnType<typeof useColors>,
) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      fill={colors.surfaceMuted}
      fillPressed={colors.surfacePressed}
      scaleTo={PRESS_SCALE_SMALL}
      style={styles.nudge}
    >
      <Text variant="subheading">{glyph}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  knob: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  tick: { position: 'absolute', width: 2, borderRadius: 1 },
  face: {
    position: 'absolute',
    width: FACE,
    height: FACE,
    borderRadius: FACE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knurl: { position: 'absolute', width: 2, height: 8, borderRadius: 1 },
  // Between the hub's edge (64) and the knurling (77 out): centred at 70.
  indicator: {
    position: 'absolute',
    top: 14,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hub: {
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: { fontSize: 34, lineHeight: 40, fontVariant: ['tabular-nums'] },
  nudge: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
