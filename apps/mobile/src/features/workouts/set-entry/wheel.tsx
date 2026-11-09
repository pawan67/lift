import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { font, radius, spacing, stroke, useColors } from '@/theme';

import { useDetentScroller } from './use-detent-scroller';
import { formatEntry, type EntryField } from './values';

const ITEM = 44;
const HEIGHT = ITEM * 5;
const RADIUS = HEIGHT / 2;
/** Items either side of the band that are mounted. */
const WINDOW = 6;

interface WheelProps {
  field: EntryField;
  label: string;
  value: number;
  step: number;
  max: number;
  active: boolean;
  onTouch: () => void;
  onDetent: (value: number) => void;
  onSettle: (value: number) => void;
}

/**
 * One drum of the picker: the iOS time-picker control, on the UI thread.
 *
 * Each label sits on a cylinder: its offset is the sine of its angle, which
 * makes a step move exactly one row under the finger at the band and fold
 * away towards the edges, where it also shrinks and fades.
 */
export const Wheel = memo(function Wheel({
  field,
  label,
  value,
  step,
  max,
  active,
  onTouch,
  onDetent,
  onSettle,
}: WheelProps) {
  const colors = useColors();
  const scroller = useDetentScroller({
    axis: 'y',
    px: ITEM,
    value,
    step,
    max,
    onDetent: (next) => {
      haptics.selection();
      onDetent(next);
    },
    onSettle,
  });

  const center = Math.round(value / step);
  const hi = Math.floor(max / step + 1e-9);
  const items: number[] = [];
  for (let k = Math.max(0, center - WINDOW); k <= Math.min(hi, center + WINDOW); k++) items.push(k);

  return (
    <View style={styles.column} onTouchStart={onTouch}>
      <Text variant="overline" color={active ? 'accent' : 'textTertiary'} align="center">
        {label}
      </Text>
      <GestureDetector gesture={scroller.gesture}>
        <View
          collapsable={false}
          style={styles.drum}
          onLayout={(event) => scroller.setLength(event.nativeEvent.layout.height)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: formatEntry(field, value) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            const dir = event.nativeEvent.actionName === 'increment' ? 1 : -1;
            const next = Math.min(max, Math.max(0, value + dir * step));
            onDetent(next);
            onSettle(next);
          }}
        >
          <View
            pointerEvents="none"
            style={[
              styles.band,
              {
                backgroundColor: active ? colors.accentSurface : colors.surfaceMuted,
                borderColor: active ? colors.accent : colors.surfaceMuted,
              },
            ]}
          />
          {items.map((k) => (
            <WheelItem
              key={k}
              index={k}
              pos={scroller.pos}
              text={formatEntry(field, k * step)}
              color={k === center ? (active ? colors.accent : colors.text) : colors.textTertiary}
            />
          ))}
        </View>
      </GestureDetector>
    </View>
  );
});

const WheelItem = memo(function WheelItem({
  index,
  pos,
  text,
  color,
}: {
  index: number;
  pos: SharedValue<number>;
  text: string;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const angle = ((index - pos.value) * ITEM) / RADIUS;
    if (Math.abs(angle) > 1.5) return { opacity: 0 };
    const cos = Math.cos(angle);
    return {
      opacity: Math.min(1, Math.max(0, cos * 1.15 - 0.15)),
      transform: [{ translateY: RADIUS * Math.sin(angle) }, { scale: 0.7 + 0.3 * cos }],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[styles.item, style]}>
      <Animated.Text style={[styles.itemText, { color }]}>{text}</Animated.Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  column: { flex: 1, gap: spacing.xs },
  drum: { height: HEIGHT, overflow: 'hidden' },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: HEIGHT / 2 - 26,
    height: 52,
    borderRadius: radius.lg,
    borderWidth: stroke.outline,
  },
  item: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: HEIGHT / 2 - ITEM / 2,
    height: ITEM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: { fontSize: 26, ...font('bold'), fontVariant: ['tabular-nums'] },
});
