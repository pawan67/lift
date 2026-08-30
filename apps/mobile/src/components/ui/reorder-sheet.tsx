import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  type PanGesture,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { controlHeight, radius, spacing, stroke, timing, useColors } from '@/theme';
import { haptics } from '@/features/feedback/haptics';

import { Button } from './button';
import { useSheetLayout } from './sheet-layout';
import { Text } from './text';

export interface ReorderItem {
  id: string;
  label: string;
  /** Second line: set count, target, whatever names the row without the drag. */
  detail?: string;
  /** Leading glyph, e.g. a folder. */
  icon?: keyof typeof Ionicons.glyphMap;
  /**
   * A section header: dragging it carries every following item until the next
   * group or locked row. Children stay independently draggable.
   */
  group?: boolean;
  /** Not draggable. The "Other routines" heading between folders and unfiled. */
  locked?: boolean;
}

export interface ReorderSheetProps {
  visible: boolean;
  /** Heads the sheet: "Reorder exercises". */
  title: string;
  /** In their current order. */
  items: ReorderItem[];
  onClose: () => void;
  /** Called once, on Done, with the ids in the order they were left in. */
  onCommit: (orderedIds: string[]) => void;
}

/** One row, and the pitch the drag maths counts in. */
const ROW_HEIGHT = controlHeight.lg;
const ROW_GAP = spacing.xs;
const ROW_PITCH = ROW_HEIGHT + ROW_GAP;

/** How much of the screen the list may take before it scrolls. */
const MAX_LIST_FRACTION = 0.55;

/** Lift on the row under the finger. Small. It is a card, not a balloon. */
const DRAG_SCALE = 1.03;

type ReorderMeta = {
  spans: number[];
  isGroup: number[];
  sticky: number[];
  locked: number;
  starts: number[];
};

const EMPTY_META: ReorderMeta = { spans: [], isGroup: [], sticky: [], locked: -1, starts: [] };

/**
 * Drag-to-reorder, on a surface built for it.
 *
 * The lists this reorders: exercises in a session, exercises in a routine,
 * routines on the Workout tab.
 * Are not draggable where they live. Each entry there is a block a few hundred
 * points tall containing text fields and swipe-to-delete rows: a vertical pan
 * on one of those has to be told apart from a scroll, from a swipe, and from a
 * caret drag inside a weight field, and the block being moved is usually taller
 * than the screen it is being moved across. Reordering by dragging *names*
 * instead makes every row the same known height, leaves nothing else on the
 * surface competing for the gesture, and shows the whole list at once, which
 * is the thing you actually need to see to know where a block should go.
 *
 * The Workout tab passes an outline: folder rows (`group`) carry their children
 * when dragged, routine rows move alone and land in whichever section they
 * drop into, and a locked "Other routines" heading marks the unfiled pile.
 * Session and routine editors still pass a flat list, and that path is unchanged.
 *
 * The order is applied on Done rather than per drop. A drag is a rehearsal
 * until then: reordering a live session rewrites rows that a running query is
 * reading, and doing that on every crossing while a finger is still down means
 * the list can renumber under the drag.
 */
