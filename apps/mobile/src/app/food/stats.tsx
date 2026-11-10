/**
 * Food statistics: any stretch of the diary at a glance, from one day to a
 * year, the food counterpart of the workout Statistics screen.
 *
 * The window comes first: presets from "Today" to "1 year", arrows that step
 * the same length back and forward, and a calendar for any pair of dates (see
 * `RangeBar`). Everything comes from one request, `GET /api/nutrition/stats`,
 * worked out by `buildNutritionStats` in `@lift/shared`, whose header explains
 * why averages count logged days only and leave an unfinished today out.
 *
 * A single day and a range are different questions, so they get different
 * pages. A day is read as what was eaten: its totals against the goals, the
 * macros, the meals and every food in them. A range is read for its pattern:
 * the trend against the goal (calories or any macro), a calendar of verdicts,
 * the weekday pattern, the highs and lows, and the foods eaten most.
 *
 * The header's export writes the range out as Markdown, CSV or JSON (see
 * `features/nutrition/export.ts`).
 */

import {
  CORE_NUTRIENT_KEYS,
  MEALS,
  MEAL_LABELS,
  NUTRITION_EXPORT_FORMATS,
  bucketDays,
  bucketSizeFor,
  dayExtremes,
  formatCalories,
  formatNutrientValue,
  formatQuantity,
  groupByMeal,
  itemTotals,
  nutrientDefinitions,
  totalsOf,
  weekdayAverages,
  type CustomNutrient,
  type FoodEntry,
  type FoodTally,
  type NutrientValues,
  type NutritionExportFormat,
  type NutritionStats,
} from '@lift/shared';
import { format, parseISO } from 'date-fns';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  CollapsibleSection,
  Divider,
  EmptyState,
  HeaderAction,
  OptionList,
  Reveal,
  Screen,
  SegmentedControl,
  Sheet,
  Text,
  useScrollEdge,
  useSheetLayout,
} from '@/components/ui';
import { deltaOf, SummaryGrid } from '@/features/analytics/summary-grid';
import { haptics } from '@/features/feedback/haptics';
import { AdherenceCalendar, CalorieTrend, MacroSplitBars, MealSplit, WeekdayPattern, type TrendMetric } from '@/features/nutrition/components/stats';
import { MACROS, MacroBar, macroColors } from '@/features/nutrition/components/summary';
import { RangeBar } from '@/features/nutrition/components/range-bar';
import { todayIso } from '@/features/nutrition/dates';
import { exportNutrition } from '@/features/nutrition/export';
import { describeError, useDiaryDay, useNutritionProfile, useNutritionStats, useSignedIn } from '@/features/nutrition/queries';
import { describeRange, presetRange, type FoodRange } from '@/features/nutrition/range';
import { showAlert } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

/** Rows per food ranking. The server keeps ten; five is what fits a glance. */
const TOP = 5;

/** From this many days the weekday pattern has enough of each weekday to mean something. */
const WEEKDAY_MIN_DAYS = 14;

const METRICS: { value: TrendMetric; label: string }[] = [
  { value: 'calories', label: 'Calories' },
  { value: 'protein', label: 'Protein' },
  { value: 'carbs', label: 'Carbs' },
  { value: 'fat', label: 'Fat' },
];

export default function FoodStatsScreen() {
  const { signedIn, pending } = useSignedIn();

  return (
    <Screen>
      {pending ? (
        <View style={styles.centered}>
          <Stack.Screen options={{ title: 'Food statistics' }} />
          <ActivityIndicator />
        </View>
      ) : !signedIn ? (
        <View style={styles.centered}>
          <Stack.Screen options={{ title: 'Food statistics' }} />
          <EmptyState
            icon="stats-chart-outline"
            title="Sign in to see food statistics"
            description="Your food diary is kept on your account, and so are its statistics."
            action={<Button title="Sign in" icon="log-in-outline" onPress={() => router.push('/sign-in')} />}
          />
        </View>
      ) : (
        <Statistics />
      )}
    </Screen>
  );
}

