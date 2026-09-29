/**
 * Breakpoints, and how wide a screen is allowed to draw.
 *
 * This app was designed at 390pt and every margin in it assumes that. Opened in
 * a browser on a 27-inch monitor the same styles still "work" in the sense that
 * nothing overlaps, and the result is unusable: a list row 2,000pt wide with its
 * title at the far left and its chevron at the far right, a two-column stat band
 * whose columns are half a metre apart, body copy running at 250 characters a
 * line. None of that is a bug in any one screen. It is the absence of an upper
 * bound.
 *
 * So there are two mechanisms here and they do different jobs:
 *
 *   - `useLayoutSize` answers *what kind of device is this*, and screens use it
 *     to change structure: one column or two, bottom bar or side rail.
 *   - `contentWidth` answers *how wide may this be*, and is a cap rather than a
 *     size. Below the cap everything behaves exactly as it does today.
 *
 * Both are driven by `useWindowDimensions`, not by `Platform.OS === 'web'`.
 * Width is the thing that actually matters, and a phone browser at 390pt should
 * get the phone layout while a foldable at 900pt should get the wide one. The
 * one place the platform is consulted is `usePointer`, below, because that is a
 * genuine input-method question rather than a size question.
 */

import { useMemo } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

/**
 * Where the layout changes shape. Content-driven rather than device-driven.
 *
 * `medium` is 840 because that is where the side rail stops costing more than
 * it gives: the rail is 248 and the narrowest useful content column is 560,
 * which with a gutter either side is 840 exactly. Below it the rail would be
 * eating width the content needs, so the bottom bar stays.
 *
 * `expanded` is 1180 because that is where a second column becomes real rather
 * than nominal. Minus the rail that leaves 932 of content, so two columns land
 * near 450 each: wide enough for a chart with a value axis. Splitting earlier
 * produces two columns too narrow to hold what was in one.
 *
 * Deliberately not 768/1024. Those are iPad dimensions, and this app's own
 * numbers do not happen to break there.
 */
export const breakpoint = {
  medium: 840,
  expanded: 1180,
} as const;

/**
 * `compact` is every phone and the layout this app was built as. `medium` swaps
 * the bottom bar for a side rail and caps the content column. `expanded` adds
 * the option of a second column to the screens that have something to put in
 * one.
 */
export type LayoutSize = 'compact' | 'medium' | 'expanded';

/**
 * The caps a screen can choose between, by what it holds rather than by number.
 *
 * These are maximums. A screen asking for `board` on a 900pt window gets 900pt,
 * not a horizontal scrollbar.
 *
 * `form` is for a screen that is one task: signing in, naming a routine,
 * saving a workout. A single column of fields at 720 looks abandoned; the
 * fields stretch and the eye has to travel from a label on the left to a value
 * on the right for no reason.
 *
 * `column` is the default and covers everything that is a list or a detail
 * view. 720 holds the app's `bodyMedium` at roughly 90 characters, which is
 * past the 65–75 prose ideal and correctly so: almost nothing here is prose.
 * These are rows: a title, a subtitle of three stats, a chevron. The number
 * that actually sets it is the row, and past about 720 a row starts reading as
 * two separate things pinned to opposite edges.
 *
 * `board` is for the screens that are genuinely multiple things at once: the
 * dashboard, the stats index. It is the only cap that earns a second column.
 */
export const contentWidth = {
  form: 560,
  column: 720,
  board: 1040,
} as const;

export type ContentWidth = keyof typeof contentWidth | 'full';

/** How wide the desktop navigation rail draws. See `SideRail`. */
export const RAIL_WIDTH = 248;

/**
 * The current layout size.
 *
 * `useWindowDimensions` re-renders on resize, which on native fires on rotation
 * and on web fires as the user drags the window edge. That is the behaviour we
 * want and the reason this is a hook rather than a module constant read once.
 * A constant would be captured at the size the tab was opened at and never
 * update, which is the classic way a "responsive" React Native web app ends up
 * responding only to a reload.
 */
