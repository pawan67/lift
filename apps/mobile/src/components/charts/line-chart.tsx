import { useMemo } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { LineChart as GiftedLineChart, type lineDataItem } from 'react-native-gifted-charts';

import { Text } from '@/components/ui';
import { font, fontSize, spacing, stroke, useColors } from '@/theme';

export interface DataPoint {
  /** Epoch ms, or any monotonic numeric axis. */
  x: number;
  y: number;
}

export interface LineChartProps {
  data: DataPoint[];
  height?: number;
  width: number;
  /** Formats the y-axis labels and the value readout. */
  formatValue?: (value: number) => string;
  formatLabel?: (x: number) => string;
  color?: string;
  /** Tints the area under the line. Flat: see `AREA_OPACITY`. */
  filled?: boolean;
  showDots?: boolean;
  /**
   * A second series drawn dashed and quiet behind the first: a smoothed trend
   * against the raw readings it was computed from. Scaled against the same
   * domain as `data`, so the two only line up if they describe the same thing.
   */
  overlay?: DataPoint[];
  /**
   * Turns the plot into a readout: dragging across it reports the nearest
   * reading, and releasing reports null. The caller renders the value: only it
   * knows the unit and the date format, and passes the point back as
   * `highlight` so this can mark it.
   */
  onScrub?: (point: DataPoint | null) => void;
  highlight?: DataPoint | null;
}

/** The gutter the y-axis labels sit in, and the strip the x labels sit under. */
const Y_AXIS_WIDTH = spacing.xxl + spacing.xl;
const X_AXIS_HEIGHT = spacing.xl;

/**
 * Slack above the top rule. A reading on the maximum lands exactly on that
 * rule, and gifted-charts draws the plot inside a scroll view that clips it, so
 * without this the top half of that dot is shaved off.
 */
const TOP_OVERFLOW = spacing.md;

const DOT_RADIUS = 3;
const MARKER_RADIUS = 5;

/**
 * The area under the line, as a flat tint of the line's own colour.
 *
 * Low enough that the rules behind it stay readable through the fill, which is
 * what stops the plot from turning into a solid block on a series that spends
 * most of its time near the top.
 */
const AREA_OPACITY = 0.1;

/** Past this many readings the dots merge into a caterpillar and are dropped. */
const MAX_DOTS = 40;

/**
 * Minimal time-series line chart, drawn by react-native-gifted-charts.
 *
 * The library plots by *index*, and always measures its y-axis from zero. Both
 * are worked around here rather than lived with: the series is sorted and each
 * value is shifted down by the domain minimum, with `maxValue` set to the span,
 * which makes the plot cover exactly [min, max] the way a trend line has to. A
 * chart of body weight that starts at zero shows a flat line near the top.
 */
