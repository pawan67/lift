import { useCallback, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { BarChart as GiftedBarChart, type barDataItem } from 'react-native-gifted-charts';

import { Text } from '@/components/ui';
import { spacing, useColors } from '@/theme';

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  data: BarDatum[];
  formatValue?: (value: number) => string;
}

/**
 * Corner radius on a bar. `ColumnChart` holds the same number for the same
 * reasons, and the two are meant to match.
 *
 * Rounded, but well short of a cap. These bars used to take `radius.pill`,
 * which on a 10px bar is a semicircular end 5px deep, against a `MIN_FILL`
 * floor of about the same: the least-worked body part came out as a dot rather
 * than as a short bar, and every bar's tip tapered away from the edge the eye
 * measures it against. At 3 the end keeps a flat middle, so a bar still reads
 * as reaching a length.
 *
 * Below the `radius` scale's smallest step on purpose. That scale is for
 * surfaces the finger touches, and it starts at 6 because a 6px corner is what
 * reads as deliberate on a card. A bar is a measurement rather than a surface,
 * and 6 is most of a thin one's width.
 */
const BAR_RADIUS = 3;

/** Thickness of a horizontal bar, and the pitch of one row around it. */
const BAR_THICKNESS = 10;
const ROW_GAP = spacing.lg;
const ROW_HEIGHT = BAR_THICKNESS + ROW_GAP;

/** The left-hand label column in the horizontal layout, and its gutter. */
const LABEL_COLUMN = 88;
const LABEL_GAP = spacing.sm;

/** The formatted value printed past the end of each horizontal bar. */
const VALUE_COLUMN = 56;
const VALUE_GAP = spacing.sm;

/**
 * The strip the library draws an axis label into: one line at the 18px it
 * hard-codes per line. Stated here rather than left implicit so the space this
 * component reserves and the space the library actually uses cannot drift
 * apart.
 */
const LABEL_STRIP = 18;
/** The 6px the library leaves between the baseline and that strip. */
const LABEL_GUTTER = 6;

/**
 * Floor for a bar's fill, as a fraction of the plot.
 *
 * A body part with one logged set is not the same as one with none, and at true
 * proportion against a 40-set peak it would round away to nothing.
 */
const MIN_FILL = 0.02;

/**
 * How much room the library leaves below the baseline for axis labels before it
 * starts clipping them, and how far past the plot's maximum it leaves for top
 * labels. Both are extended by props (`labelsExtraHeight`, `yAxisExtraHeight`)
 * because the label column and the trailing value are wider than the default.
 */
const LIBRARY_LABEL_ALLOWANCE = 60;
const LABEL_BAND = LABEL_COLUMN + LABEL_GAP + spacing.xs;
const LABEL_HEADROOM = Math.max(0, LABEL_BAND - LIBRARY_LABEL_ALLOWANCE);
const VALUE_HEADROOM = VALUE_GAP + VALUE_COLUMN;

/**
 * Where gifted-charts lands a horizontal chart inside its own layout box.
 *
 * A horizontal `BarChart` is the vertical one rotated 90°, and the library
 * corrects for the rotation with a fixed offset folded into that transform.
 * These two numbers are that offset: the distance from the top-left of the
 * chart's layout box to the origin of the first bar, and `shiftX`/`shiftY`,
 * the library's own escape hatch, then move the origin to where this component
 * wants it. They describe the library rather than the design, so they are the
 * first thing to re-measure if an upgrade moves the chart bodily.
 */
const ROTATED_ORIGIN_X = 65;
const ROTATED_ORIGIN_Y = 27;

/**
 * The label box is positioned in the pre-rotation frame but drawn in the
 * post-rotation one, so its width and height swap roles: the library centres a
 * `labelWidth`-wide box on the bar, and after the rotation that centring is off
 * by half the difference between the label column and the bar's thickness.
 * `LABEL_RECENTRE` takes it back; `LABEL_DISTANCE` then pushes the whole column
 * clear of the bars.
 */
const LABEL_WIDTH = LABEL_COLUMN - ROW_GAP;
const LABEL_RECENTRE = (LABEL_WIDTH - BAR_THICKNESS) / 2;
const LABEL_DISTANCE = LABEL_COLUMN / 2 - (LABEL_GUTTER + LABEL_STRIP / 2) + LABEL_GAP;

/** x of the bars' origin: everything left of it belongs to the label column. */
const PLOT_INSET = LABEL_COLUMN + LABEL_GAP;
const SHIFT_X = PLOT_INSET - ROTATED_ORIGIN_X - LABEL_HEADROOM + VALUE_HEADROOM / 2;
const SHIFT_Y = (ROW_HEIGHT - BAR_THICKNESS) / 2 - ROTATED_ORIGIN_Y - VALUE_HEADROOM / 2;

