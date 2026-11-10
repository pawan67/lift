/**
 * The food diary: one day, its four meals, and how it stands against the goals.
 *
 * Everything on it is a step away from the day's two commonest acts, which are
 * adding something to a meal and repeating what was eaten before. So every
 * meal has its own add button, a long press on any entry offers copy and
 * delete, a meal's menu copies or templates the whole meal, and an empty day
 * offers to copy yesterday.
 *
 * Paging between days keeps the previous one on screen until the next arrives
 * (see `useDiaryDay`), so moving through the week never flashes an empty diary.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  CORE_NUTRIENT_KEYS,
  MEALS,
  MEAL_LABELS,
  formatCalories,
  formatNutrientValue,
  formatQuantity,
  groupByMeal,
  itemTotals,
  nutrientDefinitions,
  totalsOf,
  type FoodEntry,
  type Meal,
  type NutrientValues,
} from '@lift/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { parseISO, format } from 'date-fns';

import {
  Button,
  Card,
  Divider,
  EmptyState,
  IconButton,
  Screen,
  Text,
  useScrollEdge,
} from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { FoodRow } from '@/features/nutrition/components/food-row';
import { DaySummaryPanel } from '@/features/nutrition/components/summary';
import { describeDay, describeDayInline, shiftIso, todayIso, weekEnding } from '@/features/nutrition/dates';
import { useFoodDraft } from '@/features/nutrition/draft';
import {
  describeError,
  useCopyEntries,
  useDeleteEntries,
  useDiaryDay,
  useNutritionProfile,
  useSignedIn,
  useSummary,
} from '@/features/nutrition/queries';
import { showConfirm, showDialog } from '@/store/dialog';
import { HIT_SLOP, radius, spacing, useColors } from '@/theme';

const MEAL_ICONS: Record<Meal, keyof typeof Ionicons.glyphMap> = {
  breakfast: 'sunny-outline',
  lunch: 'restaurant-outline',
  dinner: 'moon-outline',
  snacks: 'cafe-outline',
};

function entryDetail(entry: FoodEntry): string {
  const amount = entry.quantity === 1 ? entry.servingLabel : `${formatQuantity(entry.quantity)} × ${entry.servingLabel}`;
  return entry.brand ? `${entry.brand} · ${amount}` : amount;
}

export default function FoodScreen() {
  const { signedIn, pending } = useSignedIn();
  const scrollEdge = useScrollEdge();

  if (pending) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (!signedIn) {
    return (
      <Screen>
        <View style={styles.centered}>
          <EmptyState
            icon="nutrition-outline"
            title="Sign in to track food"
            description="Your food diary is kept on your account so it is on every device, including the web app. Training stays on this phone either way."
            action={<Button title="Sign in" icon="log-in-outline" onPress={() => router.push('/sign-in')} />}
          />
        </View>
      </Screen>
    );
  }

  return <Diary scrollEdge={scrollEdge} />;
}

function Diary({ scrollEdge }: { scrollEdge: ReturnType<typeof useScrollEdge> }) {
  const colors = useColors();
  const today = todayIso();
  const [date, setDate] = useState(today);

  const day = useDiaryDay(date);
  const profile = useNutritionProfile();
  // The strip shows the selected day with a few days either side, but never
  // runs past today unless the selected day already has.
  const weekEnd = date > today ? date : shiftIso(date, 3) < today ? shiftIso(date, 3) : today;
  const week = weekEnding(weekEnd);
  const summary = useSummary(week[0]!, week[6]!);

  const entries = useMemo(() => day.data?.entries ?? [], [day.data]);
  const byMeal = useMemo(() => groupByMeal(entries), [entries]);
  const totals = useMemo(() => totalsOf(entries), [entries]);
  const targets = profile.data?.goals.targets ?? {};
  const customNutrients = profile.data?.customNutrients ?? [];

  const copy = useCopyEntries();
  const remove = useDeleteEntries(date);
  const [showAllNutrients, setShowAllNutrients] = useState(false);

  const addTo = (meal: Meal) => {
    haptics.added();
    router.push({ pathname: '/food/add', params: { date, meal } });
  };

  const openEntry = (entry: FoodEntry) => {
    useFoodDraft.getState().setPortion({ kind: 'entry', entry });
    router.push('/food/portion');
  };

  const copyTo = async (input: Parameters<typeof copy.mutateAsync>[0], doneLabel: string) => {
    try {
      await copy.mutateAsync(input);
      haptics.logged();
      if (input.to.date !== date) {
        await showDialog({
          title: doneLabel,
          actions: [
            { label: 'Stay here', style: 'cancel' },
            { label: `Go to ${describeDayInline(input.to.date)}`, style: 'default', onPress: () => setDate(input.to.date) },
          ],
        });
      }
    } catch (error) {
      haptics.rejected();
      await showDialog({ title: 'Could not copy', message: describeError(error) });
    }
  };

  /** The other place an entry is most likely to be wanted: today, or tomorrow when already on today. */
  const copyTarget = date === today ? shiftIso(today, 1) : today;

  const entryMenu = async (entry: FoodEntry) => {
    haptics.selection();
    const otherMeals = MEALS.filter((meal) => meal !== entry.meal);
    await showDialog({
      title: entry.name,
      message: `${formatCalories(itemTotals(entry).calories)} kcal · ${entryDetail(entry)}`,
      actions: [
        { label: 'Edit amount', onPress: () => openEntry(entry) },
        {
          label: `Copy to ${describeDayInline(copyTarget)}`,
          onPress: () => void copyTo({ ids: [entry.id], to: { date: copyTarget } }, 'Copied'),
        },
        {
          label: 'Copy to another meal',
          onPress: () =>
            void showDialog({
              title: 'Copy to which meal?',
              actions: [
                ...otherMeals.map((meal) => ({
                  label: MEAL_LABELS[meal],
                  onPress: () => void copyTo({ ids: [entry.id], to: { date, meal } }, 'Copied'),
                })),
                { label: 'Cancel', style: 'cancel' as const },
              ],
            }),
        },
        {
          label: 'Delete',
          style: 'destructive',
          onPress: () => {
            haptics.destructive();
            remove.mutate([entry.id]);
          },
        },
        { label: 'Cancel', style: 'cancel' },
      ],
    });
  };

  const mealMenu = async (meal: Meal) => {
    const list = byMeal[meal];
    haptics.selection();
    await showDialog({
      title: MEAL_LABELS[meal],
      actions: [
        {
          label: `Copy to ${describeDayInline(copyTarget)}`,
          onPress: () => void copyTo({ from: { date, meal }, to: { date: copyTarget, meal } }, `${MEAL_LABELS[meal]} copied`),
        },
        {
          label: 'Save as template',
          onPress: () => router.push({ pathname: '/food/template', params: { fromDate: date, fromMeal: meal } }),
        },
        {
          label: `Delete ${list.length === 1 ? 'entry' : `all ${list.length}`}`,
          style: 'destructive',
          onPress: () =>
            void showConfirm({
              title: `Clear ${MEAL_LABELS[meal].toLowerCase()}?`,
              message: `Removes ${list.length === 1 ? 'its one entry' : `all ${list.length} entries`} from ${describeDayInline(date)}.`,
              confirmLabel: 'Delete',
            }).then((ok) => {
              if (!ok) return;
              haptics.destructive();
              remove.mutate(list.map((entry) => entry.id));
            }),
        },
        { label: 'Cancel', style: 'cancel' },
      ],
    });
  };

  const yesterday = shiftIso(date, -1);
  const summaryByDate = new Map((summary.data ?? []).map((d) => [d.date, d]));

  return (
    <Screen scrolled={scrollEdge.progress}>
      <ScrollView
        {...scrollEdge.list}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={day.isRefetching && !day.isPlaceholderData}
            onRefresh={() => void Promise.all([day.refetch(), profile.refetch(), summary.refetch()])}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {/* Day switcher */}
        <View style={styles.dayBar}>
          <IconButton
            name="chevron-back"
            accessibilityLabel="Previous day"
            onPress={() => {
              haptics.selection();
              setDate(shiftIso(date, -1));
            }}
          />
          <Pressable
            onPress={() => date !== today && setDate(today)}
            style={styles.dayTitle}
            accessibilityRole="button"
            accessibilityLabel={`${describeDay(date)}${date !== today ? ', tap to go to today' : ''}`}
          >
            <Text variant="heading">{describeDay(date)}</Text>
            {date !== today ? (
              <Text variant="caption" color="accent">
                Back to today
              </Text>
            ) : (
              <Text variant="caption" color="textTertiary">
                {format(parseISO(date), 'EEEE, d MMMM')}
              </Text>
            )}
          </Pressable>
          <IconButton
            name="chevron-forward"
            accessibilityLabel="Next day"
            onPress={() => {
              haptics.selection();
              setDate(shiftIso(date, 1));
            }}
          />
        </View>

        {/* Week strip */}
        <View style={styles.week}>
          {week.map((iso) => {
            const daySummary = summaryByDate.get(iso);
            const goal = targets.calories;
            const fraction = daySummary && goal ? Math.min(daySummary.calories / goal, 1) : daySummary ? 1 : 0;
            const selected = iso === date;
            const over = !!goal && !!daySummary && daySummary.calories > goal * 1.05;
            return (
              <Pressable
                key={iso}
                onPress={() => {
                  haptics.selection();
                  setDate(iso);
                }}
                style={[styles.weekDay, selected && { backgroundColor: colors.surfaceMuted }]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${describeDay(iso)}${daySummary ? `, ${formatCalories(daySummary.calories)} calories` : ', nothing logged'}`}
              >
                <Text variant="caption" color={selected ? 'text' : 'textTertiary'}>
                  {format(parseISO(iso), 'EEEEE')}
                </Text>
                <Text variant="label" color={iso === today ? 'accent' : selected ? 'text' : 'textSecondary'}>
                  {format(parseISO(iso), 'd')}
                </Text>
                <View style={[styles.weekTrack, { backgroundColor: colors.surfaceMuted }]}>
                  <View
                    style={[
                      styles.weekFill,
                      {
                        height: `${fraction * 100}%`,
                        backgroundColor: over ? colors.danger : colors.accent,
                        opacity: iso > today ? 0 : 1,
                      },
                    ]}
                  />
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.section}>
          <DaySummaryPanel totals={totals} targets={targets} />
          {!targets.calories && profile.isSuccess ? (
            <Pressable onPress={() => router.push('/food/goals')} style={styles.goalHint} accessibilityRole="button">
              <Ionicons name="flag-outline" size={14} color={colors.accent} />
              <Text variant="caption" color="accent">
                Set daily goals to see what is left
              </Text>
            </Pressable>
          ) : null}
        </View>

        {day.isError && !day.data ? (
          <Card style={styles.section}>
            <Text variant="bodyMedium">Could not load this day</Text>
            <Text variant="caption" color="textSecondary" style={styles.errorText}>
              {describeError(day.error)}
            </Text>
            <Button title="Try again" variant="secondary" size="sm" onPress={() => void day.refetch()} />
          </Card>
        ) : null}

        {MEALS.map((meal) => {
          const list = byMeal[meal];
          const mealTotals = totalsOf(list);
          return (
            <View key={meal} style={styles.meal}>
              <View style={styles.mealHead}>
                <View style={[styles.mealIcon, { backgroundColor: colors.surfaceMuted }]}>
                  <Ionicons name={MEAL_ICONS[meal]} size={16} color={colors.textSecondary} />
                </View>
                <View style={styles.mealTitle}>
                  <Text variant="subheading">{MEAL_LABELS[meal]}</Text>
                  {list.length > 0 ? (
                    <Text variant="caption" color="textTertiary">
                      {formatCalories(mealTotals.calories)} kcal · P {Math.round(mealTotals.protein ?? 0)} · C{' '}
                      {Math.round(mealTotals.carbs ?? 0)} · F {Math.round(mealTotals.fat ?? 0)}
                    </Text>
                  ) : null}
                </View>
                {list.length > 0 ? (
                  <IconButton
                    name="ellipsis-horizontal"
                    accessibilityLabel={`${MEAL_LABELS[meal]} options`}
                    onPress={() => void mealMenu(meal)}
                  />
                ) : null}
                <Pressable
                  onPress={() => addTo(meal)}
                  hitSlop={HIT_SLOP}
                  style={({ pressed }) => [
                    styles.addButton,
                    { backgroundColor: pressed ? colors.accentPressed : colors.accent },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Add food to ${MEAL_LABELS[meal]}`}
                >
                  <Ionicons name="add" size={20} color={colors.textOnAccent} />
                </Pressable>
              </View>

              {list.length > 0 ? (
                <Card padded={false} style={styles.mealCard}>
                  {list.map((entry, index) => (
                    <View key={entry.id}>
                      {index > 0 ? <Divider inset={spacing.lg} /> : null}
                      <FoodRow
                        name={entry.name}
                        detail={entryDetail(entry)}
                        nutrients={itemTotals(entry)}
                        badge={
                          entry.source === 'ai' ? (
                            <Ionicons name="sparkles" size={12} color={colors.textTertiary} />
                          ) : undefined
                        }
                        onPress={() => openEntry(entry)}
                        onLongPress={() => void entryMenu(entry)}
                        accessibilityHint="Opens the amount. Long press for copy and delete."
                      />
                    </View>
                  ))}
                </Card>
              ) : null}
            </View>
          );
        })}

        {entries.length === 0 && day.isSuccess && !day.isPlaceholderData ? (
          <View style={styles.emptyActions}>
            <Button
              title={`Copy ${describeDayInline(yesterday)}`}
              icon="copy-outline"
              variant="secondary"
              loading={copy.isPending}
              onPress={() =>
                void copyTo({ from: { date: yesterday }, to: { date } }, 'Copied').then(() => undefined)
              }
            />
            <Button
              title="Templates"
              icon="albums-outline"
              variant="ghost"
              onPress={() => router.push('/food/templates')}
            />
          </View>
        ) : null}

        {entries.length > 0 ? (
          <View style={styles.section}>
            <Pressable
              onPress={() => setShowAllNutrients((open) => !open)}
              style={styles.nutrientsToggle}
              accessibilityRole="button"
              accessibilityState={{ expanded: showAllNutrients }}
            >
              <Text variant="label" color="textSecondary">
                {showAllNutrients ? 'Hide nutrients' : 'All nutrients'}
              </Text>
              <Ionicons
                name={showAllNutrients ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textSecondary}
              />
            </Pressable>
            {showAllNutrients ? (
              <NutrientTable totals={totals} targets={targets} customNutrients={customNutrients} />
            ) : null}
            <Pressable
              onPress={() => router.push('/food/templates')}
              style={styles.nutrientsToggle}
              accessibilityRole="button"
            >
              <Text variant="label" color="textSecondary">
                Templates
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** Every nutrient the day has a figure or a goal for, against that goal. */
function NutrientTable({
  totals,
  targets,
  customNutrients,
}: {
  totals: NutrientValues;
  targets: NutrientValues;
  customNutrients: NonNullable<ReturnType<typeof useNutritionProfile>['data']>['customNutrients'];
}) {
  const colors = useColors();
  const rows = nutrientDefinitions(customNutrients).filter(
    (definition) =>
      !(CORE_NUTRIENT_KEYS as readonly string[]).includes(definition.key) &&
      (totals[definition.key] !== undefined || targets[definition.key] !== undefined),
  );

  if (rows.length === 0) {
    return (
      <Text variant="caption" color="textTertiary" style={styles.tableEmpty}>
        Nothing logged today lists more than calories and macros.
      </Text>
    );
  }

  return (
    <Card padded={false}>
      {rows.map((definition, index) => {
        const value = totals[definition.key];
        const goal = targets[definition.key];
        const fraction = goal ? Math.min((value ?? 0) / goal, 1) : 0;
        return (
          <View key={definition.key}>
            {index > 0 ? <Divider inset={spacing.lg} /> : null}
            <View style={styles.tableRow}>
              <Text variant="body" style={styles.tableLabel}>
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
              <View style={[styles.tableTrack, { backgroundColor: colors.surfaceMuted }]}>
                <View style={[styles.tableFill, { width: `${fraction * 100}%`, backgroundColor: colors.accent }]} />
              </View>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge, gap: spacing.lg },
  centered: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  dayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  dayTitle: { alignItems: 'center', gap: 2, flex: 1 },
  week: { flexDirection: 'row', paddingHorizontal: spacing.md, gap: spacing.xs },
  weekDay: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.sm, borderRadius: radius.md },
  weekTrack: { width: 4, height: 18, borderRadius: 2, overflow: 'hidden', justifyContent: 'flex-end' },
  weekFill: { width: '100%', borderRadius: 2 },
  section: { marginHorizontal: spacing.lg, gap: spacing.sm },
  goalHint: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'center', padding: spacing.xs },
  errorText: { marginTop: spacing.xs, marginBottom: spacing.md },
  meal: { marginHorizontal: spacing.lg, gap: spacing.sm },
  mealHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mealIcon: { width: 32, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  mealTitle: { flex: 1, gap: 1 },
  addButton: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  mealCard: { overflow: 'hidden' },
  emptyActions: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginHorizontal: spacing.lg },
  nutrientsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  tableEmpty: { paddingVertical: spacing.sm },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  tableLabel: { flex: 1 },
  tableTrack: { height: 3, marginHorizontal: spacing.lg, marginBottom: spacing.md, borderRadius: 2, overflow: 'hidden' },
  tableFill: { height: '100%', borderRadius: 2 },
});
