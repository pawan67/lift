import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  RadarChart as GiftedRadarChart,
  type RadarChartProps as GiftedRadarChartProps,
} from 'react-native-gifted-charts';

import { Text } from '@/components/ui';
import { radius, spacing, stroke, translucent, useColors } from '@/theme';

export interface RadarAxis {
  /** Stable identity, used as a React key. */
  key: string;
  label: string;
  value: number;
  /** The same axis in the comparison series. Omit to draw one shape only. */
  previous?: number;
}

export interface RadarChartProps {
  axes: RadarAxis[];
  width: number;
  /**
   * Value the outer ring stands for. Defaults to the largest value on any axis
   * in either series; pass one explicitly to hold the scale still across a
   * range change.
   */
  max?: number;
  /** How many rings to draw inside the outline. */
  rings?: number;
  showPrevious?: boolean;
}

/**
 * Room the captions need around the plot.
 *
 * The labels sit outside the outer ring, and the longest body-part name at
 * caption size is ~56pt, so the polygon has to stop well short of the SVG's
 * edge or the captions either side are clipped by the card. These three are
 * solved together: at a 320pt plot the widest caption box lands within a point
 * of the right edge, which is the tightest the geometry goes.
 */
const LABEL_GUTTER = 60;
const LABEL_WIDTH = 64;
/** How far past the outer ring a caption is anchored. */
const LABEL_OFFSET = 10;

/** Diameter of the marker sitting on each current-series vertex. */
const VERTEX_SIZE = 5;

/**
 * gifted-charts fixes its plot radius at `(chartSize / 2) * 0.8` and exposes no
 * way to set it directly, so `chartSize` is solved backwards from the radius
 * this layout wants and the leftover square is taken up by shifting the group.
 */
const PLOT_RADIUS_RATIO = 0.4;

/*
 * Fills here are `translucent(...)` rather than an `opacity` prop, and that is
 * the library's constraint rather than a preference: its `opacity` applies to
 * the whole polygon, outline included, so a translucent fill under a solid
 * stroke cannot be expressed as one at all. The alpha has to travel in the fill
 * colour. See `translucent` in the theme.
 */

/**
 * Radar plot of one measure across a small fixed set of axes.
 *
 * Radar is a poor chart for most things. It makes magnitudes hard to compare
 * and its area grows as the square of its values, but the question here is
 * only ever *shape*: whether a training block leans forward or back, and how
 * this month's lean differs from last month's. Six axes, in a fixed order, is
 * the case it is actually good at.
 *
 * Both series share one scale, so a bigger block draws a bigger shape. A
 * chart normalised per series would draw a deload week and a brutal one
 * identically, which is the one comparison this screen exists to make.
 */