export function ReorderSheet({ visible, title, items, onClose, onCommit }: ReorderSheetProps) {
  const colors = useColors();
  const sheetLayout = useSheetLayout();
  const { height } = useWindowDimensions();

  const [order, setOrder] = useState<ReorderItem[]>(items);

  // Re-seeded whenever the sheet opens, or the list behind it changes while it
  // is closed. Adjusted during render against what it was last seeded from, the
  // same shape `PromptModal` and the rest timer bar use. An effect would paint
  // the previous session's exercises for a frame first.
  const [seed, setSeed] = useState({ visible, items });

  if (seed.visible !== visible || seed.items !== items) {
    setSeed({ visible, items });
    if (visible) setOrder(items);
  }

  // -1 when nothing is being dragged. Both are read on the UI thread by every
  // row's style, so they are shared values rather than state: a 60fps drag
  // cannot be a React render per frame while a live query is also running.
  const activeIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const meta = useSharedValue<ReorderMeta>(EMPTY_META);

  /*
   * Whether a finger is currently on a handle, in JS rather than on the UI
   * thread, because the only thing that reads it is a `ScrollView` prop.
   *
   * The handle sits inside a scrollable and a vertical pan is precisely what a
   * scrollable is for, so the two compete for the drag. RNGH's own answer to
   * that is `blocksExternalGesture(ref)`, which cannot be used here: it wants
   * the ref read while the gesture is built, the gestures are built during
   * render, and the React Compiler (on for this app) refuses a ref read
   * during render. Turning the scroll off for the length of the drag settles
   * the same argument with a prop.
   */
  const [dragging, setDragging] = useState(false);

  const count = order.length;
  meta.value = {
    spans: order.map((_, index) => spanOf(order, index)),
    isGroup: order.map((item) => (item.group ? 1 : 0)),
    sticky: order.map((item) => (item.group || item.locked ? 1 : 0)),
    locked: order.findIndex((item) => item.locked),
    starts: order.flatMap((item, index) => (item.group ? [index] : [])),
  };

  const move = (from: number, to: number) => {
    if (from === to) return;
    setOrder((current) => {
      const item = current[from];
      if (!item || item.locked) return current;
      if (item.group) return moveGroup(current, from, to);
      return moveRow(current, from, to);
    });
  };

  /*
   * Built here rather than inside the row, because the two shared values are
   * written here.
   *
   * A row that received them as props and assigned to `.value` is a component
   * mutating its own props as far as the React Compiler is concerned, and this
   * app compiles with it on (`experiments.reactCompiler` in `app.json`), so
   * that is a lint error, and the rule is right about the general case even
   * though a shared value is mutable by design. Rows still *read* both, which
   * is what `useAnimatedStyle` needs and what the rule permits.
   */
  const dragGesture = (index: number, grouped: boolean) =>
    Gesture.Pan()
      .onStart(() => {
        activeIndex.value = index;
        dragY.value = 0;
        runOnJS(setDragging)(true);
        runOnJS(haptics.selection)();
      })
      .onUpdate((event) => {
        dragY.value = event.translationY;
      })
      .onEnd(() => {
        const raw = landing(index, dragY.value, count);
        const to = grouped ? snapGroupStart(raw, meta.value.starts) : raw;
        if (to !== index) runOnJS(move)(index, to);
      })
      // Runs after `onEnd`, and also on the paths that have no `onEnd` at all.
      // A call arriving, the sheet being dismissed mid-drag. Clearing here
      // rather than there means a cancelled gesture puts the row back instead
      // of committing wherever the finger happened to be. Not animated back to
      // zero: on a real drop the row is about to re-render at its new index,
      // and easing the old offset out would show it sliding from a position it
      // has already left.
      .onFinalize(() => {
        activeIndex.value = -1;
        dragY.value = 0;
        runOnJS(setDragging)(false);
      });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/*
        A second root view, inside the modal, and the drag does not work without
        it.

        `GestureHandlerRootView` is not a context provider with a native view
        attached: on Android it *is* the native view, and it installs the touch
        recogniser that feeds every handler beneath it. A React Native `Modal`
        mounts its children into a separate native window, so the app's root view
        in `app/_layout.tsx` is nowhere above this content in the native tree and
        never sees the touches.

        Nothing says so at runtime. `GestureDetector` checks for the root view
        through React context, and React context passes through a `Modal` quite
        happily, so the check is satisfied while the thing it is checking for is
        absent: no warning, no error, and a pan that silently never activates.
        That is what this looked like in Expo Go.

        Every other gesture in the app (the swipe-to-delete on a set row) sits
        in the ordinary tree under the root view, which is why this is the first
        place it has come up.
      */}
      <GestureHandlerRootView style={styles.flex}>
        {/*
          Backdrop and sheet are siblings. The sheet used to sit *inside* the
          dismiss Pressable, which is the wrapper that made a long list
          unscrollable: Pressable wins the vertical pan, ScrollView never
          moves, and rows past the cap are clipped with no way to reach them.
          The fill Pressable still dismisses a tap on the dimmed area; the
          sheet is painted after it, so a tap on the list is the list's.
        */}
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }, sheetLayout.backdrop]}>
          <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
          <View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surfaceElevated,
                paddingBottom: spacing.lg + sheetLayout.bottomInset,
              },
              sheetLayout.sheet,
            ]}
          >
          <Text variant="overline" color="textTertiary" accessibilityRole="header">
            {title}
          </Text>

          {/* The list scrolls past its cap, and the drag deliberately does not
              auto-scroll with it: a finger that reaches the edge stops there.
              Ten exercises is a long session and fits without scrolling on any
              phone this runs on, so the case is rare, and the accessibility
              actions below move a row any distance regardless. */}
          <ScrollView
            scrollEnabled={!dragging}
            nestedScrollEnabled
            style={[styles.listViewport, { maxHeight: height * MAX_LIST_FRACTION }]}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator
          >
            {order.map((item, index) => (
              <Row
                key={item.id}
                item={item}
                index={index}
                count={count}
                activeIndex={activeIndex}
                dragY={dragY}
                meta={meta}
                gesture={item.locked ? undefined : dragGesture(index, Boolean(item.group))}
                onMove={move}
              />
            ))}
          </ScrollView>

            <View style={styles.actions}>
              <Button title="Cancel" variant="ghost" onPress={onClose} style={styles.action} />
              <Button
                title="Done"
                onPress={() => onCommit(order.map((item) => item.id))}
                style={styles.action}
              />
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

