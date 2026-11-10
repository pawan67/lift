/**
 * The coach's food cards: a stretch of days against the calorie goal, and one
 * day as it was eaten.
 *
 * Like the exercise card, each is drawn from the user's own data, fetched here,
 * not from figures the model wrote: the model only names the window or the
 * day. They reuse the food tab's own pieces (the calorie ring, the macro bars,
 * the statistics chart) so a day reads the same in the chat as in the diary,
 * and a tap opens the screen they come from.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  bucketDays,
  bucketSizeFor,
  formatCalories,
  groupByMeal,
  MEAL_LABELS,
  MEALS,
  shiftIsoDate,
  totalsOf,
} from '@lift/shared';
import { format, parseISO } from 'date-fns';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { CalorieTrend } from '@/features/nutrition/components/stats';
import { CalorieRing, MACROS, MacroBar, macroColors } from '@/features/nutrition/components/summary';
import { todayIso } from '@/features/nutrition/dates';
import { describeError, useDiaryDay, useNutritionProfile, useNutritionStats, useSignedIn } from '@/features/nutrition/queries';
import { spacing, useColors } from '@/theme';

/** Calories a day against the goal over the last `days` days, with the macro averages. */
export function NutritionCard({ days }: { days: number }) {
  const colors = useColors();
  const tint = macroColors(colors);
  const { signedIn, pending } = useSignedIn();
  const today = todayIso();
  const from = shiftIsoDate(today, -(days - 1));
  const stats = useNutritionStats(from, today, today);
  const data = stats.data && stats.data.from === from ? stats.data : null;
  const size = bucketSizeFor(days);
  const buckets = useMemo(() => (data ? bucketDays(data.daily, data.from, data.to, size) : []), [data, size]);

  if (!pending && !signedIn) return <Note text="Sign in from Profile to see your food diary here." />;
  if (stats.isError && !data) return <Note text={describeError(stats.error)} />;
  if (!data) return <Note text="Reading your food diary…" />;
  if (data.daysLogged === 0) return <Note text={`Nothing logged in the last ${days} days.`} />;

  const goals = data.goals;
  const facts = [
    `${formatCalories(data.averages.calories)} kcal a day`,
    data.adherence ? `${data.adherence.on} of ${data.daysCounted} on target` : null,
    `${data.daysLogged} of ${data.days} days logged`,
  ].filter(Boolean);

  return (
    <Card onPress={() => router.push('/food/stats')} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.title}>
          <Text variant="bodyMedium">{days === 7 ? 'Your last week of eating' : `Your last ${days} days of eating`}</Text>
          <Text variant="caption" color="textSecondary">
            {facts.join(' · ')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </View>
      <CalorieTrend buckets={buckets} size={size} goal={goals.calories} />
      <View style={styles.bars}>
        {MACROS.map((macro) => (
          <MacroBar
            key={macro.key}
            label={`${macro.label}, a day`}
            value={data.averages[macro.key] ?? 0}
            goal={goals[macro.key]}
            color={tint[macro.key]}
          />
        ))}
      </View>
    </Card>
  );
}

/** One day of the diary: calories and macros against the goals, and what each meal held. */
export function FoodDayCard({ date }: { date: string | null }) {
  const colors = useColors();
  const tint = macroColors(colors);
  const { signedIn, pending } = useSignedIn();
  const today = todayIso();
  const day = date && date <= today ? date : today;
  const diary = useDiaryDay(day);
  const profile = useNutritionProfile();
  const entries = useMemo(() => (diary.data?.date === day ? diary.data.entries : null), [diary.data, day]);
  const totals = useMemo(() => totalsOf(entries ?? []), [entries]);
  const byMeal = useMemo(() => groupByMeal(entries ?? []), [entries]);

  if (!pending && !signedIn) return <Note text="Sign in from Profile to see your food diary here." />;
  if (diary.isError && !entries) return <Note text={describeError(diary.error)} />;
  if (!entries) return <Note text="Reading your food diary…" />;

  const label = day === today ? 'Today' : day === shiftIsoDate(today, -1) ? 'Yesterday' : format(parseISO(day), 'EEEE d MMMM');
  if (entries.length === 0) return <Note text={`${label}: nothing logged.`} />;

  const goals = profile.data?.goals.targets ?? {};

  return (
    <Card onPress={() => router.push('/food/stats')} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.title}>
          <Text variant="bodyMedium">{label}</Text>
          <Text variant="caption" color="textSecondary">
            {`${entries.length} ${entries.length === 1 ? 'food' : 'foods'} logged${day === today ? ' so far' : ''}`}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </View>

      <View style={styles.summary}>
        <CalorieRing eaten={totals.calories ?? 0} goal={goals.calories} size={112} />
        <View style={styles.bars}>
          {MACROS.map((macro) => (
            <MacroBar key={macro.key} label={macro.label} value={totals[macro.key] ?? 0} goal={goals[macro.key]} color={tint[macro.key]} />
          ))}
        </View>
      </View>

      <View style={styles.meals}>
        {MEALS.filter((meal) => byMeal[meal].length > 0).map((meal) => (
          <View key={meal} style={styles.meal}>
            <View style={styles.mealHead}>
              <Text variant="label" style={styles.title}>
                {MEAL_LABELS[meal]}
              </Text>
              <Text variant="caption" color="textSecondary">
                {formatCalories(totalsOf(byMeal[meal]).calories)} kcal
              </Text>
            </View>
            <Text variant="caption" color="textTertiary" numberOfLines={2}>
              {byMeal[meal].map((entry) => entry.name).join(', ')}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

function Note({ text }: { text: string }) {
  return (
    <Card>
      <Text variant="caption" color="textTertiary">
        {text}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, gap: 2 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  bars: { flex: 1, gap: spacing.sm },
  meals: { gap: spacing.sm },
  meal: { gap: 2 },
  mealHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
});