export function useLayoutSize(): LayoutSize {
  const { width } = useWindowDimensions();

  if (width >= breakpoint.expanded) return 'expanded';
  if (width >= breakpoint.medium) return 'medium';
  return 'compact';
}

export interface Layout {
  size: LayoutSize;
  /** Phone-shaped. The layout every screen in this app was drawn for. */
  isCompact: boolean;
  /** At least `medium`: there is room for a side rail. */
  isWide: boolean;
  /** At least `expanded`: there is room for two columns. */
  isExpanded: boolean;
  width: number;
  height: number;
}

/**
 * Size, the two questions screens actually ask, and the raw dimensions.
 *
 * `isWide` rather than `isMedium` because no screen wants "medium and not
 * expanded". The question is always "is there room for the rail" or "is there
 * room for two columns", and those are thresholds, not bands. Naming them as
 * thresholds is what stops call sites writing `size !== 'compact'` and getting
 * it subtly wrong somewhere.
 */
export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const size = useLayoutSize();

  return useMemo(
    () => ({
      size,
      isCompact: size === 'compact',
      isWide: size !== 'compact',
      isExpanded: size === 'expanded',
      width,
      height,
    }),
    [size, width, height],
  );
}

/**
 * How wide a screen's content column actually is, in points.
 *
 * For the handful of components that have to be *given* a width rather than
 * filling one: `BodyMap`, and every chart in the app, which draw into an SVG and
 * so need a number rather than a flex rule.
 *
 * Those screens all used to read `useWindowDimensions().width` and subtract
 * their own padding, which was correct while the content was the window. It
 * stopped being true the moment a rail appeared beside it and a cap was put on
 * it: on a 1440pt monitor that arithmetic returns roughly 1400 for a chart
 * sitting in a 720pt column, so the chart is drawn at twice the width of the
 * card it is in and clipped by it.
 *
 * This mirrors what `Screen` does with the same `width` prop, so the two cannot
 * disagree: pass the same value here as the screen passes there. A screen that
 * leaves `Screen`'s default alone leaves this one alone too.
 *
 * Still the window on a phone, to the pixel, so nothing about the mobile layout
 * moves.
 */
export function useContentWidth(kind: ContentWidth = 'column'): number {
  const { width, isWide } = useLayout();

  // The pane beside the rail is what a screen is actually laid out in.
  const available = isWide ? width - RAIL_WIDTH : width;

  if (!isWide || kind === 'full') return available;
  return Math.min(available, contentWidth[kind]);
}

/**
 * The empty band either side of a capped column, in points. Zero on a phone.
 *
 * For chrome that spans the whole pane but has to line up with the column
 * inside it: the tab headers. Their title is drawn by the navigator 16pt in
 * from the pane's edge, and on a 1440pt monitor the column that title heads
 * starts some 240pt further in, so the page's name floats over nothing while
 * its content sits in the middle. Adding this to the header's own margins puts
 * the title over the column's first line and the header action over its last.
 */
export function useColumnGutter(kind: ContentWidth = 'column'): number {
  const { width, isWide } = useLayout();
  const column = useContentWidth(kind);

  if (!isWide) return 0;
  return Math.max(0, (width - RAIL_WIDTH - column) / 2);
}

/**
 * Whether this session is driven by a pointer that can hover.
 *
 * The one genuine platform question in this file. Hover is not a width
 * property: a touchscreen laptop is wide and cannot hover, a phone browser is
 * narrow and cannot either, and both must never be given an affordance that
 * only appears under a cursor.
 *
 * Answered by capability rather than by user agent. `matchMedia('(hover: hover)')`
 * is what the browser itself uses to decide, it updates when a mouse is plugged
 * into a tablet, and it needs no list of devices to maintain. Native is `false`
 * unconditionally. React Native's `Pressable` does surface `onHoverIn` there,
 * but only ever fires it under a trackpad on iPadOS, and this app is portrait
 * phone-first everywhere off the web.
 *
 * Read once at module load rather than subscribed to. A user who attaches a
 * mouse mid-session gets hover states on the next reload, which is a fair
 * trade against every pressable in a set list holding a media-query listener.
 */
export const canHover: boolean =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover)').matches;