interface RowProps {
  item: ReorderItem;
  index: number;
  count: number;
  /** Read-only here. Only `ReorderSheet` writes them: see `dragGesture`. */
  activeIndex: SharedValue<number>;
  dragY: SharedValue<number>;
  meta: SharedValue<ReorderMeta>;
  gesture?: PanGesture;
  onMove: (from: number, to: number) => void;
}

function Row({ item, index, count, activeIndex, dragY, meta, gesture, onMove }: RowProps) {
  const colors = useColors();
  const accent = colors.accent;
  const accentSurface = colors.accentSurface;
  const border = colors.border;
  const surfaceMuted = colors.surfaceMuted;

  const animatedStyle = useAnimatedStyle(() => {
    const active = activeIndex.value;

    // Nothing moving: every row sits where its index says.
    if (active === -1) return { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0 };

    const span = meta.value.spans[active] ?? 1;
    const grouped = meta.value.isGroup[active] === 1;
    const inBlock = grouped && index >= active && index < active + span;

    // The dragged row follows the finger exactly, and rides above the rest.
    // A folder's children travel with it.
    if (active === index || inBlock) {
      return {
        transform: [{ translateY: dragY.value }, { scale: active === index ? DRAG_SCALE : 1 }],
        zIndex: 1,
      };
    }

    if (grouped) {
      const to = snapGroupStart(landing(active, dragY.value, count), meta.value.starts);
      const destSpan = meta.value.spans[to] ?? 1;
      const shift =
        active < to && index >= active + span && index < to + destSpan
          ? -span * ROW_PITCH
          : to < active && index >= to && index < active
            ? span * ROW_PITCH
            : 0;

      return {
        transform: [{ translateY: withTiming(shift, timing.state) }, { scale: 1 }],
        zIndex: 0,
      };
    }

    // Folder headers stay put while a routine is dragged. Shuffling them up
    // over the row is what made "drop into this folder" feel like you had to
    // drag *above* it. The header is the section; the routine slides under it.
    if (meta.value.sticky[index] === 1) {
      return { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0 };
    }

    const to = landing(active, dragY.value, count);
    const starts = meta.value.starts;
    const lockedAt = meta.value.locked;
    const source = owningGroup(active, starts, lockedAt);
    const dest = owningGroup(to, starts, lockedAt);
    const rowOwner = owningGroup(index, starts, lockedAt);

    let shift = 0;
    if (source === dest) {
      // Same pile: the usual one-row step, but only among siblings. Crossing
      // a folder header is not a slot, and shuffling dest children into the
      // next header is what hid them behind it.
      if (rowOwner === source) {
        shift =
          active < index && index <= to
            ? -ROW_PITCH
            : to <= index && index < active
              ? ROW_PITCH
              : 0;
      }
    } else if (rowOwner === source && index > active) {
      // Left this pile: close the hole. Do not move the destination's
      // routines — the folder below them is sitting still.
      shift = -ROW_PITCH;
    }

    return {
      transform: [{ translateY: withTiming(shift, timing.state) }, { scale: 1 }],
      zIndex: 0,
    };
  });

  const fillStyle = useAnimatedStyle(() => {
    const lockedRow = item.locked;
    if (lockedRow) return { backgroundColor: 'transparent', borderColor: 'transparent' };

    const rest = { backgroundColor: surfaceMuted, borderColor: border };
    const active = activeIndex.value;
    if (active === -1 || !item.group || meta.value.isGroup[active] === 1) return rest;

    const hover = landing(active, dragY.value, count);
    const source = owningGroup(active, meta.value.starts, meta.value.locked);
    const dest = owningGroup(hover, meta.value.starts, meta.value.locked);
    if (dest !== index || dest === source) return rest;

    return { backgroundColor: accentSurface, borderColor: accent };
  });

  const locked = Boolean(item.locked);

  return (
    <Animated.View style={animatedStyle}>
      <Animated.View
        style={[
          styles.row,
          fillStyle,
        ]}
        // One element per row for the screen reader, carrying both lines and the
        // two actions below. The label alone is what a swipe lands on, and the
        // drag it describes is not something a screen reader can perform.
        accessible
        accessibilityLabel={
          `${index + 1} of ${count}. ${item.label}${item.detail ? `. ${item.detail}` : ''}`
        }
        accessibilityActions={locked ? undefined : ACTIONS}
        onAccessibilityAction={
          locked
            ? undefined
            : (event) => {
                if (event.nativeEvent.actionName === 'moveUp' && index > 0) onMove(index, index - 1);
                if (event.nativeEvent.actionName === 'moveDown' && index < count - 1) {
                  onMove(index, index + 1);
                }
              }
        }
      >
        {item.icon ? <Ionicons name={item.icon} size={18} color={colors.accent} /> : null}
        <View style={styles.rowText}>
          <Text
            variant={locked ? 'overline' : 'bodyMedium'}
            color={locked ? 'textTertiary' : 'text'}
            numberOfLines={1}
          >
            {item.label}
          </Text>
          {item.detail ? (
            <Text variant="caption" color="textTertiary" numberOfLines={1}>
              {item.detail}
            </Text>
          ) : null}
        </View>

        {/* The gesture hangs off the handle rather than the whole row, so the
            list underneath can still be scrolled by dragging anywhere else. */}
        {gesture ? (
          <GestureDetector gesture={gesture}>
            <View style={styles.handle}>
              <Ionicons name="reorder-three" size={22} color={colors.textTertiary} />
            </View>
          </GestureDetector>
        ) : (
          <View style={styles.handle} />
        )}
      </Animated.View>
    </Animated.View>
  );
}

