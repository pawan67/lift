/**
 * Food statistics: a range of the diary at a glance, the food counterpart of
 * the workout Statistics screen.
 *
 * Laid out the way the workout screens are: the range picker first, four
 * figures in the shared summary grid, then one card per question. Is the
 * eating on target (calories against the goal, as a chart and as a
 * calendar)? What is it made of (macros in grams and as a share of calories)?
 * When is it eaten (the meal split)? What is it (the foods logged most and
 * the ones that bring the most calories)? Everything comes from one request,
 * `GET /api/nutrition/stats`, worked out by `buildNutritionStats` in
 * `@lift/shared`, whose header explains why averages count logged days only
 * and leave an unfinished today out.
 *
 * "All time" is not offered: the server reads at most a year per request, and
 * a diary that is weeks old has no all-time worth a separate view.
 */

import {
  CORE_NUTRIENT_KEYS,
  bucketDays,
  bucketSizeFor,
  formatCalories,
  formatNutrientValue,
  nutrientDefinitions,
  type CustomNutrient,
  type FoodTally,
  type NutrientValues,
  type NutritionStats,
} from '@lift/shared';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Divider, EmptyState, Reveal, Screen, Text, useScrollEdge } from '@/components/ui';
import { RangePicker } from '@/features/analytics/range-picker';
import { deltaOf, SummaryGrid } from '@/features/analytics/summary-grid';
import { STAT_RANGES, type StatRange } from '@/features/analytics/windows';
import { haptics } from '@/features/feedback/haptics';
import { shiftIso, todayIso } from '@/features/nutrition/dates';
import { describeError, useNutritionProfile, useNutritionStats, useSignedIn } from '@/features/nutrition/queries';
import { MACROS, MacroBar, macroColors } from '@/features/nutrition/components/summary';
import { AdherenceCalendar, CalorieTrend, MacroSplitBars, MealSplit } from '@/features/nutrition/components/stats';
import { useSettings } from '@/store/settings';
import { spacing, useColors } from '@/theme';

/** The workout ranges, less "All time". See the note at the top. */
const RANGES: readonly StatRange[] = ['7d', '30d', '3m', '1y'];

/** Rows per food ranking. The server keeps ten; five is what fits a glance. */
const TOP = 5;

export default function FoodStatsScreen() {
  const { signedIn, pending } = useSignedIn();

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Food statistics' }} />
      {pending ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : !signedIn ? (
        <View style={styles.centered}>
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
  const [range, setRange] = useState<StatRange>('30d');

  const today = todayIso();
  const days = STAT_RANGES.find((option) => option.value === range)?.days ?? 30;
  const from = shiftIso(today, -(days - 1));

  const stats = useNutritionStats(from, today, today);
  const profile = useNutritionProfile();
  const customNutrients = profile.data?.customNutrients ?? [];

  // While a new range loads, the query holds the last one as a placeholder.
  // It is not drawn: like the workout screens, figures only appear under the
  // range they belong to.
  const data = stats.data && stats.data.from === from ? stats.data : null;

  return (
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
      <RangePicker
        value={range}
        options={RANGES}
        onChange={(next) => {
          haptics.selection();
          setRange(next);
        }}
      />

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
          title="Nothing logged in this range"
          description="Every day you log food shows up here: calories against your goal, macros, meals and the foods you eat most."
          action={<Button title="Open the diary" variant="secondary" onPress={() => router.back()} />}
        />
      ) : (
        <Report stats={data} today={today} firstDayOfWeek={firstDayOfWeek} customNutrients={customNutrients} />
      )}
    </ScrollView>
  );
}

function Report({
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

  const average = stats.averages.calories ?? 0;
  const onTarget = stats.adherence ? stats.adherence.on : null;
  const before = stats.previous?.averages.calories;
  const change = before !== undefined ? Math.round(average - before) : null;

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
            title="Calories"
            meta={size === 'day' ? 'per day' : size === 'week' ? 'a day, by week' : 'a day, by month'}
          />
          <CalorieTrend buckets={buckets} size={size} goal={goals.calories} />
          {change !== null ? (
            <Text variant="caption" color="textTertiary">
              {change === 0
                ? 'The same daily average as the period before.'
                : `${formatCalories(Math.abs(change))} kcal a day ${change > 0 ? 'more' : 'less'} than the period before.`}
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
          {!goals.calories ? (
            <Button title="Set a calorie goal" icon="flag-outline" variant="ghost" size="sm" onPress={() => router.push('/food/goals')} />
          ) : null}
        </Card>
      </Reveal>

      <Reveal index={3}>
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

      <Reveal index={4}>
        <Card style={styles.card}>
          <SectionTitle title="Meals" meta="calories a day" />
          <MealSplit meals={stats.meals} />
        </Card>
      </Reveal>

      {stats.topFoods.length > 0 ? (
        <Reveal index={5}>
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
        <Reveal index={6}>
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

      <Reveal index={7}>
        <OtherNutrients averages={stats.averages} targets={goals} customNutrients={customNutrients} />
      </Reveal>
    </>
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
 * The daily average of every nutrient past the core four that was logged or
 * has a target, against that target. Absent when there are none, rather than
 * a card that says so.
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
    <Card padded={false}>
      <View style={styles.listHead}>
        <SectionTitle title="Other nutrients" meta="daily average, from the foods that list them" />
      </View>
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
  nutrientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  nutrientTrack: { height: 3, marginHorizontal: spacing.lg, marginBottom: spacing.md, borderRadius: 2, overflow: 'hidden' },
  nutrientFill: { height: '100%', borderRadius: 2 },
});
