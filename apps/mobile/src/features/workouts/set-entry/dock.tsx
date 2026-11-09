import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { ReduceMotion, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, PressableScale, Text } from '@/components/ui';
import type { SetEntryMode } from '@/store/settings';
import { PRESS_SCALE_SMALL, radius, spacing, stroke, useColors } from '@/theme';

import { Knob } from './knob';
import { Ruler } from './ruler';
import { useSetEntry, type Carry, type EntryTarget } from './store';
import { formatEntry, majorEvery, maxFor, stepFor, type EntryField } from './values';
import { Wheel } from './wheel';

interface DockProps {
  target: EntryTarget;
  mode: Exclude<SetEntryMode, 'scrub'>;
}

interface Draft {
  setId: string;
  /** The source values this draft was last reconciled with. */
  srcWeight: number;
  srcReps: number;
  weight: number;
  reps: number;
  /** What this panel last wrote, so its own echo is not taken as an edit. */
  sentWeight: number | null;
  sentReps: number | null;
}

const sourceOf = (target: EntryTarget) => ({
  weight: target.weight ?? target.ghostWeight ?? 0,
  reps: target.reps ?? target.ghostReps ?? 0,
});

/**
 * Where the dials start on a set: what it holds, else the set just logged
 * before it in the same exercise, else last session's number. The middle one
 * is what makes most sets one nudge or none: the next set is usually the last
 * one again.
 */
const startOf = (target: EntryTarget, carry: Carry | null) => {
  const from = carry && carry.groupId === target.groupId ? carry : null;
  return {
    weight: target.weight ?? from?.weight ?? target.ghostWeight ?? 0,
    reps: target.reps ?? from?.reps ?? target.ghostReps ?? 0,
  };
};

/**
 * The panel docked over the bottom of the workout screen in knob, ruler and
 * wheels mode.
 *
 * A plain absolutely-positioned view, never a `Modal` or a sheet: drags inside
 * an RN `Modal` do not register on Android here (see `components/ui/time-picker`),
 * and a gorhom sheet's own pan would fight the dial's.
 *
 * The dials move a local draft and write once they come to rest. Log flushes
 * whatever is still in the draft, checks the set off through the row's own
 * handler, and hands the panel to the next open set.
 */