function spanOf(items: ReorderItem[], index: number): number {
  const item = items[index];
  if (!item?.group) return 1;
  let n = 1;
  for (let i = index + 1; i < items.length; i++) {
    const next = items[i];
    if (!next || next.group || next.locked) break;
    n += 1;
  }
  return n;
}

function moveGroup(items: ReorderItem[], from: number, dest: number): ReorderItem[] {
  if (!items[dest]?.group) return items;
  if (from === dest) return items;
  const span = spanOf(items, from);
  const destSpan = spanOf(items, dest);
  const block = items.slice(from, from + span);
  const rest = [...items.slice(0, from), ...items.slice(from + span)];
  const insertAt = dest < from ? dest : dest - span + destSpan;
  return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
}

function moveRow(items: ReorderItem[], from: number, to: number): ReorderItem[] {
  const moved = items[from];
  if (!moved || moved.group || moved.locked) return items;

  // A folder header is a section, not a slot. Hovering it (or the unfiled
  // heading) drops the routine *under* it, into that pile. The folder above
  // the insert is then the owner, which is what "drag out of one and into
  // another" has to mean.
  let insertBefore = to;
  if (items[to]?.group || items[to]?.locked) {
    insertBefore = to + 1;
  }

  const target = items[insertBefore];
  if (target?.id === moved.id) return items;

  const next = items.filter((_, index) => index !== from);
  const insertAt = target ? next.findIndex((row) => row.id === target.id) : next.length;
  if (insertAt < 0) return items;
  next.splice(insertAt, 0, moved);
  return next;
}

/**
 * The folder (or unfiled heading) that owns `hover`.
 *
 * A header under the finger is itself the owner. Otherwise it is the nearest
 * header above, which is the pile the row would join if dropped there.
 */
function owningGroup(hover: number, starts: number[], locked: number): number {
  'worklet';
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] === hover) return hover;
  }
  if (locked >= 0 && hover === locked) return -1;

  let owner = -1;
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    if (start <= hover) owner = start;
    else break;
  }
  if (locked >= 0 && locked <= hover && locked > owner) return -1;
  return owner;
}

/**
 * Which index a drag of `offset` from `from` would land on.
 *
 * Rounding rather than flooring: a row is taken to have crossed its neighbour
 * once it has travelled *half* a row past it, which is where the neighbour
 * visibly steps aside. Shared by the dragged row and by every row deciding
 * whether to move out of its way, so the two can never disagree about what is
 * happening.
 */
function landing(from: number, offset: number, count: number): number {
  'worklet';
  const target = from + Math.round(offset / ROW_PITCH);
  return Math.min(count - 1, Math.max(0, target));
}

function snapGroupStart(rawTo: number, starts: number[]): number {
  'worklet';
  if (starts.length === 0) return rawTo;
  let best = starts[0]!;
  let bestDist = Math.abs(rawTo - best);
  for (let i = 1; i < starts.length; i++) {
    const start = starts[i]!;
    const dist = Math.abs(rawTo - start);
    if (dist < bestDist) {
      best = start;
      bestDist = dist;
    }
  }
  return best;
}

const ACTIONS = [
  { name: 'moveUp', label: 'Move up' },
  { name: 'moveDown', label: 'Move down' },
];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  list: { gap: ROW_GAP, paddingVertical: spacing.xs },
  listViewport: { flexGrow: 0, flexShrink: 1 },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    borderRadius: radius.md,
    borderWidth: stroke.outline,
  },
  rowText: { flex: 1 },
  // The handle is the target, so it is a full-height column rather than a glyph
  // with slop: slop on a row this dense would reach into its neighbours.
  handle: {
    width: controlHeight.md,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
});