export function RadarChart({
  axes,
  width,
  max,
  rings = 4,
  showPrevious = true,
}: RadarChartProps) {
  const colors = useColors();

  // The library keeps its own geometry to itself, so the same polar maths is
  // repeated here for the two things it will not draw: the captions and the
  // vertex markers. Feeding it `chartSize` and a shift derived from the same
  // numbers is what keeps the two in register.
  const geometry = useMemo(() => {
    if (axes.length < 3) return null;

    const size = width;
    const centre = size / 2;
    const plotRadius = Math.max(10, centre - LABEL_GUTTER);

    const peak = max ?? axes.reduce((top, axis) => Math.max(top, axis.value, axis.previous ?? 0), 0);
    // An empty window still draws its grid: a collapsed polygon at the centre
    // reads as a rendering failure, where an empty frame reads as no data.
    const scale = peak > 0 ? plotRadius / peak : 0;

    // First axis at the top, then clockwise: the order the caller passed.
    const angleFor = (index: number) => (index / axes.length) * 2 * Math.PI - Math.PI / 2;

    const spokes = axes.map((axis, index) => {
      const angle = angleFor(index);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      return {
        axis,
        vertex: { x: centre + cos * axis.value * scale, y: centre + sin * axis.value * scale },
        // Captions are placed from the spoke's direction rather than by index,
        // so the same code handles all six however many there are, and each
        // one is anchored on the edge that faces the plot: a right-hand caption
        // grows rightwards from its spoke, a left-hand one leftwards. Centring
        // every box on its anchor would push the side captions back over the
        // polygon they are labelling.
        label: {
          x: centre + cos * (plotRadius + LABEL_OFFSET),
          y: centre + sin * (plotRadius + LABEL_OFFSET),
          cos,
          sin,
        },
      };
    });

    const chartSize = plotRadius / PLOT_RADIUS_RATIO;

    return {
      size,
      peak,
      spokes,
      chartSize,
      // The library centres the plot inside its own `chartSize` box; this drops
      // that box in the middle of the larger square the captions live in.
      shift: centre - chartSize / 2,
    };
  }, [axes, width, max]);

  if (!geometry) {
    return (
      <View style={[styles.empty, { height: width * 0.6 }]}>
        <Text variant="label" color="textTertiary">
          Not enough data yet
        </Text>
      </View>
    );
  }

  const { size, spokes, chartSize, shift, peak } = geometry;
  const hasPrevious = showPrevious && axes.some((axis) => (axis.previous ?? 0) > 0);

  const web = { stroke: colors.border, fill: 'none', showGradient: false };
  /*
   * The current shape in ink, the previous one already in `textTertiary`.
   *
   * This was the accent against tertiary grey, which read as two different
   * kinds of thing rather than as the same measurement at two times. On one
   * scale the pairing says what it means: this week is the dark shape, last
   * week is the faint one behind it, and no legend is needed to work out which
   * is which. The legend is still drawn, because the two labels carry the
   * dates.
   */
  const current = { fill: translucent(colors.text, 0.16), stroke: colors.text, strokeWidth: 2 };
  const values = axes.map((axis) => axis.value);

  // Previous first, so the current shape is never hidden behind it.
  const series: Pick<
    GiftedRadarChartProps,
    'data' | 'dataSet' | 'polygonConfig' | 'polygonConfigArray'
  > = hasPrevious
    ? {
        dataSet: [axes.map((axis) => axis.previous ?? 0), values],
        polygonConfigArray: [
          {
            fill: translucent(colors.textTertiary, 0.16),
            stroke: colors.textTertiary,
            strokeWidth: 1.5,
          },
          current,
        ],
      }
    : { data: values, polygonConfig: current };

  return (
    <View style={{ width: size, height: size }}>
      <GiftedRadarChart
        {...series}
        chartSize={chartSize}
        chartContainerProps={{ width: size, height: size, shiftX: shift, shiftY: shift }}
        // A window with no sets at all would divide through by zero here. Its
        // data is all zeroes either way, so which value the outer ring stands
        // for is arbitrary. It only has to be a number.
        maxValue={peak > 0 ? peak : 1}
        noOfSections={rings}
        // The library measures anticlockwise from due east, so putting the
        // first axis at the top is a quarter turn on and then a reversal.
        startAngle={90}
        isClockWise
        // Passed for the angles even though they are drawn below rather than
        // here: the number of labels is what divides the circle up.
        labels={axes.map((axis) => axis.label)}
        hideLabels
        gridConfig={{
          ...web,
          // Outermost ring first. The outline carries a full point and the
          // rings inside it a hairline, so the frame reads as the boundary
          // rather than as one more gradation.
          gridSections: Array.from({ length: rings }, (_, index) => ({
            ...web,
            strokeWidth: index === 0 ? stroke.outline : stroke.rule * 2,
          })),
        }}
        // Solid, against the library's dashed default: a dashed spoke under a
        // translucent fill reads as a texture in the shape rather than an axis.
        asterLinesConfig={{
          stroke: colors.border,
          strokeWidth: stroke.rule * 2,
          strokeDashArray: [0, 0],
        }}
      />

      {/* The library marks no vertices, so these stay hand-placed, and as
          views rather than SVG circles, alongside the captions below. */}
      {peak > 0 &&
        spokes.map((spoke) => (
          <View
            key={spoke.axis.key}
            pointerEvents="none"
            style={[
              styles.vertex,
              {
                left: spoke.vertex.x - VERTEX_SIZE / 2,
                top: spoke.vertex.y - VERTEX_SIZE / 2,
                backgroundColor: colors.text,
              },
            ]}
          />
        ))}

      {/* Captions live outside the chart so they inherit the app's font stack.
          The library draws its own as SVG text, which inherits none of it. */}
      {spokes.map((spoke) => {
        const side = spoke.label.cos > 0.3 ? 'left' : spoke.label.cos < -0.3 ? 'right' : 'center';

        return (
          <View
            key={spoke.axis.key}
            pointerEvents="none"
            style={[
              styles.label,
              {
                left:
                  side === 'left'
                    ? spoke.label.x
                    : side === 'right'
                      ? spoke.label.x - LABEL_WIDTH
                      : spoke.label.x - LABEL_WIDTH / 2,
                // Nudged up by half a line so the caption sits centred on its
                // spoke rather than hanging from it.
                top: spoke.label.y - 8,
                width: LABEL_WIDTH,
              },
            ]}
          >
            <Text variant="caption" color="textTertiary" numberOfLines={1} align={side}>
              {spoke.axis.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Legend for the two series, kept beside the chart so both read one key. */
export function RadarLegend({ currentLabel, previousLabel }: {
  currentLabel: string;
  previousLabel: string;
}) {
  const colors = useColors();

  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.dot, { backgroundColor: colors.text }]} />
        <Text variant="caption" color="textSecondary">
          {currentLabel}
        </Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.dot, { backgroundColor: colors.textTertiary }]} />
        <Text variant="caption" color="textTertiary">
          {previousLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  label: { position: 'absolute' },
  vertex: {
    position: 'absolute',
    width: VERTEX_SIZE,
    height: VERTEX_SIZE,
    borderRadius: radius.pill,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
});