function Statistics() {
  const scrollEdge = useScrollEdge();
  const colors = useColors();
  const firstDayOfWeek = useSettings((state) => state.firstDayOfWeek);
  const today = todayIso();
  const [range, setRange] = useState<FoodRange>(() => presetRange('today', today));
  const [exporting, setExporting] = useState(false);

  const stats = useNutritionStats(range.from, range.to, today);
  const profile = useNutritionProfile();
  const customNutrients = profile.data?.customNutrients ?? [];

  // While a new range loads, the query holds the last one as a placeholder.
  // It is not drawn: figures only appear under the range they belong to.
  const data = stats.data && stats.data.from === range.from && stats.data.to === range.to ? stats.data : null;
  const single = range.from === range.to;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Food statistics',
          headerRight: () => (
            <HeaderAction label="Export" icon="share-outline" onPress={() => setExporting(true)} />
          ),
        }}
      />
      <ScrollView
        {...scrollEdge.list}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={stats.isRefetching && !stats.isPlaceholderData}
            onRefresh={() => void stats.refetch()}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <RangeBar range={range} today={today} onChange={setRange} />

        {stats.isError && !stats.data ? (
          <Card style={styles.card}>
            <Text variant="bodyMedium">Could not load statistics</Text>
            <Text variant="caption" color="textSecondary">
              {describeError(stats.error)}
            </Text>
            <Button title="Try again" variant="secondary" size="sm" onPress={() => void stats.refetch()} />
          </Card>
        ) : !data ? (
          <View style={styles.loading}>
            <ActivityIndicator />
          </View>
        ) : data.daysLogged === 0 ? (
          <EmptyState
            icon="nutrition-outline"
            title={single ? 'Nothing logged this day' : 'Nothing logged in this range'}
            description="Every day you log food shows up here: calories against your goal, macros, meals and the foods you eat most."
            action={<Button title="Open the diary" variant="secondary" onPress={() => router.back()} />}
          />
        ) : single ? (
          <DayReport stats={data} today={today} customNutrients={customNutrients} />
        ) : (
          <RangeReport stats={data} today={today} firstDayOfWeek={firstDayOfWeek} customNutrients={customNutrients} />
        )}
      </ScrollView>

      <ExportSheet
        visible={exporting}
        range={range}
        today={today}
        stats={data}
        customNutrients={customNutrients}
        onClose={() => setExporting(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// One day
// ---------------------------------------------------------------------------

function DayReport({
  stats,
  today,
  customNutrients,
}: {
  stats: NutritionStats;
  today: string;
  customNutrients: CustomNutrient[];
}) {
  const colors = useColors();
  const tint = macroColors(colors);
  const goals = stats.goals;
  const date = stats.from;
  const day = useDiaryDay(date);
  const entries = useMemo(() => (day.data?.date === date ? day.data.entries : []), [day.data, date]);
  const totals = useMemo(() => totalsOf(entries), [entries]);
  const fromStats = stats.daily[0];
  const calories = fromStats?.calories ?? totals.calories ?? 0;
  const goal = goals.calories;
  const left = goal ? goal - calories : null;
  const inProgress = date === today;
  const before = stats.previous?.averages.calories;
  const change = before !== undefined ? Math.round(calories - before) : null;

  return (
    <>
      <Reveal>
        <SummaryGrid
          items={[
            { label: inProgress ? 'Eaten so far' : 'Eaten', value: formatCalories(calories), unit: goal ? `of ${formatCalories(goal)} kcal` : 'kcal' },
            left === null
              ? { label: 'Goal', value: '–', unit: 'not set' }
              : left >= 0
                ? { label: 'Left', value: formatCalories(left), unit: 'kcal' }
                : { label: 'Over', value: formatCalories(-left), unit: 'kcal' },
            {
              label: 'Protein',
              value: String(Math.round(fromStats?.protein ?? 0)),
              unit: goals.protein ? `of ${Math.round(goals.protein)} g` : 'g',
            },
            { label: 'Foods', value: String(fromStats?.entryCount ?? entries.length), unit: 'logged' },
          ]}
        />
      </Reveal>

      {change !== null ? (
        <Text variant="caption" color="textTertiary" align="center">
          {change === 0
            ? 'The same as the day before.'
            : `${formatCalories(Math.abs(change))} kcal ${change > 0 ? 'more' : 'less'} than the day before${inProgress ? ', so far' : ''}.`}
        </Text>
      ) : null}

      <Reveal index={1}>
        <Card style={styles.card}>
          <SectionTitle title="Macros" />
          <View style={styles.macros}>
            {MACROS.map((macro) => (
              <MacroBar
                key={macro.key}
                label={macro.label}
                value={fromStats?.[macro.key] ?? 0}
                goal={goals[macro.key]}
                color={tint[macro.key]}
              />
            ))}
          </View>
          {stats.macroSplit ? (
            <>
              <Divider />
              <Text variant="overline" color="textSecondary">
                Share of calories{stats.goalSplit ? ', against your goals' : ''}
              </Text>
              <MacroSplitBars split={stats.macroSplit} goalSplit={stats.goalSplit} />
            </>
          ) : null}
        </Card>
      </Reveal>

      <Reveal index={2}>
        <Card style={styles.card}>
          <SectionTitle title="Meals" meta="calories" />
          <MealSplit meals={stats.meals} />
        </Card>
      </Reveal>

      <Reveal index={3}>
        <Card padded={false}>
          <View style={styles.listHead}>
            <SectionTitle title="What you ate" meta={format(parseISO(date), 'EEEE d MMMM')} />
          </View>
          {day.isPending && entries.length === 0 ? (
            <View style={styles.loading}>
              <ActivityIndicator />
            </View>
          ) : (
            <EatenList entries={entries} />
          )}
        </Card>
      </Reveal>

      <Reveal index={4}>
        <OtherNutrients averages={totals} targets={goals} customNutrients={customNutrients} />
      </Reveal>
    </>
  );
}

function EatenList({ entries }: { entries: FoodEntry[] }) {
  const byMeal = useMemo(() => groupByMeal(entries), [entries]);
  return (
    <View style={styles.eaten}>
      {MEALS.filter((meal) => byMeal[meal].length > 0).map((meal, mealIndex) => {
        const list = byMeal[meal];
        const subtotal = totalsOf(list).calories ?? 0;
        return (
          <View key={meal}>
            {mealIndex > 0 ? <Divider /> : null}
            <View style={styles.mealHead}>
              <Text variant="overline" color="textSecondary" style={styles.flex}>
                {MEAL_LABELS[meal]}
              </Text>
              <Text variant="caption" color="textTertiary">
                {formatCalories(subtotal)} kcal
              </Text>
            </View>
            {list.map((entry) => {
              const item = itemTotals(entry);
              return (
                <View key={entry.id} style={styles.eatenRow}>
                  <View style={styles.flex}>
                    <Text variant="body" numberOfLines={1}>
                      {entry.name}
                    </Text>
                    <Text variant="caption" color="textTertiary" numberOfLines={1}>
                      {`${formatQuantity(entry.quantity)} × ${entry.servingLabel} · P ${Math.round(item.protein ?? 0)} · C ${Math.round(item.carbs ?? 0)} · F ${Math.round(item.fat ?? 0)}`}
                    </Text>
                  </View>
                  <Text variant="numeric">{formatCalories(item.calories)}</Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// A range
// ---------------------------------------------------------------------------

function RangeReport({
  stats,
  today,
  firstDayOfWeek,
  customNutrients,
}: {
  stats: NutritionStats;
  today: string;
  firstDayOfWeek: 0 | 1;
  customNutrients: CustomNutrient[];
}) {
  const colors = useColors();
  const tint = macroColors(colors);
  const goals = stats.goals;
  const size = bucketSizeFor(stats.days);
  const buckets = useMemo(() => bucketDays(stats.daily, stats.from, stats.to, size), [stats, size]);
  const weekdays = useMemo(() => weekdayAverages(stats.daily), [stats.daily]);
  const extremes = useMemo(() => dayExtremes(stats.daily), [stats.daily]);
  const [metric, setMetric] = useState<TrendMetric>('calories');

  const average = stats.averages.calories ?? 0;
  const onTarget = stats.adherence ? stats.adherence.on : null;
  const before = stats.previous?.averages[metric];
  const metricAverage = stats.averages[metric] ?? 0;
  const change = before !== undefined ? Math.round(metricAverage - before) : null;
  const unit = metric === 'calories' ? 'kcal' : 'g';
  const showWeekdays = stats.days >= WEEKDAY_MIN_DAYS && weekdays.filter((day) => day.days > 0).length >= 3;

  return (
    <>
      <Reveal>
        <SummaryGrid
          items={[
            { label: 'Daily average', value: formatCalories(average), unit: 'kcal' },
            onTarget === null
              ? { label: 'Goal', value: '–', unit: 'not set' }
              : { label: 'On target', value: String(onTarget), unit: `of ${stats.daysCounted} days` },
            {
              label: 'Days logged',
              value: String(stats.daysLogged),
              unit: `of ${stats.days}`,
              delta: deltaOf(stats.daysLogged, stats.previous?.daysLogged ?? null, (value) => `${value} vs before`),
            },
            {
              label: 'Streak',
              value: String(stats.streak.current),
              unit: `${stats.streak.current === 1 ? 'day' : 'days'} · best ${stats.streak.longest}`,
            },
          ]}
        />
      </Reveal>

      <Reveal index={1}>
        <Card style={styles.card}>
          <SectionTitle
            title="Trend"
            meta={size === 'day' ? 'per day' : size === 'week' ? 'a day, by week' : 'a day, by month'}
          />
          <SegmentedControl
            size="sm"
            label="Chart"
            options={METRICS}
            value={metric}
            onChange={(next) => {
              haptics.selection();
              setMetric(next);
            }}
          />
          <CalorieTrend
            buckets={buckets}
            size={size}
            goal={goals[metric]}
            metric={metric}
            color={metric === 'calories' ? undefined : tint[metric]}
          />
          {change !== null ? (
            <Text variant="caption" color="textTertiary">
              {change === 0
                ? 'The same daily average as the period before.'
                : `${metric === 'calories' ? formatCalories(Math.abs(change)) : Math.abs(change)} ${unit} a day ${change > 0 ? 'more' : 'less'} than the period before.`}
            </Text>
          ) : null}
        </Card>
      </Reveal>

      <Reveal index={2}>
        <Card style={styles.card}>
          <SectionTitle
            title={goals.calories ? 'Days against the goal' : 'Days logged'}
            meta={goals.calories ? `within ${formatCalories(goals.calories * 0.9)} to ${formatCalories(goals.calories * 1.1)} kcal` : undefined}
          />
          <AdherenceCalendar
            from={stats.from}
            to={stats.to}
            today={today}
            daily={stats.daily}
            hasGoal={!!goals.calories}
            firstDayOfWeek={firstDayOfWeek}
          />
          {stats.adherence ? (
            <Text variant="caption" color="textTertiary">
              {`${stats.adherence.on} on target, ${stats.adherence.under} under, ${stats.adherence.over} over.`}
            </Text>
          ) : (
            <Button title="Set a calorie goal" icon="flag-outline" variant="ghost" size="sm" onPress={() => router.push('/food/goals')} />
          )}
        </Card>
      </Reveal>

      {extremes || showWeekdays ? (
        <Reveal index={3}>
          <Card style={styles.card}>
            <SectionTitle title="Patterns" meta={showWeekdays ? 'calories a day, by weekday' : undefined} />
            {showWeekdays ? <WeekdayPattern weekdays={weekdays} goal={goals.calories} firstDayOfWeek={firstDayOfWeek} /> : null}
            {extremes ? (
              <>
                {showWeekdays ? <Divider /> : null}
                <View style={styles.extremes}>
                  <Extreme label="Highest day" date={extremes.highest.date} calories={extremes.highest.calories} />
                  <Extreme label="Lowest day" date={extremes.lowest.date} calories={extremes.lowest.calories} />
                </View>
              </>
            ) : null}
          </Card>
        </Reveal>
      ) : null}

      <Reveal index={4}>
        <Card style={styles.card}>
          <SectionTitle title="Macros" meta="daily average" />
          <View style={styles.macros}>
            {MACROS.map((macro) => (
              <MacroBar
                key={macro.key}
                label={macro.label}
                value={stats.averages[macro.key] ?? 0}
                goal={goals[macro.key]}
                color={tint[macro.key]}
              />
            ))}
          </View>
          {stats.macroSplit ? (
            <>
              <Divider />
              <Text variant="overline" color="textSecondary">
                Share of calories{stats.goalSplit ? ', against your goals' : ''}
              </Text>
              <MacroSplitBars split={stats.macroSplit} goalSplit={stats.goalSplit} />
            </>
          ) : null}
        </Card>
      </Reveal>

      <Reveal index={5}>
        <Card style={styles.card}>
          <SectionTitle title="Meals" meta="calories a day" />
          <MealSplit meals={stats.meals} />
        </Card>
      </Reveal>

      {stats.topFoods.length > 0 ? (
        <Reveal index={6}>
          <Card padded={false}>
            <View style={styles.listHead}>
              <SectionTitle title="Most logged" />
            </View>
            {stats.topFoods.slice(0, TOP).map((food, index) => (
              <FoodLine
                key={`${food.name}-${food.brand ?? ''}`}
                food={food}
                index={index}
                figure={`${food.entries}×`}
                detail={`${food.days} ${food.days === 1 ? 'day' : 'days'} · ${formatCalories(food.calories / food.entries)} kcal each`}
              />
            ))}
          </Card>
        </Reveal>
      ) : null}

      {stats.topCalorieSources.length > 0 ? (
        <Reveal index={7}>
          <Card padded={false}>
            <View style={styles.listHead}>
              <SectionTitle title="Top calorie sources" meta="share of everything eaten" />
            </View>
            {stats.topCalorieSources.slice(0, TOP).map((food, index) => (
              <FoodLine
                key={`${food.name}-${food.brand ?? ''}`}
                food={food}
                index={index}
                figure={`${formatCalories(food.calories)} kcal`}
                detail={`${Math.round((food.calories / Math.max(1, totalCalories(stats))) * 100)}% · ${food.entries} ${food.entries === 1 ? 'time' : 'times'}`}
              />
            ))}
          </Card>
        </Reveal>
      ) : null}

      <Reveal index={8}>
        <OtherNutrients averages={stats.averages} targets={goals} customNutrients={customNutrients} />
      </Reveal>
    </>
  );
}

function Extreme({ label, date, calories }: { label: string; date: string; calories: number }) {
  return (
    <View style={styles.extreme} accessible accessibilityLabel={`${label}: ${format(parseISO(date), 'EEEE d MMMM')}, ${formatCalories(calories)} calories`}>
      <Text variant="caption" color="textTertiary">
        {label}
      </Text>
      <Text variant="numeric">
        {formatCalories(calories)}
        <Text variant="caption" color="textTertiary">
          {' kcal'}
        </Text>
      </Text>
      <Text variant="caption" color="textSecondary">
        {format(parseISO(date), 'EEE d MMM')}
      </Text>
    </View>
  );
}

/** Every calorie in the range, today included, which is what the food rankings are counted over. */
function totalCalories(stats: NutritionStats): number {
  return stats.daily.reduce((sum, day) => sum + day.calories, 0);
}

function SectionTitle({ title, meta }: { title: string; meta?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text variant="subheading">{title}</Text>
      {meta ? (
        <Text variant="caption" color="textTertiary">
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

function FoodLine({ food, index, figure, detail }: { food: FoodTally; index: number; figure: string; detail: string }) {
  return (
    <View>
      {index > 0 ? <Divider inset={spacing.lg} /> : null}
      <View style={styles.foodRow} accessible accessibilityLabel={`${food.name}${food.brand ? `, ${food.brand}` : ''}, ${figure}, ${detail}`}>
        <Text variant="label" color="textTertiary" style={styles.rank}>
          {index + 1}
        </Text>
        <View style={styles.flex}>
          <Text variant="bodyMedium" numberOfLines={1}>
            {food.name}
          </Text>
          <Text variant="caption" color="textTertiary" numberOfLines={1}>
            {food.brand ? `${food.brand} · ${detail}` : detail}
          </Text>
        </View>
        <Text variant="numeric">{figure}</Text>
      </View>
    </View>
  );
}

/**
 * Every nutrient past the core four that was logged or has a target, against
 * that target. Folded away by default: most days nobody needs the vitamins,
 * and the page reads better without them in the way. Absent when there are
 * none.
 */
function OtherNutrients({
  averages,
  targets,
  customNutrients,
}: {
  averages: NutrientValues;
  targets: NutrientValues;
  customNutrients: CustomNutrient[];
}) {
  const colors = useColors();
  const rows = nutrientDefinitions(customNutrients).filter(
    (definition) =>
      !(CORE_NUTRIENT_KEYS as readonly string[]).includes(definition.key) &&
      (averages[definition.key] !== undefined || targets[definition.key] !== undefined),
  );
  if (rows.length === 0) return null;

  return (
    <CollapsibleSection title="Other nutrients" summary={`${rows.length} tracked, from the foods that list them`}>
      <Card padded={false}>
        {rows.map((definition, index) => {
          const value = averages[definition.key];
          const goal = targets[definition.key];
          const fraction = goal ? Math.min((value ?? 0) / goal, 1) : 0;
          return (
            <View key={definition.key}>
              {index > 0 ? <Divider inset={spacing.lg} /> : null}
              <View style={styles.nutrientRow}>
                <Text variant="body" style={styles.flex}>
                  {definition.label}
                </Text>
                <Text variant="numeric" color={value === undefined ? 'textTertiary' : 'text'}>
                  {value === undefined ? '–' : formatNutrientValue(definition.key, value, customNutrients)}
                  <Text variant="caption" color="textTertiary">
                    {goal
                      ? ` / ${formatNutrientValue(definition.key, goal, customNutrients)} ${definition.unit}`
                      : ` ${definition.unit}`}
                  </Text>
                </Text>
              </View>
              {goal ? (
                <View style={[styles.nutrientTrack, { backgroundColor: colors.surfaceMuted }]}>
                  <View style={[styles.nutrientFill, { width: `${fraction * 100}%`, backgroundColor: colors.accent }]} />
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function ExportSheet({
  visible,
  range,
  today,
  stats,
  customNutrients,
  onClose,
}: {
  visible: boolean;
  range: FoodRange;
  today: string;
  stats: NutritionStats | null;
  customNutrients: CustomNutrient[];
  onClose: () => void;
}) {
  const { bottomInset } = useSheetLayout();
  const [format, setFormat] = useState<NutritionExportFormat>('markdown');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const outcome = await exportNutrition({ format, from: range.from, to: range.to, stats, customNutrients });
      haptics.added();
      onClose();
      if (outcome.kind === 'saved') {
        void showAlert('No share sheet on this device', `The file is written and waiting at:\n${outcome.uri}`);
      }
    } catch (error) {
      haptics.rejected();
      void showAlert('Export failed', describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      label={`Export: ${describeRange(range, today)}`}
      onClose={onClose}
      footer={
        <View style={[styles.exportFooter, { paddingBottom: spacing.md + bottomInset }]}>
          <Button
            title={busy ? 'Preparing…' : 'Export'}
            icon="share-outline"
            disabled={busy}
            onPress={() => void run()}
          />
        </View>
      }
    >
      <OptionList
        options={NUTRITION_EXPORT_FORMATS.map((option) => ({
          value: option.value,
          label: option.label,
          description: option.description,
        }))}
        value={format}
        onChange={setFormat}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  loading: { paddingVertical: spacing.huge, alignItems: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },
  card: { gap: spacing.md },
  sectionTitle: { gap: 2 },
  macros: { gap: spacing.md },
  listHead: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  foodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rank: { width: 16, textAlign: 'center' },
  eaten: { paddingBottom: spacing.sm },
  mealHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  eatenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  extremes: { flexDirection: 'row', gap: spacing.lg },
  extreme: { flex: 1, gap: 2 },
  nutrientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  nutrientTrack: { height: 3, marginHorizontal: spacing.lg, marginBottom: spacing.md, borderRadius: 2, overflow: 'hidden' },
  nutrientFill: { height: '100%', borderRadius: 2 },
  exportFooter: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
});
