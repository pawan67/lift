import { useEffect, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withDecay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { tidy } from './values';

interface DetentScrollerParams {
  axis: 'x' | 'y';
  /** Points the content travels per step. */
  px: number;
  value: number;
  step: number;
  max: number;
  /** The value under the marker moved by a whole step. */
  onDetent: (value: number) => void;
  /** The control came to rest. Write here, not on every detent. */
  onSettle: (value: number) => void;
}

export interface DetentScroller {
  gesture: ReturnType<typeof Gesture.Exclusive>;
  /** Fractional step index under the marker. */
  pos: SharedValue<number>;
  /** How many points the control is along its axis, for tap targeting. */
  setLength: (length: number) => void;
}

/**
 * Drag, fling and land on a step, on the UI thread.
 *
 * Shared by the ruler and the wheels, which are the same physics on two axes.
 * The position is a step index rather than points, so a fling decays in
 * steps, the snap lands on one, and a detent is a change in `round(pos)`.
 * React hears about it only per detent (for the read-out and the tick) and
 * once at rest (for the write), never per frame.
 *
 * Built the way `reorder-sheet` builds its drag, and for the same reason: the
 * React Compiler freezes a shared value once an effect has touched it, so the
 * one value an effect writes (`external`, the prop) is never written anywhere
 * else, and everything the gesture moves is moved only inside worklets.
 */
export function useDetentScroller({
  axis,
  px,
  value,
  step,
  max,
  onDetent,
  onSettle,
}: DetentScrollerParams): DetentScroller {
  const hi = Math.floor(max / step + 1e-9);
  const pos = useSharedValue(value / step);
  const live = useSharedValue(false);
  /** The index this control last reported, so its own echo is not a reset. */
  const own = useSharedValue(value / step);
  /** The `value` prop, as an index. Written by the effect below and nowhere else. */
  const external = useSharedValue(value / step);
  const [length, setLength] = useState(0);

  useEffect(() => {
    external.value = value / step;
  }, [external, value, step]);

  const detent = (index: number) => onDetent(tidy(index * step));
  const settle = (index: number) => onSettle(tidy(index * step));

  const snapTo = (target: number) => {
    'worklet';
    const index = Math.min(hi, Math.max(0, target));
    pos.value = withTiming(index, { duration: 170, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (!finished) return;
      live.value = false;
      own.value = index;
      runOnJS(settle)(index);
    });
  };

  const pan = Gesture.Pan()
    .minDistance(2)
    .onBegin(() => {
      // A finger on a moving tape stops it, like a hand on a spinning wheel.
      cancelAnimation(pos);
      live.value = true;
    })
    .onChange((event) => {
      const delta = axis === 'x' ? event.changeX : event.changeY;
      let next = pos.value - delta / px;
      // Rubber-band past either end rather than a hard wall.
      if (next < 0) next = next * 0.35;
      if (next > hi) next = hi + (next - hi) * 0.35;
      pos.value = next;
    })
    .onEnd((event) => {
      const velocity = -(axis === 'x' ? event.velocityX : event.velocityY) / px;
      if (Math.abs(velocity) < 2 || pos.value < 0 || pos.value > hi) {
        snapTo(Math.round(pos.value));
        return;
      }
      pos.value = withDecay({ velocity, deceleration: 0.996, clamp: [0, hi] }, (finished) => {
        if (finished) snapTo(Math.round(pos.value));
      });
    })
    .onFinalize((_event, success) => {
      // Touched and released without a drag: settle where it stopped.
      if (!success) snapTo(Math.round(pos.value));
    });

  // A tap on a mark steps straight to it.
  const tap = Gesture.Tap().onEnd((event) => {
    const offset = (axis === 'x' ? event.x : event.y) - length / 2;
    live.value = true;
    snapTo(Math.round(pos.value + offset / px));
  });

  // The gesture is declared before the reactions on purpose: the compiler
  // rejects a shared-value write that comes after the value was handed to a
  // hook, and the reactions are hooks.
  // One reaction for both directions, since `own` may only be written in one.
  useAnimatedReaction(
    () => ({ ext: external.value, index: Math.min(hi, Math.max(0, Math.round(pos.value))) }),
    (current, previous) => {
      if (previous === null) return;
      // Somebody else moved the number ("Same as last", another set): jump to
      // it. Our own detent coming back as the prop is not somebody else.
      if (current.ext !== previous.ext && Math.abs(current.ext - own.value) > 1e-6) {
        cancelAnimation(pos);
        live.value = false;
        own.value = current.ext;
        pos.value = current.ext;
        return;
      }
      if (current.index !== previous.index && live.value) {
        own.value = current.index;
        runOnJS(detent)(current.index);
      }
    },
  );

  return { gesture: Gesture.Exclusive(pan, tap), pos, setLength };
}