/**
 * Proportional horizontal bar chart: a named row, a bar, and its figure.
 *
 * The counterpart to `ColumnChart`, and the split between them is what each is
 * for rather than which way the bars point. This one ranks a handful of named
 * things against each other (sets by body part, a session's split) and prints
 * every figure, so it needs no axis at all. `ColumnChart` plots a series over
 * time, where the names are dates, there are too many to print, and the reading
 * has to come off an axis. This component drew both for a while, and the
 * vertical half went unused the moment Home's weekly run moved to the other
 * one: a chart of weeks wants a tappable column and a rounded ceiling, which
 * are `ColumnChart`'s whole subject.
 *
 * Underneath it is gifted-charts' `BarChart` in its own `horizontal` mode,
 * which is the vertical chart rotated a quarter turn, and every offset above
 * exists to undo one consequence of that rotation. Nothing here draws a
 * rectangle by hand.
 *
 * Bars are proportional to the largest value in the set rather than to a
 * rounded ceiling: this reads as "which body part got the work", not "how many
 * sets exactly", and a nice axis maximum would leave the peak bar short of the
 * end for no reason the user can see.
 */
export function BarChart({ data, formatValue = (value) => String(Math.round(value)) }: BarChartProps) {
  const colors = useColors();

  // The call site hands us no width, and the plot needs one: it has to know
  // what is left after the label column and the trailing figure.
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  const max = data.reduce((peak, item) => Math.max(peak, item.value), 0);

  if (data.length === 0 || max === 0) {
    return (
      <View style={styles.empty}>
        <Text variant="label" color="textTertiary">
          No data yet
        </Text>
      </View>
    );
  }

  /**
   * One flat fill per bar, and a datum's own colour overrides the accent.
   *
   * Bars used to fade towards the canvas along their length. A gradient on a
   * proportional bar is a second encoding of the same quantity laid over the
   * first, and a worse one: the far end of a long bar reads as *less* than its
   * base, so a muscle with the most sets ended up with the faintest tip on the
   * chart. Length already says everything this chart has to say.
   */
  // `textSecondary` rather than the accent, and a step quieter than the other
  // charts' default: a bar chart here is always several bars, so the default is
  // the weight the *rest* take while a caller marks its leading one. See
  // `bodyPartColor` in `features/analytics/tones.ts`.
  const paint = (item: BarDatum) => ({ frontColor: item.color ?? colors.textSecondary });

  const plotLength = width - PLOT_INSET - VALUE_HEADROOM;
  const bars: barDataItem[] = data.map((item) => ({
    ...paint(item),
    value: item.value,
    // The library's own axis label is a bare `Text` in whatever the platform
    // font happens to be, so both slots are handed a component instead.
    labelComponent: () => (
      <View style={styles.hLabel}>
        <Text variant="label" color="textSecondary" numberOfLines={1}>
          {item.label}
        </Text>
      </View>
    ),
    topLabelComponent: () => (
      <View style={styles.hValue}>
        <Text variant="label" numberOfLines={1}>
          {formatValue(item.value)}
        </Text>
      </View>
    ),
  }));

  return (
    <View onLayout={onLayout} style={{ height: data.length * ROW_HEIGHT }}>
      {plotLength > 0 ? (
        <GiftedBarChart
          data={bars}
          horizontal
          // Only moves where the (hidden) value axis is drawn, but it also
          // picks the smaller of the library's two rotation offsets.
          yAxisAtTop
          /*
           * Transposed on purpose. A horizontal chart is rendered rotated, so
           * the library reads `width` as the length of the bars and `height`
           * as the extent across them. The height here is exactly the rows
           * the wrapper reserves.
           */
          width={plotLength}
          height={data.length * ROW_HEIGHT}
          barWidth={BAR_THICKNESS}
          spacing={ROW_GAP}
          initialSpacing={0}
          endSpacing={0}
          maxValue={max}
          minHeight={plotLength * MIN_FILL}
          barBorderRadius={BAR_RADIUS}
          labelWidth={LABEL_WIDTH}
          labelsDistanceFromXaxis={LABEL_DISTANCE}
          labelsExtraHeight={LABEL_HEADROOM}
          yAxisExtraHeight={VALUE_HEADROOM}
          shiftX={SHIFT_X}
          shiftY={SHIFT_Y}
          // Every row already prints its own figure, so a value axis, its
          // spine and a set of rules behind the bars would all be restating it.
          hideAxesAndRules
          yAxisLabelWidth={0}
          yAxisThickness={0}
          xAxisThickness={0}
          disableScroll
          isAnimated={false}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  hLabel: {
    height: LABEL_STRIP,
    justifyContent: 'center',
    transform: [{ translateY: -LABEL_RECENTRE }],
  },
  // The library sizes the top-label slot to the bar's thickness, which is 10px
  // square here. The figure is positioned out of it rather than inside it.
  hValue: {
    position: 'absolute',
    left: VALUE_GAP,
    top: (BAR_THICKNESS - LABEL_STRIP) / 2,
    width: VALUE_COLUMN,
    height: LABEL_STRIP,
    justifyContent: 'center',
  },
});
