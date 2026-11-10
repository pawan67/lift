/**
 * The pieces the food statistics screen is drawn from: a calorie chart with
 * the goal across it, a calendar of days against the goal, the macro split and
 * the meal split.
 *
 * Food has its own versions rather than borrowing `ColumnChart` and
 * `ContributionGraph` from the workout statistics because each needs one thing
 * those cannot carry: the chart needs a goal line, and the calendar shades a
 * day by a verdict (under, on target, over) rather than by how heavy it was.
 * They keep the same shapes, spacing and type so the two read as one product,
 * and the calendar reuses the same week arithmetic (`contributionColumns`).
 *
 * Colours follow the food tab rather than the workout charts: the accent for
 * calories eaten and the danger colour for over the goal, the same two the
 * diary's ring and week strip already taught.
 */

import { MEAL_LABELS, formatCalories, type MacroSplit, type MealShare, type StatsBucket, type StatsBucketSize, type StatsDay } from '@lift/shared';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { contributionColumns, weekdayHeadings } from '@/features/analytics/calendar';
import { toIsoDate } from '@/features/nutrition/dates';
import { mix, radius, readableOn, spacing, stroke, useColors, type Palette } from '@/theme';

import { MACROS, macroColors } from './summary';

// ---------------------------------------------------------------------------
// Calorie chart
// ---------------------------------------------------------------------------

const PLOT_HEIGHT = 140;
/** Room above the taller of the peak and the goal, so neither sits on the card edge. */
const HEADROOM = 1.12;
/** Over this share of the goal a bar turns to the danger colour, matching the day verdict. */
const OVER = 1.1;

function bucketTitle(bucket: StatsBucket, size: StatsBucketSize): string {
  const start = parseISO(bucket.start);
  if (size === 'day') return format(start, 'EEE d MMM');
  if (size === 'week') return `${format(start, 'd MMM')} to ${format(parseISO(bucket.end), 'd MMM')}`;
  return format(start, 'MMMM yyyy');
}

function bucketLabel(bucket: StatsBucket, size: StatsBucketSize, count: number): string {
  const start = parseISO(bucket.start);
  if (size === 'day') return count <= 7 ? format(start, 'EEEEE') : format(start, 'd');
  if (size === 'week') return format(start, 'd MMM');
  return format(start, 'MMM');
}

/**
 * Calories per bar, the goal as a line across them, and a tap on any bar to
 * read its figure in the line above.
 *
 * Drawn with plain views, like the training report's bars, rather than through
 * the chart library: the goal line is the whole point of this chart and the
 * library's own reference lines are drawn against an axis maximum it rounds
 * internally, which would put the line in the wrong place.
 */
