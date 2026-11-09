import { useId, useState } from 'react';
import { Keyboard, Platform, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { NumericField, type NumericFieldProps } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';

import { useSetEntry } from './store';
import { formatEntry, stepFrom, type EntryField } from './values';

export interface ScrubFieldProps extends NumericFieldProps {
  field: EntryField;
  /** What the set holds, in the display unit. Null when the box is empty. */
  numeric: number | null;
  /** Where a scrub on an empty box starts: last session's number. */
  seed: number | null;
  step: number;
  max: number;
  unitLabel: string;
  /** Called once, when the finger lifts, with a value that differs. */
  onCommit: (value: number) => void;
}

/** Points of drag per step at a slow, deliberate pace. */
const PX: Record<EntryField, number> = { weight: 16, reps: 26 };

/**
 * Speed-sensitive gain: a slow drag is one step per `PX`, a flick covers a
 * plate rack. `speed` is in points per millisecond.
 */
function gainFor(speed: number): number {
  'worklet';
  if (!Number.isFinite(speed) || speed < 0.35) return 1;
  return Math.min(6, 1 + (speed - 0.35) * 4);
}

/**
 * On the web the drag is followed by window pointer events once it starts.
 * RNGH declines pointer capture on an `<input>`, so its own pan stops hearing
 * the pointer the moment it leaves the 62pt cell, which is before a single
 * rep's worth of travel. Native touches are tracked outside the view anyway.
 */
const FOLLOW_WINDOW = Platform.OS === 'web';

interface Scrub {
  /** What the field shows instead of storage while scrubbing. */
  text: string;
  active: boolean;
  /** Storage's text when the scrub began; a change means the write is back. */
  base: string;
}

/**
 * A numeric field that is also its own dial.
 *
 * Drag it sideways and it steps: one step per `PX` at a slow pace, up to six
 * times that on a fast swipe, with a selection tick on each. A tap never
 * becomes a drag (`activeOffsetX` needs eight points of travel first), so it
 * still lands in the text field and raises the keyboard. A vertical move fails
 * the drag at twelve points and the list scrolls as before.
 *
 * Nothing is written while the finger is down. The field shows the scrubbed
 * value from local state and the write goes out once, on release, so a sweep
 * from 60 to 100 kg is one row update rather than sixteen.
 *
 * No refs anywhere a worklet can reach, which is what the React Compiler asks
 * of a gesture built during render: the worklet hands the JS side everything
 * it needs (the start value, the steps, where the cell is on screen) as
 * arguments instead.
 */
export function ScrubField({
  field,
  numeric,
  seed,
  step,
  max,
  unitLabel,
  onCommit,
  value,
  ...rest
}: ScrubFieldProps) {
  const [scrub, setScrub] = useState<Scrub | null>(null);
  const [width, setWidth] = useState(0);

  // The write has echoed back: storage is the truth again.
  if (scrub && !scrub.active && value !== scrub.base) setScrub(null);

  const startValue = numeric ?? seed ?? 0;
  const px = PX[field];
  const acc = useSharedValue(0);
  const last = useSharedValue(0);

  const bubble = (start: number, next: number, x: number, y: number) => {
    const delta = next - start;
    useSetEntry.getState().setBubble({
      x,
      y,
      text: `${formatEntry(field, next)} ${unitLabel}`,
      detail:
        delta === 0
          ? 'Drag to change'
          : `${delta > 0 ? '+' : '−'}${formatEntry(field, Math.abs(delta))} from ${formatEntry(field, start)}`,
    });
  };

  /*
   * The scrub's own state lives in the store rather than in the worklet, and
   * `end` reads its value from there. Two reasons. The release is the one
   * moment the value must be exact, and a worklet's last-seen step can trail
   * the JS side by an event. And on the web, RNGH declines pointer capture on
   * an `<input>`, so a release off the field never reaches the gesture: a
   * window-level pointer-up ends the scrub there, and the `key` check makes
   * sure whichever of the two arrives second does nothing.
   */
  const key = useId();

  const end = () => {
    const store = useSetEntry.getState();
    const session = store.scrub;
    if (!session || session.key !== key) return;
    store.setScrub(null);
    store.setBubble(null);
    if (session.value === numeric) {
      setScrub(null);
      return;
    }
    setScrub((current) => current && { ...current, active: false });
    onCommit(session.value);
    // A write that never echoes must not pin the field to a stale figure.
    setTimeout(() => setScrub((current) => (current && !current.active ? null : current)), 2000);
  };

  const moveTo = (steps: number, left: number, top: number) => {
    const store = useSetEntry.getState();
    const session = store.scrub;
    if (!session || session.key !== key) return;
    const next = stepFrom(session.start, steps, step, max);
    if (next === session.value) return;
    store.setScrub({ ...session, value: next });
    haptics.selection();
    setScrub((current) => current && { ...current, text: formatEntry(field, next) });
    bubble(session.start, next, left + width / 2, top);
  };

  const followWindow = (start: number, left: number, top: number) => {
    const lo = (-start / step - 1) * px;
    const hi = ((max - start) / step + 1) * px;
    let lastX: number | null = null;
    let lastT = 0;
    let travelled = 0;
    const move = (event: PointerEvent) => {
      if (lastX !== null) {
        const dx = event.clientX - lastX;
        const speed = Math.abs(dx) / Math.max(1, event.timeStamp - lastT);
        travelled = Math.min(hi, Math.max(lo, travelled + dx * gainFor(speed)));
        moveTo(Math.trunc(travelled / px), left, top);
      }
      lastX = event.clientX;
      lastT = event.timeStamp;
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      end();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const begin = (start: number, left: number, top: number) => {
    // A field being typed in gives way to the drag.
    Keyboard.dismiss();
    haptics.selection();
    useSetEntry.getState().setScrub({ key, start, value: start });
    setScrub({ text: formatEntry(field, start), active: true, base: value });
    bubble(start, start, left + width / 2, top);
    if (FOLLOW_WINDOW) followWindow(start, left, top);
  };

  const gesture = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onStart((event) => {
      acc.value = 0;
      last.value = 0;
      runOnJS(begin)(startValue, event.absoluteX - event.x, event.absoluteY - event.y);
    })
    .onChange((event) => {
      if (FOLLOW_WINDOW) return;
      const gain = gainFor(Math.abs(event.velocityX) / 1000);
      const lo = (-startValue / step - 1) * px;
      const hi = ((max - startValue) / step + 1) * px;
      acc.value = Math.min(hi, Math.max(lo, acc.value + event.changeX * gain));
      const steps = Math.trunc(acc.value / px);
      if (steps !== last.value) {
        last.value = steps;
        runOnJS(moveTo)(steps, event.absoluteX - event.x, event.absoluteY - event.y);
      }
    })
    .onFinalize(() => {
      runOnJS(end)();
    });

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <NumericField
          value={scrub ? scrub.text : value}
          accessibilityHint="Drag sideways to change it, or double-tap to type"
          {...rest}
        />
      </View>
    </GestureDetector>
  );
}
