import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BarChart, type barDataItem } from 'react-native-gifted-charts';

import { Text } from '@/components/ui';
import { font, fontSize, spacing, stroke, useColors } from '@/theme';

export interface ColumnDatum {
  /** Stable identity for selection. The bucket's start timestamp. */
  key: number;
  label: string;
  value: number;
  /**
   * Overrides `color` for this column alone.
   *
   * For a run where the columns are not all the same thing: Home paints the
   * week it is reporting in the accent and fades the rest by age, so the chart
   * says which bar the figure above it belongs to. Selection is still drawn by
   * fading the others back, so a per-column colour and a highlight compose:
   * the colour says which bar is being read, the opacity says the others are
   * not.
   */
  color?: string;
}

export interface ColumnChartProps {
  data: ColumnDatum[];
  width: number;
  height?: number;
  /** Formats the y-axis ticks. Keep it short. The gutter is 44px. */
  formatValue?: (value: number) => string;
  /**
   * Formats a column's value for a screen reader. Defaults to `formatValue`.
   *
   * Separate because the two have opposite constraints. A tick is abbreviated
   * to survive a 44px gutter, which is a visual budget a screen reader does not
   * have: read aloud, "21k" throws away the figure the chart exists to report,
   * and it is the only way a non-sighted user reaches that number at all. Pass
   * the readout formatter here and the terse one above.
   */
  describeValue?: (value: number) => string;
  selectedKey?: number | null;
  /** Tapping the selected column again passes null, clearing the selection. */
  onSelect?: (datum: ColumnDatum | null) => void;
  color?: string;
  /** Roughly how many x-axis labels to show before thinning them out. */
  maxLabels?: number;
  /**
   * Shown in place of the plot when there is nothing to draw.
   *
   * Worded by the caller because the two screens mean different things by it:
   * on History the window is one the user chose and can change, and on Home it
   * is a fixed twelve weeks, where "in this range" would name a control that
   * screen does not have.
   */
  emptyLabel?: string;
}

/** The y-axis tick gutter. `formatValue` has to fit inside this. */
const AXIS_GUTTER = 44;
/** Headroom above the top gridline, so a peak column is not flush with the card. */
const TOP_PAD = spacing.md;
/**
 * Clear air between the baseline and the labels under it.
 *
 * The strip used to be a single 16px number with the text pinned to the top of
 * it, which put the labels hard against the axis rule: they read as hanging off
 * the line rather than as annotating it, and at a glance the descenders looked
 * like part of the axis. Splitting the strip into a gap and a line of type is
 * what lets the gap be stated rather than left as whatever the line height did
 * not use.
 */
const LABEL_GAP = spacing.xs;
/** One line of `caption`, which is what an x-axis label is. */
const LABEL_TEXT = 14;
/** The strip below the baseline that the x-axis labels are drawn into. */
const LABEL_ROW = LABEL_GAP + LABEL_TEXT;
/**
 * How much room one x-axis label is given, in px.
 *
 * Wider than a column deliberately. The library draws its own labels in a box
 * one slot across, and at twelve weeks a slot is about 25px, so "15 Jun" came
 * out as "15 ..." and the month, the only part that places the column in the
 * year, was the part that got dropped. Widening the library's box is not the
 * fix: it offsets that box by a fixed half-gap, so a wider one is no longer
 * centred on its column and every label drifts right.
 *
 * 52 holds every label `bucketLabel` produces: "15 Jun" and "27 Sep" at week
 * granularity, and the shorter month, "Q3 26" and "2026" forms above it.
 * Overlap is not a risk because only every nth column is labelled, and n is
 * chosen so the labelled ones are at least a slot apart.
 */
const LABEL_SLOT = 52;
/** Three ticks (zero, half, ceiling) which is two gaps between them. */
const SECTIONS = 2;
/** Floor for a column's height, in px. See the note on empty buckets below. */
const MIN_BAR = 2;
/** Corner radius on a column. Matches `BarChart`; the reasoning is recorded there. */
const BAR_RADIUS = 3;
/** How far back the columns that are not selected fade. */
const LOWLIGHT = 0.3;

/**
 * Time-bucketed column chart.
 *
 * A column rather than a line: these series are *totals per period*, and a line
 * implies a continuous value moving between samples. Two weeks at 12,000 kg
 * with an empty one between them is a gap, not a slope through 6,000.
 *
 * Bars always start at zero for the same reason. A truncated baseline makes a
 * 5% week-on-week change look like a doubling. `BarChart` measures every column
 * from zero unless it is handed a `yAxisOffset`, so this amounts to never
 * setting one.
 */