export function SetEntryDock({ target, mode }: DockProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const dockHeight = useSetEntry((state) => state.dockHeight);
  const carry = useSetEntry((state) => state.carry);

  const unit = target.weightUnit;
  const unitLabel = unit;
  const source = sourceOf(target);

  const fresh = (): Draft => ({
    setId: target.setId,
    srcWeight: source.weight,
    srcReps: source.reps,
    ...startOf(target, carry),
    sentWeight: null,
    sentReps: null,
  });
  const [draft, setDraft] = useState<Draft>(fresh);

  if (draft.setId !== target.setId) {
    setDraft(fresh());
  } else if (draft.srcWeight !== source.weight || draft.srcReps !== source.reps) {
    // Per field: a field whose stored value did not move keeps what the dial
    // shows, and so does one whose new value is our own write coming back.
    // Only a number that arrived from somewhere else ("Same as last", a copy
    // from the Previous column) replaces it.
    const take = (src: number, was: number, sent: number | null, shown: number) =>
      src !== was && src !== sent ? src : shown;
    setDraft({
      ...draft,
      srcWeight: source.weight,
      srcReps: source.reps,
      weight: take(source.weight, draft.srcWeight, draft.sentWeight, draft.weight),
      reps: take(source.reps, draft.srcReps, draft.sentReps, draft.reps),
    });
  }

  const field: EntryField = !target.hasWeight ? 'reps' : !target.hasReps ? 'weight' : target.field;

  // Lift the row being edited clear of the panel.
  useEffect(() => {
    if (dockHeight <= 0) return;
    target.measure((y, height) => {
      const over = y + height + spacing.md - (windowHeight - dockHeight);
      if (over > 0) useSetEntry.getState().scrollBy?.(over);
    });
    // When the panel moves to another set or changes size, and when the set's
    // numbers land: a first weight on a session raises the warm-up card and
    // the plate line above the table, which pushes the row down by a card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.setId, target.weight, target.reps, dockHeight, windowHeight]);

  const preview = (f: EntryField, value: number) =>
    setDraft((d) => (f === 'weight' ? { ...d, weight: value } : { ...d, reps: value }));

  const write = (f: EntryField, value: number) => {
    const stored = f === 'weight' ? target.weight : target.reps;
    preview(f, value);
    if (value === stored) return;
    setDraft((d) => (f === 'weight' ? { ...d, sentWeight: value } : { ...d, sentReps: value }));
    target.commit(f === 'weight' ? { weight: value } : { reps: value });
  };

  const close = () => useSetEntry.getState().close();

  const log = () => {
    if (target.hasWeight && draft.weight !== source.weight) write('weight', draft.weight);
    if (target.hasReps && draft.reps !== source.reps) write('reps', draft.reps);
    if (target.isCompleted) {
      close();
      return;
    }
    target.log();
    useSetEntry.getState().beginAdvance({
      groupId: target.groupId,
      weight: draft.weight,
      reps: draft.reps,
    });
  };

  const hasGhost = target.ghostWeight != null || target.ghostReps != null;
  const sameAsLast = () => {
    if (target.hasWeight && target.ghostWeight != null) write('weight', target.ghostWeight);
    if (target.hasReps && target.ghostReps != null) write('reps', target.ghostReps);
  };

  const summary = [
    target.hasWeight ? formatEntry('weight', draft.weight) : null,
    target.hasReps ? formatEntry('reps', draft.reps) : null,
  ]
    .filter(Boolean)
    .join(' × ');

  const lastTime = [
    target.hasWeight && target.ghostWeight != null ? `${formatEntry('weight', target.ghostWeight)} ${unitLabel}` : null,
    target.hasReps && target.ghostReps != null ? `${target.ghostReps}` : null,
  ]
    .filter(Boolean)
    .join(' × ');

  const dial = (f: EntryField) => ({
    field: f,
    value: f === 'weight' ? draft.weight : draft.reps,
    step: stepFor(f, unit),
    max: maxFor(f, unit),
    onDetent: (value: number) => preview(f, value),
    onSettle: (value: number) => write(f, value),
  });

  const touch = (f: EntryField) => () => useSetEntry.getState().setField(f);

  return (
    <Animated.View
      entering={SlideInDown.duration(260).reduceMotion(ReduceMotion.System)}
      exiting={SlideOutDown.duration(200).reduceMotion(ReduceMotion.System)}
      onLayout={(event) => useSetEntry.getState().setDockHeight(event.nativeEvent.layout.height)}
      style={[
        styles.dock,
        {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          paddingBottom: insets.bottom + spacing.lg,
        },
      ]}
    >
      <View style={styles.head}>
        <View style={styles.title}>
          <Text variant="bodyMedium">{target.setName}</Text>
          {lastTime !== '' && (
            <Text variant="caption" color="textTertiary">
              {`Last time ${lastTime}`}
            </Text>
          )}
        </View>
        <Pressable
          onPress={close}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close the dial"
          style={[styles.close, { backgroundColor: colors.surfaceMuted }]}
        >
          <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {mode === 'knob' && (
        <View style={styles.knobBody}>
          {target.hasWeight && target.hasReps && (
            <View style={styles.tabs}>
              {(['weight', 'reps'] as const).map((f) => {
                const on = f === field;
                return (
                  <Pressable
                    key={f}
                    onPress={touch(f)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    style={[
                      styles.tab,
                      {
                        backgroundColor: on ? colors.accentSurface : colors.surfaceMuted,
                        borderColor: on ? colors.accent : colors.surfaceMuted,
                      },
                    ]}
                  >
                    <Text variant="overline" color={on ? 'accent' : 'textTertiary'}>
                      {f === 'weight' ? `Weight · ${unitLabel}` : 'Reps'}
                    </Text>
                    <Text variant="numeric" color={on ? 'accent' : 'text'}>
                      {formatEntry(f, f === 'weight' ? draft.weight : draft.reps)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          <Knob key={`${target.setId}:${field}`} {...dial(field)} unitLabel={field === 'weight' ? unitLabel : 'reps'} />
        </View>
      )}

      {mode === 'ruler' && (
        <View style={styles.rulers}>
          {target.hasWeight && (
            <Ruler
              key={`${target.setId}:weight`}
              {...dial('weight')}
              label="Weight"
              unitLabel={unitLabel}
              major={majorEvery('weight')}
              active={field === 'weight'}
              onTouch={touch('weight')}
            />
          )}
          {target.hasReps && (
            <Ruler
              key={`${target.setId}:reps`}
              {...dial('reps')}
              label="Reps"
              unitLabel="reps"
              major={majorEvery('reps')}
              active={field === 'reps'}
              onTouch={touch('reps')}
            />
          )}
        </View>
      )}

      {mode === 'wheels' && (
        <View style={styles.wheels}>
          {target.hasWeight && (
            <Wheel
              key={`${target.setId}:weight`}
              {...dial('weight')}
              label={`Weight · ${unitLabel}`}
              active={field === 'weight'}
              onTouch={touch('weight')}
            />
          )}
          {target.hasReps && (
            <Wheel key={`${target.setId}:reps`} {...dial('reps')} label="Reps" active={field === 'reps'} onTouch={touch('reps')} />
          )}
        </View>
      )}

      <View style={styles.foot}>
        <PressableScale
          onPress={() => {
            target.type(field);
            close();
          }}
          accessibilityRole="button"
          accessibilityLabel="Type a value instead"
          fill={colors.surfaceMuted}
          fillPressed={colors.surfacePressed}
          scaleTo={PRESS_SCALE_SMALL}
          style={styles.keypad}
        >
          <Ionicons name="keypad-outline" size={20} color={colors.textSecondary} />
        </PressableScale>
        {hasGhost && (
          <Button title="Same as last" variant="secondary" size="lg" onPress={sameAsLast} />
        )}
        <Button
          title={target.isCompleted ? 'Done' : `Log ${summary}`}
          accessibilityLabel={target.isCompleted ? 'Done' : `Log ${target.setName}, ${summary}`}
          icon={target.isCompleted ? undefined : 'checkmark'}
          variant="success"
          size="lg"
          onPress={log}
          style={styles.log}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: stroke.outline,
    gap: spacing.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1 },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knobBody: { gap: spacing.sm },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: {
    flex: 1,
    height: 52,
    borderRadius: radius.lg,
    borderWidth: stroke.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rulers: { gap: spacing.md },
  wheels: { flexDirection: 'row', gap: spacing.sm },
  foot: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  keypad: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  log: { flex: 1 },
});
