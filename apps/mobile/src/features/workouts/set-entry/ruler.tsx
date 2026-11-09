import { LinearGradient } from 'expo-linear-gradient';
import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { radius, spacing, translucent, useColors } from '@/theme';

import { useDetentScroller } from './use-detent-scroller';
import { formatEntry, type EntryField } from './values';

interface RulerProps {
  field: EntryField;
  label: string;
  unitLabel: string;
  value: number;
  step: number;
  max: number;
  /** Labelled mark every this many steps. */
  major: number;
  active: boolean;
  onTouch: () => void;
  onDetent: (value: number) => void;
  onSettle: (value: number) => void;
}

const HEIGHT = 64;
/** Marks either side of the marker that are actually mounted. */
const WINDOW = 36;

/**
 * A horizontal tape under a fixed marker: the scale-app control.
 *
 * Only the marks near the current value are mounted, re-centred on each
 * detent, so a 500 kg tape is seventy-odd views rather than two hundred. The
 * strip they sit in is moved by one transform on the UI thread, which is the
 * whole cost of a frame.
 */
export const Ruler = memo(function Ruler({
  field,
  label,
  unitLabel,
  value,
  step,
  max,
  major,
  active,
  onTouch,
  onDetent,
  onSettle,
}: RulerProps) {
  const colors = useColors();
  const px = field === 'reps' ? 30 : 14;
  const [width, setWidth] = useState(0);

  const scroller = useDetentScroller({
    axis: 'x',
    px,
    value,
    step,
    max,
    onDetent: (next) => {
      haptics.selection();
      onDetent(next);
    },
    onSettle,
  });

  const stripStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: width / 2 - scroller.pos.value * px }],
  }));

  const center = Math.round(value / step);
  const hi = Math.floor(max / step + 1e-9);
  const marks: number[] = [];
  for (let k = Math.max(0, center - WINDOW); k <= Math.min(hi, center + WINDOW); k++) marks.push(k);

  return (
    <View style={styles.block} onTouchStart={onTouch}>
      <View style={styles.head}>
        <Text variant="overline" color={active ? 'accent' : 'textTertiary'}>
          {label}
        </Text>
        <Text variant="numericLarge" color={active ? 'accent' : 'text'}>
          {formatEntry(field, value)}
          <Text variant="label" color="textTertiary">
            {` ${unitLabel}`}
          </Text>
        </Text>
      </View>

      <GestureDetector gesture={scroller.gesture}>
        <View
          collapsable={false}
          onLayout={(event) => {
            setWidth(event.nativeEvent.layout.width);
            scroller.setLength(event.nativeEvent.layout.width);
          }}
          style={[styles.track, { backgroundColor: colors.surfaceMuted }]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: `${formatEntry(field, value)} ${unitLabel}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            const dir = event.nativeEvent.actionName === 'increment' ? 1 : -1;
            const next = Math.min(max, Math.max(0, value + dir * step));
            onDetent(next);
            onSettle(next);
          }}
        >
          <Animated.View style={[styles.strip, stripStyle]}>
            {marks.map((k) => {
              const isMajor = k % major === 0;
              const isMid = !isMajor && major % 2 === 0 && k % (major / 2) === 0;
              return (
                <View key={k} style={[styles.mark, { left: k * px - 1 }]}>
                  {isMajor && (
                    <Text variant="caption" color="textTertiary" style={styles.markLabel}>
                      {formatEntry(field, k * step)}
                    </Text>
                  )}
                  <View
                    style={{
                      width: 2,
                      height: isMajor ? 24 : isMid ? 16 : 10,
                      borderRadius: 1,
                      backgroundColor: isMajor ? colors.textSecondary : colors.borderStrong,
                    }}
                  />
                </View>
              );
            })}
          </Animated.View>

          <LinearGradient
            pointerEvents="none"
            colors={[colors.surfaceMuted, translucent(colors.surfaceMuted, 0)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.fade, { left: 0 }]}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[translucent(colors.surfaceMuted, 0), colors.surfaceMuted]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.fade, { right: 0 }]}
          />
          <View
            pointerEvents="none"
            style={[styles.marker, { left: width / 2 - 1.5, backgroundColor: colors.accent }]}
          />
        </View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  block: { gap: spacing.xs },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  track: { height: HEIGHT, borderRadius: radius.lg, overflow: 'hidden' },
  strip: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 1 },
  mark: {
    position: 'absolute',
    bottom: 10,
    width: 2,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  markLabel: { position: 'absolute', bottom: 30, left: -23, width: 48, textAlign: 'center' },
  fade: { position: 'absolute', top: 0, bottom: 0, width: 64 },
  marker: { position: 'absolute', top: 10, bottom: 8, width: 3, borderRadius: 1.5 },
});