export function CalorieTrend({
  buckets,
  size,
  goal,
}: {
  buckets: StatsBucket[];
  size: StatsBucketSize;
  goal: number | undefined;
}) {
  const colors = useColors();
  const [selected, setSelected] = useState<string | null>(null);

  const peak = Math.max(0, ...buckets.map((bucket) => bucket.calories));
  const max = Math.max(1, Math.max(peak, goal ?? 0) * HEADROOM);
  // Labels thin out so they never collide; the last bar always keeps its own.
  const every = Math.max(1, Math.ceil(buckets.length / 8));
  const chosen = buckets.find((bucket) => bucket.start === selected) ?? null;

  const readout = chosen
    ? chosen.daysLogged === 0
      ? `${bucketTitle(chosen, size)}: nothing logged`
      : size === 'day'
        ? `${bucketTitle(chosen, size)}: ${formatCalories(chosen.calories)} kcal${chosen.inProgress ? ' so far' : ''}`
        : `${bucketTitle(chosen, size)}: ${formatCalories(chosen.calories)} kcal a day, ${chosen.daysLogged} ${chosen.daysLogged === 1 ? 'day' : 'days'} logged`
    : goal
      ? `Goal ${formatCalories(goal)} kcal. Tap a bar for its figure.`
      : 'Tap a bar for its figure.';

  return (
    <View style={styles.trend}>
      <Text variant="caption" color={chosen ? 'text' : 'textTertiary'} numberOfLines={1}>
        {readout}
      </Text>
      <View style={styles.plot}>
        {goal ? (
          <View
            pointerEvents="none"
            style={[styles.goalLine, { bottom: (goal / max) * PLOT_HEIGHT, borderColor: colors.textTertiary }]}
          />
        ) : null}
        {buckets.map((bucket, index) => {
          const over = !!goal && bucket.calories > goal * OVER;
          const base = over ? colors.danger : colors.accent;
          // A part day is drawn paler rather than with opacity, which would be a
          // conditional opacity on a view the Android release build may flatten.
          const fill = bucket.inProgress ? mix(colors.surfaceMuted, base, 0.5) : base;
          const isSelected = bucket.start === selected;
          const dimmed = selected !== null && !isSelected;
          const height = bucket.calories > 0 ? Math.max(3, (bucket.calories / max) * PLOT_HEIGHT) : 0;
          return (
            <Pressable
              key={bucket.start}
              style={styles.slot}
              onPress={() => setSelected(isSelected ? null : bucket.start)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${bucketTitle(bucket, size)}, ${bucket.daysLogged === 0 ? 'nothing logged' : `${formatCalories(bucket.calories)} calories${size === 'day' ? '' : ' a day'}`}`}
            >
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.bar,
                    {
                      height,
                      backgroundColor: dimmed ? mix(colors.surfaceMuted, fill, 0.45) : fill,
                      borderRadius: Math.min(3, height / 2),
                    },
                  ]}
                />
              </View>
              <Text variant="caption" color="textTertiary" style={styles.barLabel} numberOfLines={1}>
                {(buckets.length - 1 - index) % every === 0 ? bucketLabel(bucket, size, buckets.length) : ' '}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Adherence calendar
// ---------------------------------------------------------------------------

export type DayShade = 'empty' | 'logged' | 'under' | 'on' | 'over' | 'outside';

function shadeOf(day: StatsDay | undefined, hasGoal: boolean): DayShade {
  if (!day) return 'empty';
  if (!hasGoal || day.verdict === null) return 'logged';
  return day.verdict;
}

function shadeColor(shade: DayShade, colors: Palette): string {
  switch (shade) {
    case 'outside':
      return 'transparent';
    case 'empty':
      return colors.surfaceMuted;
    case 'logged':
    case 'on':
      return colors.accent;
    case 'under':
      return mix(colors.surfaceMuted, colors.accent, 0.4);
    case 'over':
      return colors.danger;
  }
}

const SHADE_WORDS: Record<DayShade, string> = {
  outside: '',
  empty: 'nothing logged',
  logged: 'logged',
  under: 'under the goal',
  on: 'on target',
  over: 'over the goal',
};

/** Up to this many weeks the calendar is a month page; past it, a strip of columns. */
const PAGE_WEEKS = 6;
const CELL = 13;
const GAP = 4;

/**
 * Every day of the range against the calorie goal.
 *
 * Short ranges are laid out as a calendar page, weeks as rows with the date in
 * each square, because a week or a month is read day by day. Longer ones turn
 * into the same week-per-column strip the training-days graph uses, which is
 * read for its pattern instead: the weekends that run over, the fortnight
 * that went unlogged.
 */
export function AdherenceCalendar({
  from,
  to,
  today,
  daily,
  hasGoal,
  firstDayOfWeek,
}: {
  from: string;
  to: string;
  today: string;
  daily: StatsDay[];
  hasGoal: boolean;
  firstDayOfWeek: 0 | 1;
}) {
  const colors = useColors();
  const scrollRef = useRef<ScrollView>(null);
  const byDate = useMemo(() => new Map(daily.map((day) => [day.date, day])), [daily]);
  const headings = useMemo(() => weekdayHeadings(firstDayOfWeek), [firstDayOfWeek]);

  const weeks = useMemo(() => {
    const end = parseISO(to);
    const start = parseISO(from);
    const offset = (start.getDay() - firstDayOfWeek + 7) % 7;
    const endOffset = (end.getDay() - firstDayOfWeek + 7) % 7;
    const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + offset + (6 - endOffset) + 1;
    return contributionColumns(end, Math.max(1, Math.round(span / 7)), firstDayOfWeek).map((column) =>
      column.map(toIsoDate),
    );
  }, [from, to, firstDayOfWeek]);

  const shade = (iso: string): DayShade => (iso < from || iso > to || iso > today ? 'outside' : shadeOf(byDate.get(iso), hasGoal));
  const describe = (iso: string, value: DayShade) => {
    const day = byDate.get(iso);
    return `${format(parseISO(iso), 'EEEE d MMMM')}, ${day ? `${formatCalories(day.calories)} calories, ` : ''}${SHADE_WORDS[value]}`;
  };

  const legend: DayShade[] = hasGoal ? ['empty', 'under', 'on', 'over'] : ['empty', 'logged'];

  return (
    <View style={styles.calendar}>
      {weeks.length <= PAGE_WEEKS ? (
        <View style={styles.page}>
          <View style={styles.pageRow}>
            {headings.map((heading) => (
              <Text key={heading.long} variant="caption" color="textTertiary" align="center" style={styles.pageCell}>
                {heading.narrow}
              </Text>
            ))}
          </View>
          {weeks.map((week) => (
            <View key={week[0]} style={styles.pageRow}>
              {week.map((iso) => {
                const value = shade(iso);
                const fill = shadeColor(value, colors);
                const strong = value === 'on' || value === 'logged' || value === 'over';
                return (
                  <View
                    key={iso}
                    style={[
                      styles.pageCell,
                      styles.pageSquare,
                      { backgroundColor: fill, borderColor: iso === today ? colors.text : fill },
                    ]}
                    accessible={value !== 'outside'}
                    accessibilityLabel={value === 'outside' ? undefined : describe(iso, value)}
                  >
                    <Text
                      variant="caption"
                      style={{
                        color:
                          value === 'outside'
                            ? colors.textTertiary
                            : strong
                              ? readableOn(fill, colors)
                              : colors.textSecondary,
                      }}
                    >
                      {parseISO(iso).getDate()}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.stripRow}>
          <View style={styles.weekdayColumn}>
            {headings.map((heading, index) => (
              <View key={heading.long} style={styles.weekdayCell}>
                {index % 2 === 1 ? (
                  <Text variant="caption" color="textTertiary" numberOfLines={1}>
                    {heading.narrow}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            <View>
              <View style={styles.monthRow}>
                {weeks.map((week, index) => {
                  const month = format(parseISO(week[0]!), 'MMM');
                  const previous = index > 0 ? format(parseISO(weeks[index - 1]![0]!), 'MMM') : null;
                  return (
                    <View key={week[0]} style={styles.monthCell}>
                      {month !== previous ? (
                        <Text variant="caption" color="textTertiary" numberOfLines={1}>
                          {month}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              <View style={styles.strip}>
                {weeks.map((week) => (
                  <View key={week[0]} style={styles.stripColumn}>
                    {week.map((iso) => {
                      const value = shade(iso);
                      const fill = shadeColor(value, colors);
                      return (
                        <View
                          key={iso}
                          style={[styles.stripCell, { backgroundColor: fill, borderColor: iso === today ? colors.text : fill }]}
                          accessible={value !== 'outside'}
                          accessibilityLabel={value === 'outside' ? undefined : describe(iso, value)}
                        />
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      )}

      <View style={styles.legend} accessible accessibilityLabel={`Key: ${legend.map((value) => SHADE_WORDS[value]).join(', ')}`}>
        {legend.map((value) => (
          <View key={value} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: shadeColor(value, colors) }]} />
            <Text variant="caption" color="textTertiary">
              {value === 'empty' ? 'Not logged' : value === 'logged' ? 'Logged' : value === 'on' ? 'On target' : value === 'under' ? 'Under' : 'Over'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Macro split
// ---------------------------------------------------------------------------

/**
 * Where the calories came from, as one bar split three ways, with the split
 * the goals imply drawn as a thinner bar under it so the two can be compared
 * at a glance.
 */
export function MacroSplitBars({ split, goalSplit }: { split: MacroSplit; goalSplit: MacroSplit | null }) {
  const colors = useColors();
  const tint = macroColors(colors);
  return (
    <View style={styles.split}>
      <View style={styles.splitBar}>
        {MACROS.map((macro) =>
          split[macro.key] > 0 ? (
            <View key={macro.key} style={{ flex: split[macro.key], backgroundColor: tint[macro.key] }} />
          ) : null,
        )}
      </View>
      {goalSplit ? (
        <View style={[styles.splitBar, styles.goalBar]}>
          {MACROS.map((macro) => (
            <View key={macro.key} style={{ flex: goalSplit[macro.key], backgroundColor: mix(colors.surfaceMuted, tint[macro.key], 0.45) }} />
          ))}
        </View>
      ) : null}
      <View style={styles.splitLegend}>
        {MACROS.map((macro) => (
          <View
            key={macro.key}
            style={styles.splitItem}
            accessible
            accessibilityLabel={`${macro.label} ${Math.round(split[macro.key] * 100)} percent of calories${goalSplit ? `, goal ${Math.round(goalSplit[macro.key] * 100)} percent` : ''}`}
          >
            <View style={[styles.dot, { backgroundColor: tint[macro.key] }]} />
            <Text variant="label" color="textSecondary">
              {macro.label}
            </Text>
            <Text variant="numeric">{Math.round(split[macro.key] * 100)}%</Text>
            {goalSplit ? (
              <Text variant="caption" color="textTertiary">
                / {Math.round(goalSplit[macro.key] * 100)}%
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Meal split
// ---------------------------------------------------------------------------

const MEAL_ICONS: Record<MealShare['meal'], keyof typeof Ionicons.glyphMap> = {
  breakfast: 'sunny-outline',
  lunch: 'restaurant-outline',
  dinner: 'moon-outline',
  snacks: 'cafe-outline',
};

/** Each meal's calories a day and its share of the day, as a bar against the largest. */
export function MealSplit({ meals }: { meals: MealShare[] }) {
  const colors = useColors();
  const top = Math.max(0.0001, ...meals.map((meal) => meal.share));
  return (
    <View style={styles.meals}>
      {meals.map((meal) => (
        <View
          key={meal.meal}
          style={styles.mealRow}
          accessible
          accessibilityLabel={`${MEAL_LABELS[meal.meal]}, ${formatCalories(meal.average)} calories a day, ${Math.round(meal.share * 100)} percent`}
        >
          <View style={[styles.mealIcon, { backgroundColor: colors.surfaceMuted }]}>
            <Ionicons name={MEAL_ICONS[meal.meal]} size={14} color={colors.textSecondary} />
          </View>
          <View style={styles.mealBody}>
            <View style={styles.mealHead}>
              <Text variant="label" style={styles.flex}>
                {MEAL_LABELS[meal.meal]}
              </Text>
              <Text variant="numeric">
                {formatCalories(meal.average)}
                <Text variant="caption" color="textTertiary">
                  {` kcal · ${Math.round(meal.share * 100)}%`}
                </Text>
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
              <View style={[styles.fill, { width: `${(meal.share / top) * 100}%`, backgroundColor: colors.accent }]} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  trend: { gap: spacing.sm },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  goalLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Solid: Android draws a dashed border on one side only unreliably.
    borderTopWidth: stroke.outline,
  },
  slot: { flex: 1, alignItems: 'center', gap: spacing.xs },
  barTrack: { height: PLOT_HEIGHT, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '72%', maxWidth: 28 },
  barLabel: { fontSize: 10 },

  calendar: { gap: spacing.md },
  page: { gap: GAP },
  pageRow: { flexDirection: 'row', gap: GAP },
  pageCell: { flex: 1 },
  pageSquare: {
    aspectRatio: 1,
    maxHeight: 40,
    borderRadius: radius.sm,
    borderWidth: stroke.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stripRow: { flexDirection: 'row' },
  weekdayColumn: { width: 18, marginRight: spacing.xs, paddingTop: 14 + spacing.xs, gap: GAP },
  weekdayCell: { height: CELL, justifyContent: 'center' },
  monthRow: { flexDirection: 'row', gap: GAP, height: 14, marginBottom: spacing.xs },
  monthCell: { width: CELL, overflow: 'visible' },
  strip: { flexDirection: 'row', gap: GAP },
  stripColumn: { gap: GAP },
  stripCell: { width: CELL, height: CELL, borderRadius: 3, borderWidth: stroke.outline },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  swatch: { width: 10, height: 10, borderRadius: 3 },

  split: { gap: spacing.sm },
  splitBar: { flexDirection: 'row', height: 10, borderRadius: radius.pill, overflow: 'hidden', gap: 2 },
  goalBar: { height: 4 },
  splitLegend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  splitItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },

  meals: { gap: spacing.md },
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mealIcon: { width: 28, height: 28, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  mealBody: { flex: 1, gap: 6 },
  mealHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
});