export function ColumnChart({
  data,
  width,
  height = 190,
  formatValue = (value) => String(Math.round(value)),
  describeValue,
  selectedKey = null,
  onSelect,
  color,
  maxLabels = 5,
  emptyLabel = 'No data in this range',
}: ColumnChartProps) {
  const colors = useColors();
  // Ink rather than the accent: see `lineColor` in `line-chart.tsx`.
  const fill = color ?? colors.text;

  // The library prints the y-axis ticks itself, so the `caption` variant has to
  // be restated as a style rather than rendered as a `Text`.
  const tickText = useMemo(
    () => ({ fontSize: fontSize.xs, ...font('regular'), color: colors.textTertiary }),
    [colors],
  );

  // `width` and `height` are the whole component; the plot is what is left once
  // the tick gutter and the label strip have taken their share.
  const plotWidth = Math.max(1, width - AXIS_GUTTER);
  const plotHeight = Math.max(1, height - TOP_PAD - LABEL_ROW);

  const chart = useMemo(() => {
    // A run of zeroes is as empty as no run at all, and it is worse to draw:
    // `niceCeiling` floors at 1, so an untrained window would print an axis
    // reading 0, 1, 1 under a flat baseline. Home hits this on a fresh install
    // and on any metric a user's sessions do not record.
    const peak = data.reduce((max, item) => Math.max(max, item.value), 0);
    if (data.length === 0 || peak <= 0) return null;

    const maxValue = niceCeiling(peak);

    const slot = plotWidth / data.length;
    // Cap the bar so a three-bucket range doesn't render three fat slabs. The
    // leftover is the gap, split in half at each end, which puts every column
    // dead centre of its slot.
    const barWidth = Math.max(3, Math.min(slot * 0.62, 34));
    const gap = slot - barWidth;

    // Show every nth label so they never collide; always keep the last bucket,
    // which is the one the user is actually training in.
    const labelStep = Math.max(1, Math.ceil(data.length / maxLabels));

    const bars: barDataItem[] = data.map((item) => ({
      value: item.value,
      // An empty bucket still gets a bar, painted in nothing: `minHeight` would
      // otherwise draw a rest week and a light week as the same 2px sliver.
      frontColor: item.value > 0 ? (item.color ?? fill) : 'transparent',
      // No label and no `labelComponent`: the x-axis strip is drawn below
      // instead. See the note on `ticks`/`labels` for why.
      labelComponent: () => null,
    }));

    // Where each labelled column sits, measured from the left edge of the plot.
    // `initialSpacing` is half a gap, then one slot per column, then half a bar
    // to reach its middle. The same arithmetic the library lays the bars out
    // with, which is what keeps a label under its own column. `slot` above is
    // that same pitch: `gap` is defined as the remainder of it.
    const candidates = data
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => (data.length - 1 - index) % labelStep === 0)
      .map(({ item, index }) => ({
        key: item.key,
        text: item.label,
        // Clamped so the run's first and last labels stay inside the plot. They
        // stop being centred on their column at the edges, which is the usual
        // compromise for an axis and much the better one: the alternative is
        // "17 Aug" half outside the card.
        left: clamp(gap / 2 + index * slot + barWidth / 2 - LABEL_SLOT / 2, 0, plotWidth - LABEL_SLOT),
      }));

    // Walked from the end so a collision drops the older label, never the
    // newest one: the last bucket is the week being trained in and the one the
    // figure above the chart refers to.
    //
    // Thinning by `labelStep` alone is not enough, and the gap it leaves is
    // exactly what the clamp above spends. On a narrow board the final label
    // slides left to stay inside the plot and lands on its neighbour, so the
    // two are only guaranteed apart once separation is checked after clamping
    // rather than assumed from the step.
    const labels: typeof candidates = [];
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      const placed = labels[labels.length - 1];
      if (!placed || candidate.left + LABEL_SLOT <= placed.left) labels.push(candidate);
    }
    labels.reverse();

    return { bars, barWidth, gap, maxValue, labels };
  }, [data, plotWidth, maxLabels, fill]);

  const selectedIndex = useMemo(
    () => (selectedKey === null ? -1 : data.findIndex((item) => item.key === selectedKey)),
    [data, selectedKey],
  );

  if (!chart) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text variant="label" color="textTertiary">
          {emptyLabel}
        </Text>
      </View>
    );
  }

  // Bottom-up, which is the order `yAxisLabelTexts` is indexed in. The origin is
  // a literal "0" rather than `formatValue(0)`: the unit is already spelled out
  // on the ticks above it, and "0 kg" in a 44px gutter is mostly unit.
  const ticks = ['0'];
  for (let section = 1; section <= SECTIONS; section += 1) {
    ticks.push(formatValue((chart.maxValue / SECTIONS) * section));
  }

  return (
    // Sized rather than left to its content. The library gives its own box a
    // `marginBottom` of `xAxisLabelsHeight - 55`, which is negative at every
    // sensible label height and would drag anything laid out after it back over
    // the plot. Everything below is positioned against this box instead, and
    // the box is exactly the height the caller asked for.
    <View style={{ width, height }}>
      <BarChart
        data={chart.bars}
        width={plotWidth}
        height={plotHeight}
        barWidth={chart.barWidth}
        spacing={chart.gap}
        initialSpacing={chart.gap / 2}
        endSpacing={chart.gap / 2}
        barBorderRadius={Math.min(BAR_RADIUS, chart.barWidth / 2)}
        // A non-zero value always gets a visible sliver, otherwise a light week
        // is indistinguishable from a rest week.
        minHeight={MIN_BAR}
        disableScroll
        isAnimated={false}
        // The ceiling is the rounded one, and the ticks are spaced to reach it
        // exactly. `stepValue` is deliberately left to the library: it derives
        // `maxValue / noOfSections`, whereas passing both back makes the section
        // count a float division that can land at 1.9999999999999998.
        maxValue={chart.maxValue}
        noOfSections={SECTIONS}
        yAxisLabelTexts={ticks}
        // Only reached if a tick text comes back empty, which sends the library
        // down its own numeric formatting path.
        formatYLabel={(label) => formatValue(Number(label))}
        yAxisLabelWidth={AXIS_GUTTER}
        yAxisLabelContainerStyle={styles.tick}
        yAxisTextStyle={tickText}
        yAxisTextNumberOfLines={1}
        yAxisExtraHeight={TOP_PAD}
        // No vertical axis: the rules already carry the grid, and a spine down
        // the left of three ticks is one line more than the chart needs.
        yAxisThickness={0}
        rulesColor={colors.border}
        // Doubled because these are SVG strokes rather than view borders. A
        // hairline stroke gets antialiased away to almost nothing.
        rulesThickness={stroke.rule * 2}
        rulesLength={plotWidth}
        xAxisColor={colors.border}
        xAxisThickness={stroke.outline}
        xAxisLength={plotWidth}
        xAxisLabelsHeight={LABEL_ROW}
        // Selection is drawn by fading everything else back. At -1 nothing is
        // selected and every column stays at full strength.
        highlightEnabled
        highlightedBarIndex={selectedIndex}
        lowlightOpacity={LOWLIGHT}
        // Selection is handled by the hit row below rather than by the
        // library's own press handling. See the note there.
        disablePress
      />

      {/*
        The x-axis, drawn here rather than by the library.

        Each of its label boxes is one column wide and pinned half a gap left of
        the column, which at twelve weeks is 25px of room for "15 Jun" and no
        way to widen it without also pushing it off centre. Positioning them
        against the plot instead costs the arithmetic above and buys a label
        that fits, an edge that can be clamped, and the app's own type.
      */}
      <View
        style={[
          styles.labelRow,
          { top: TOP_PAD + plotHeight, left: AXIS_GUTTER, width: plotWidth },
        ]}
      >
        {chart.labels.map((label) => (
          <Text
            key={label.key}
            variant="caption"
            color="textTertiary"
            align="center"
            numberOfLines={1}
            style={[styles.label, { left: label.left }]}
          >
            {label.text}
          </Text>
        ))}
      </View>

      {/*
        A full-height target per bucket, laid over the plot.

        The library sizes each column's `TouchableOpacity` to the column, which
        makes a rest week (floored at `MIN_BAR` and painted in nothing) a 2px
        strip of target sitting on the baseline. A rest week is exactly the kind
        of week worth tapping, so the whole slot is the target instead, as it
        was before. Equal flex per child reproduces the slot width the bars were
        laid out against.
      */}
      {onSelect && (
        <View
          style={[styles.hitRow, { left: AXIS_GUTTER, width: plotWidth, height: TOP_PAD + plotHeight }]}
        >
          {data.map((item) => (
            <Pressable
              key={item.key}
              style={styles.hit}
              onPress={() => onSelect(item.key === selectedKey ? null : item)}
              accessibilityRole="button"
              accessibilityState={{ selected: item.key === selectedKey }}
              accessibilityLabel={`${item.label}, ${(describeValue ?? formatValue)(item.value)}`}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Rounds an axis maximum up to a readable step (1, 2, 2.5 or 5 × 10ⁿ).
 *
 * Without this the top gridline reads "13,847 kg", which nobody parses at a
 * glance, and the half-way tick inherits the same problem.
 */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;

  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Keeps a label inside the plot at either end of the run. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  tick: { alignItems: 'flex-end', paddingRight: spacing.sm },
  hitRow: { position: 'absolute', top: 0, flexDirection: 'row' },
  hit: { flex: 1, height: '100%' },
  // Pinned to the baseline rather than laid out after the plot, for the reason
  // recorded on the outer box.
  labelRow: { position: 'absolute', height: LABEL_ROW },
  label: { position: 'absolute', top: LABEL_GAP, width: LABEL_SLOT, lineHeight: LABEL_TEXT },
});