export function LineChart({
  data,
  width,
  height = 180,
  formatValue = (value) => String(Math.round(value)),
  formatLabel,
  color,
  filled = true,
  showDots = true,
  overlay,
  onScrub,
  highlight,
}: LineChartProps) {
  const colors = useColors();
  /*
   * Ink by default, not the accent.
   *
   * Every chart in the app draws its data in ink now and keeps the accent for
   * things you can touch: see `toneColors` in `components/ui/surfaces.tsx`.
   * A line is the case where that reads most clearly, because a chart with one
   * series has nothing to tell apart, so the colour was only ever saying "this
   * is a chart".
   */
  const lineColor = color ?? colors.text;

  const geometry = useMemo(() => {
    if (data.length === 0) return null;

    const sorted = [...data].sort((a, b) => a.x - b.x);

    const ys = sorted.map((point) => point.y);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);

    // A flat series (every value identical) would divide by zero when scaling.
    // Pad the range so the line renders centred instead of collapsing.
    if (minY === maxY) {
      const pad = Math.abs(minY) * 0.1 || 1;
      minY -= pad;
      maxY += pad;
    }

    const plotWidth = Math.max(1, width - Y_AXIS_WIDTH);
    const plotHeight = Math.max(1, height - TOP_OVERFLOW - X_AXIS_HEIGHT);

    // Points are laid out from `initialSpacing` at a fixed step, so a lone
    // reading is centred by shifting the whole series in rather than by
    // scaling x. Both ends keep a dot's radius of room so the outermost
    // markers are not cut in half by the edge of the plot.
    const initialSpacing = sorted.length === 1 ? plotWidth / 2 : DOT_RADIUS;
    const step = Math.max(
      1,
      (plotWidth - initialSpacing - DOT_RADIUS) / Math.max(sorted.length - 1, 1),
    );

    return { sorted, minY, maxY, plotWidth, plotHeight, initialSpacing, step };
  }, [data, width, height]);

  const series = useMemo<lineDataItem[]>(() => {
    if (!geometry) return [];

    const { sorted, minY, plotHeight } = geometry;
    const dotsFit = showDots && sorted.length <= MAX_DOTS;

    // Matched by x rather than by identity: the caller round-trips the point
    // this chart handed it, but nothing obliges it to hand back the same
    // object.
    const marked = highlight ? sorted.findIndex((point) => point.x === highlight.x) : -1;

    return sorted.map((point, index) => {
      if (index !== marked) return { value: point.y - minY, hideDataPoint: !dotsFit };

      // The marker's rule runs the full plot height so the reading can be
      // lined up against the axis even when the dot sits mid-chart.
      return {
        value: point.y - minY,
        dataPointColor: lineColor,
        dataPointRadius: MARKER_RADIUS,
        showVerticalLine: true,
        verticalLineHeight: plotHeight,
        verticalLineColor: colors.borderStrong,
        verticalLineThickness: stroke.outline,
      };
    });
  }, [geometry, showDots, highlight, lineColor, colors.borderStrong]);

  // Resampled onto the main series' x positions, because gifted-charts pairs
  // the two lines by index and would otherwise stretch a shorter trend across
  // the whole plot. Clamped rather than dropped: a smoothed series can start
  // outside the raw range at either end, and a stray pixel over the axis
  // labels reads as a rendering fault.
  const overlaySeries = useMemo<lineDataItem[] | undefined>(() => {
    if (!geometry || !overlay || overlay.length < 2) return undefined;

    const { sorted, minY, maxY } = geometry;
    const trend = [...overlay].sort((a, b) => a.x - b.x);

    return sorted.map((point) => ({
      value: clamp(valueAt(trend, point.x), minY, maxY) - minY,
    }));
  }, [geometry, overlay]);

  // Rebuilt whenever the plot or the handler changes, closing over both
  // directly rather than reading them through refs. In practice it is created
  // once: neither dependency moves while a finger is down, since the only thing
  // a scrub changes is `highlight`.
  const responder = useMemo(() => {
    /** Nearest reading to where the finger is, horizontally. */
    const report = (x: number) => {
      if (!geometry) return;

      const { sorted, initialSpacing, step } = geometry;
      const nearest = Math.round((x - Y_AXIS_WIDTH - initialSpacing) / step);

      onScrub?.(sorted[Math.min(sorted.length - 1, Math.max(0, nearest))]!);
    };

    return PanResponder.create({
      // Claimed on touch-down so a tap reads a value, and handed straight back
      // if the ScrollView above asks for it, which is what happens the moment
      // the gesture turns out to be a vertical scroll. Without the termination
      // request the chart would swallow every scroll that began on top of it.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => true,

      onPanResponderGrant: (event) => report(event.nativeEvent.locationX),
      onPanResponderMove: (event) => report(event.nativeEvent.locationX),
      onPanResponderRelease: () => onScrub?.(null),
      onPanResponderTerminate: () => onScrub?.(null),
    });
  }, [geometry, onScrub]);

  if (!geometry) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text variant="label" color="textTertiary">
          Not enough data yet
        </Text>
      </View>
    );
  }

  const { sorted, minY, maxY, plotWidth, plotHeight, initialSpacing, step } = geometry;
  const midY = (minY + maxY) / 2;

  return (
    <View style={[styles.root, { width, height }]} {...(onScrub ? responder.panHandlers : null)}>
      <GiftedLineChart
        data={series}
        data2={overlaySeries}
        width={plotWidth}
        height={plotHeight}
        // The series was shifted down by `minY`, so the top of the plot is the
        // span rather than the maximum.
        maxValue={maxY - minY}
        noOfSections={2}
        initialSpacing={initialSpacing}
        endSpacing={DOT_RADIUS}
        spacing={step}
        // The plot is already sized to the space it was given, and a scroll
        // view here would compete with the one the screen is inside.
        disableScroll
        overflowTop={TOP_OVERFLOW}
        color1={lineColor}
        thickness1={2}
        strokeLinecap1="round"
        areaChart1={filled}
        startFillColor={lineColor}
        endFillColor={lineColor}
        // Flat, not faded. The fill used to ramp 0.28 → 0 down the plot, which
        // put a soft edge across the chart at no fixed value: a horizontal
        // boundary the eye reads as data and the axis cannot explain. One low
        // tint says "under the line" and stops there. Both ends are set because
        // the library interpolates between them whether or not it is asked to.
        startOpacity={AREA_OPACITY}
        endOpacity={AREA_OPACITY}
        dataPointsColor={lineColor}
        dataPointsRadius={DOT_RADIUS}
        // Behind the main line and quieter than it, so the raw readings stay
        // the subject and the trend stays an annotation on them.
        zIndex1={2}
        zIndex2={1}
        color2={colors.textTertiary}
        thickness2={1.5}
        strokeDashArray2={[5, 4]}
        strokeLinecap2="round"
        hideDataPoints2
        rulesType="solid"
        rulesColor={colors.border}
        rulesThickness={stroke.outline}
        xAxisColor={colors.border}
        xAxisThickness={stroke.outline}
        // The x labels are drawn below instead: see the note on that row.
        xAxisLabelsHeight={0}
        yAxisThickness={0}
        yAxisExtraHeight={0}
        yAxisLabelWidth={Y_AXIS_WIDTH}
        // Bottom-up, one per rule. Given as text because the axis is in the
        // caller's unit, which the chart is never told.
        yAxisLabelTexts={[formatValue(minY), formatValue(midY), formatValue(maxY)]}
        yAxisTextStyle={[styles.axisText, { color: colors.textTertiary }]}
        yAxisLabelContainerStyle={styles.yAxisLabel}
      />

      {/* Outside the chart because gifted-charts centres every x label in a box
          one step wide: at a dozen readings that box is too narrow for a date,
          and these two have to sit flush with the ends of the plot anyway. */}
      {formatLabel && sorted.length > 1 && (
        <View style={styles.xAxis} pointerEvents="none">
          <Text variant="caption" color="textTertiary">
            {formatLabel(sorted[0]!.x)}
          </Text>
          <Text variant="caption" color="textTertiary">
            {formatLabel(sorted[sorted.length - 1]!.x)}
          </Text>
        </View>
      )}
    </View>
  );
}

/** The series' value at `x`, holding its end values beyond either end. */
function valueAt(series: readonly DataPoint[], x: number): number {
  const first = series[0]!;
  if (x <= first.x) return first.y;

  for (let index = 1; index < series.length; index++) {
    const point = series[index]!;
    if (x > point.x) continue;

    const previous = series[index - 1]!;
    const span = point.x - previous.x;
    return span === 0 ? point.y : previous.y + ((x - previous.x) / span) * (point.y - previous.y);
  }

  return series[series.length - 1]!.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  // Clipped because gifted-charts reserves a block of empty space below its
  // plot for labels this chart does not use, and that space would otherwise
  // paint over whatever the screen puts underneath.
  root: { paddingTop: TOP_OVERFLOW, overflow: 'hidden' },
  axisText: { fontSize: fontSize.xs, ...font('regular') },
  yAxisLabel: { alignItems: 'flex-end', paddingRight: spacing.xs },
  xAxis: {
    position: 'absolute',
    left: Y_AXIS_WIDTH,
    right: 0,
    bottom: 0,
    height: X_AXIS_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
