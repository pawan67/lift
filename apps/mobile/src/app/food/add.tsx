/**
 * Adding food to a meal: every way in, on one screen.
 *
 * The order is the order of how often each is the right answer. Most of a
 * diary is food eaten before, so Recent is what opens, led by what is usually
 * eaten at this meal, and every row of food the user already has (recents,
 * favourites, their own foods) has a one-tap add: recents at the amount used
 * last time, saved foods at one serving. Searching is next. It shows matching
 * recents at once, then the user's own foods, USDA's generic foods and
 * OpenFoodFacts' products as they arrive, and offers to hand the typed words
 * to an AI estimate, since "2 rotis and dal" is a meal, not a product. The
 * four tiles under the search bar are the other ways: scan a barcode, describe
 * or photograph the meal for an AI estimate, type the figures in, or make a food.
 *
 * Every add says so in a note with Undo, so a mis-tap costs one more tap
 * rather than a trip to the diary.
 *
 * In template mode (`for=template`) the same screen picks a food for a template
 * instead of logging it. Nothing is logged, the quick-add buttons are hidden,
 * and choosing a food goes to the portion screen, which hands the item back.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  MEALS,
  MEAL_LABELS,
  describeAmount,
  itemTotals,
  matchRecents,
  mealForTime,
  recentKey,
  usualAt,
  type EntryItem,
  type Food,
  type FoodCandidate,
  type Meal,
  type MealTemplate,
  type RecentItem,
} from '@lift/shared';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Card,
  Chip,
  Divider,
  EmptyState,
  HeaderAction,
  PressableScale,
  Screen,
  SearchBar,
  SegmentedControl,
  Text,
} from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { FoodRow, type FoodRowProps } from '@/features/nutrition/components/food-row';
import { describeDay, todayIso } from '@/features/nutrition/dates';
import { useFoodDraft, type LogTarget } from '@/features/nutrition/draft';
import { nutritionApi } from '@/features/nutrition/api';
import {
  describeError,
  invalidateFoods,
  useCreateEntries,
  useDeleteEntries,
  useDiaryDay,
  useFavorites,
  useFoodSearch,
  useLogTemplate,
  useMyFoods,
  useRecents,
  useTemplates,
} from '@/features/nutrition/queries';
import { useDebounced } from '@/hooks/use-debounced';
import { showConfirm, showDialog } from '@/store/dialog';
import { HIT_SLOP, radius, spacing, useColors } from '@/theme';

type Tab = 'recent' | 'favorites' | 'mine' | 'templates';

const SOURCE_LABELS: Record<string, string> = {
  usda: 'USDA',
  openfoodfacts: 'OpenFoodFacts',
  ai: 'AI',
  custom: 'Yours',
};

/** The meal asked for, or failing that the one the time of day suggests. */
function parseMeal(value: unknown): Meal {
  return MEALS.includes(value as Meal) ? (value as Meal) : mealForTime(new Date());
}

/** A saved food as a diary item: one of its first serving, the amount it opens with. */
function servingItem(food: Food): EntryItem {
  const serving = food.servings[0]!;
  return {
    foodId: food.id,
    name: food.name,
    brand: food.brand,
    servingLabel: serving.label,
    servingGrams: serving.grams,
    nutrients: serving.nutrients,
    source: food.source,
    quantity: 1,
  };
}

/** A recent as a diary item: everything but its history. */
function recentItem(item: RecentItem): EntryItem {
  const { lastLoggedAt: _at, timesLogged: _times, meals: _meals, ...entryItem } = item;
  return entryItem;
}

function recentDetail(item: RecentItem): string {
  const amount = describeAmount(item);
  return `${amount}${item.timesLogged > 1 ? ` · ${item.timesLogged}×` : ''}`;
}

/** "Amul · 1 cup (240 g)". The first serving is the one a food opens with. */
function foodDetail(food: Food | FoodCandidate): string {
  const serving = food.servings[0]?.label ?? '';
  return food.brand ? `${food.brand} · ${serving}` : serving;
}

export default function AddFoodScreen() {
  const params = useLocalSearchParams<{ date?: string; meal?: string; for?: string; focus?: string }>();
  const forTemplate = params.for === 'template';
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayIso();
  const [meal, setMeal] = useState<Meal>(parseMeal(params.meal));
  const target: LogTarget = { date, meal };

  const colors = useColors();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 350);
  const searching = query.trim().length >= 2;
  const [tab, setTab] = useState<Tab>('recent');

  const search = useFoodSearch(searching ? debounced : '');
  const recents = useRecents();
  const favorites = useFavorites();
  const mine = useMyFoods();
  const templates = useTemplates();
  const day = useDiaryDay(date);
  const create = useCreateEntries();
  const remove = useDeleteEntries(date);
  const logTemplate = useLogTemplate();

  /** Rows added from here this visit, so their button turns into a tick. */
  const [added, setAdded] = useState<Set<string>>(new Set());
  const noteAdded = useFoodDraft((state) => state.noteAdded);
  // Only what was added since this screen opened: a stale "Added" from the
  // last visit would claim something this visit did not do.
  const [openedAt] = useState(() => Date.now());
  const lastAdded = useFoodDraft((state) => (state.lastAdded && state.lastAdded.at >= openedAt ? state.lastAdded : null));
  /** The row behind the latest one-tap add, so Undo can turn its tick back into a plus. */
  const [lastKey, setLastKey] = useState<string | null>(null);

  // Keyed by meal too: switching the meal chip and adding the same food again
  // is a second, separate add.
  const rowKey = (kind: string, id: string) => `${meal}:${kind}:${id}`;

  const markAdded = (key: string, name: string, ids?: string[]) => {
    setAdded((prev) => new Set(prev).add(key));
    setLastKey(key);
    noteAdded(`${name} to ${MEAL_LABELS[meal]}`, ids ? { date, ids } : undefined);
  };

  const undo = () => {
    const undoable = lastAdded?.undo;
    if (!undoable) return;
    haptics.destructive();
    remove.mutate(undoable.ids);
    if (lastKey) {
      setAdded((prev) => {
        const next = new Set(prev);
        next.delete(lastKey);
        return next;
      });
    }
    setLastKey(null);
    useFoodDraft.getState().clearAdded();
  };

  /** Habits for the chosen meal lead the Recent tab; what the meal already has is left out. */
  const inMeal = useMemo(
    () => new Set((day.data?.entries ?? []).filter((entry) => entry.meal === meal).map(recentKey)),
    [day.data, meal],
  );
  // A template is not a meal, so it has no habits to lead with.
  const usual = useMemo(
    () => (forTemplate ? [] : usualAt(recents.data ?? [], meal, { exclude: inMeal, limit: 5 })),
    [forTemplate, recents.data, meal, inMeal],
  );
  const others = useMemo(() => {
    const shown = new Set(usual.map(recentKey));
    return (recents.data ?? []).filter((item) => !shown.has(recentKey(item)));
  }, [recents.data, usual]);
  const recentMatches = useMemo(() => (searching ? matchRecents(recents.data ?? [], query) : []), [recents.data, query, searching]);

  const pickFood = (food: Food | FoodCandidate) => {
    haptics.selection();
    useFoodDraft
      .getState()
      .setPortion(forTemplate ? { kind: 'template-item', food, item: null, index: null } : { kind: 'food', food, target });
    router.push('/food/portion');
  };

  const pickRecent = (item: RecentItem) => {
    haptics.selection();
    const entryItem = recentItem(item);
    if (forTemplate) {
      useFoodDraft.getState().setPortion({ kind: 'template-item', food: null, item: entryItem, index: null });
    } else {
      // A recent is a snapshot, not a food: it opens as a one-serving food so
      // the portion screen can change the amount before logging.
      useFoodDraft.getState().setPortion({
        kind: 'food',
        target,
        quantity: item.quantity,
        food: {
          id: item.foodId,
          name: item.name,
          brand: item.brand,
          barcode: null,
          source: item.source,
          sourceId: null,
          isFavorite: false,
          servings: [{ id: 'logged', label: item.servingLabel, grams: item.servingGrams, nutrients: item.nutrients }],
        },
      });
    }
    router.push('/food/portion');
  };

  const quickLog = async (key: string, item: EntryItem) => {
    try {
      const created = await create.mutateAsync({ date, meal, items: [item] });
      haptics.logged();
      markAdded(
        key,
        item.name,
        created.map((entry) => entry.id),
      );
    } catch (error) {
      haptics.rejected();
      await showDialog({ title: 'Could not add', message: describeError(error) });
    }
  };

  /** The one-tap add for a row, or none in template mode where nothing is logged. */
  const recentTrailing = (key: string, item: RecentItem) =>
    forTemplate
      ? undefined
      : {
          icon: 'add' as const,
          label: `Add ${item.name} to ${MEAL_LABELS[meal]}`,
          done: added.has(key),
          onPress: () => void quickLog(key, recentItem(item)),
        };
  const foodTrailing = (food: Food) => {
    const key = rowKey('food', food.id);
    return forTemplate || !food.servings[0]
      ? undefined
      : {
          icon: 'add' as const,
          label: `Add one ${food.servings[0].label} of ${food.name} to ${MEAL_LABELS[meal]}`,
          done: added.has(key),
          onPress: () => void quickLog(key, servingItem(food)),
        };
  };

  const addTemplate = async (template: MealTemplate) => {
    try {
      const created = await logTemplate.mutateAsync({ id: template.id, input: { date, meal } });
      haptics.logged();
      markAdded(
        rowKey('template', template.id),
        template.name,
        created.map((entry) => entry.id),
      );
    } catch (error) {
      haptics.rejected();
      await showDialog({ title: 'Could not add', message: describeError(error) });
    }
  };

  const estimateQuery = () => {
    haptics.selection();
    router.push({ pathname: '/food/estimate', params: { date, meal, description: query.trim(), auto: '1' } });
  };

  const foodMenu = async (food: Food) => {
    haptics.selection();
    await showDialog({
      title: food.name,
      actions: [
        {
          label: food.isFavorite ? 'Remove from favourites' : 'Add to favourites',
          onPress: () =>
            void nutritionApi
              .updateFood(food.id, { isFavorite: !food.isFavorite })
              .then(() => invalidateFoods())
              .catch((error) => showDialog({ title: 'Could not update', message: describeError(error) })),
        },
        {
          label: 'Edit food',
          onPress: () => router.push({ pathname: '/food/create', params: { id: food.id } }),
        },
        {
          label: 'Delete food',
          style: 'destructive',
          onPress: () =>
            void showConfirm({
              title: `Delete ${food.name}?`,
              message: 'It leaves your foods. Anything already logged with it stays in your diary.',
              confirmLabel: 'Delete',
            }).then(async (ok) => {
              if (!ok) return;
              try {
                await nutritionApi.deleteFood(food.id);
                haptics.destructive();
                await invalidateFoods();
              } catch (error) {
                await showDialog({ title: 'Could not delete', message: describeError(error) });
              }
            }),
        },
        { label: 'Cancel', style: 'cancel' },
      ],
    });
  };

  const tabs = useMemo(
    () =>
      [
        { value: 'recent', label: 'Recent' },
        { value: 'favorites', label: 'Favourites' },
        { value: 'mine', label: 'My foods' },
        ...(forTemplate ? [] : [{ value: 'templates', label: 'Templates' }]),
      ] as { value: Tab; label: string }[],
    [forTemplate],
  );

  const title = forTemplate ? 'Add to template' : `Add to ${MEAL_LABELS[meal]}`;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title,
          headerRight: () =>
            lastAdded ? (
              <HeaderAction label="Done adding food" title="Done" variant="filled" onPress={() => router.back()} />
            ) : null,
        }}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.top}>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery('')}
            placeholder="Search foods, or describe a meal"
            autoFocus={params.focus === '1'}
            autoCorrect={false}
            returnKeyType="search"
          />

          {!forTemplate ? (
            <View style={styles.mealChips}>
              {MEALS.map((option) => (
                <Chip
                  key={option}
                  label={MEAL_LABELS[option]}
                  selected={meal === option}
                  onPress={() => {
                    haptics.selection();
                    setMeal(option);
                  }}
                />
              ))}
              <Text variant="caption" color="textTertiary" style={styles.dateNote}>
                {describeDay(date)}
              </Text>
            </View>
          ) : null}
        </View>

        {lastAdded ? (
          <View style={[styles.added, { backgroundColor: colors.successSurface }]} accessibilityLiveRegion="polite">
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text variant="caption" color="success" numberOfLines={1} style={styles.addedText}>
              Added {lastAdded.name}
            </Text>
            {lastAdded.undo ? (
              <Pressable
                onPress={undo}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={`Undo adding ${lastAdded.name}`}
              >
                <Text variant="label" color="success">
                  Undo
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {searching ? (
          <SearchResults
            loading={search.isFetching}
            error={search.isError ? describeError(search.error) : null}
            result={search.data}
            query={query.trim()}
            recents={recentMatches}
            onPick={pickFood}
            onPickRecent={pickRecent}
            recentTrailing={(item) => recentTrailing(rowKey('recent', recentKey(item)), item)}
            foodTrailing={foodTrailing}
            onEstimate={forTemplate ? undefined : estimateQuery}
            onCreate={() =>
              router.push({ pathname: '/food/create', params: { date, meal, name: query.trim(), ...(forTemplate ? { for: 'template' } : {}) } })
            }
          />
        ) : (
          <>
            <View style={styles.tiles}>
              <Tile
                icon="barcode-outline"
                label="Scan"
                onPress={() =>
                  router.push({ pathname: '/food/scan', params: { date, meal, ...(forTemplate ? { for: 'template' } : {}) } })
                }
              />
              {!forTemplate ? (
                <Tile
                  icon="sparkles-outline"
                  label="AI estimate"
                  accent
                  onPress={() => router.push({ pathname: '/food/estimate', params: { date, meal } })}
                />
              ) : null}
              {!forTemplate ? (
                <Tile
                  icon="flash-outline"
                  label="Quick add"
                  onPress={() => router.push({ pathname: '/food/create', params: { date, meal, mode: 'quick' } })}
                />
              ) : null}
              <Tile
                icon="create-outline"
                label="New food"
                onPress={() =>
                  router.push({ pathname: '/food/create', params: { date, meal, ...(forTemplate ? { for: 'template' } : {}) } })
                }
              />
            </View>

            <SegmentedControl options={tabs} value={tab} onChange={(next) => {
              haptics.selection();
              setTab(next);
            }} style={styles.segments} />

            {tab === 'recent' ? (
              <ListState
                loading={recents.isPending}
                error={recents.isError ? describeError(recents.error) : null}
                empty={recents.data?.length === 0}
                emptyIcon="time-outline"
                emptyTitle="Nothing logged yet"
                emptyText="Foods you log show up here, ready to add again in one tap."
              >
                {usual.length > 0 ? (
                  <View style={styles.group}>
                    <Text variant="overline" color="textTertiary" style={styles.groupTitle}>
                      Usually at {MEAL_LABELS[meal].toLowerCase()}
                    </Text>
                    <RecentList
                      items={usual}
                      onPick={pickRecent}
                      trailing={(item) => recentTrailing(rowKey('recent', recentKey(item)), item)}
                    />
                  </View>
                ) : null}
                {others.length > 0 ? (
                  <View style={styles.group}>
                    {usual.length > 0 ? (
                      <Text variant="overline" color="textTertiary" style={styles.groupTitle}>
                        Recent
                      </Text>
                    ) : null}
                    <RecentList
                      items={others}
                      onPick={pickRecent}
                      trailing={(item) => recentTrailing(rowKey('recent', recentKey(item)), item)}
                    />
                  </View>
                ) : null}
              </ListState>
            ) : null}

            {tab === 'favorites' || tab === 'mine' ? (
              <FoodList
                query={tab === 'favorites' ? favorites : mine}
                emptyIcon={tab === 'favorites' ? 'star-outline' : 'file-tray-outline'}
                emptyTitle={tab === 'favorites' ? 'No favourites yet' : 'No foods of your own yet'}
                emptyText={
                  tab === 'favorites'
                    ? 'Star a food from its amount screen, or long press one here.'
                    : 'Foods you create, scan or pick from search are kept here.'
                }
                onPick={pickFood}
                onLongPress={(food) => void foodMenu(food)}
                trailing={foodTrailing}
              />
            ) : null}

            {tab === 'templates' ? (
              <ListState
                loading={templates.isPending}
                error={templates.isError ? describeError(templates.error) : null}
                empty={templates.data?.length === 0}
                emptyIcon="albums-outline"
                emptyTitle="No templates yet"
                emptyText="Save a meal you eat often as a template from its menu in the diary, then add it here in one tap."
              >
                <Card padded={false} style={styles.card}>
                  {templates.data?.map((template, index) => (
                    <View key={template.id}>
                      {index > 0 ? <Divider inset={spacing.lg} /> : null}
                      <FoodRow
                        name={template.name}
                        detail={`${template.items.length} ${template.items.length === 1 ? 'item' : 'items'}`}
                        nutrients={sumItems(template)}
                        badge={<Ionicons name="albums-outline" size={13} color={colors.textTertiary} />}
                        onPress={() => router.push({ pathname: '/food/template', params: { id: template.id } })}
                        trailing={{
                          icon: 'add',
                          label: `Add ${template.name} to ${MEAL_LABELS[meal]}`,
                          done: added.has(rowKey('template', template.id)),
                          onPress: () => void addTemplate(template),
                        }}
                      />
                    </View>
                  ))}
                </Card>
                <Pressable onPress={() => router.push('/food/templates')} style={styles.manage} accessibilityRole="button">
                  <Text variant="label" color="accent">
                    Manage templates
                  </Text>
                </Pressable>
              </ListState>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function sumItems(template: MealTemplate) {
  const totals: Record<string, number> = {};
  for (const item of template.items) {
    for (const [key, value] of Object.entries(itemTotals(item))) totals[key] = (totals[key] ?? 0) + value;
  }
  return totals;
}

function Tile({
  icon,
  label,
  onPress,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  const colors = useColors();
  return (
    <PressableScale
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.tile,
        { backgroundColor: accent ? colors.accentSurface : colors.surface, borderColor: accent ? colors.accentSurface : colors.border },
      ]}
    >
      <Ionicons name={icon} size={22} color={accent ? colors.accent : colors.text} />
      <Text variant="caption" color={accent ? 'accent' : 'textSecondary'} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

function RecentList({
  items,
  onPick,
  trailing,
}: {
  items: RecentItem[];
  onPick: (item: RecentItem) => void;
  trailing: (item: RecentItem) => FoodRowProps['trailing'];
}) {
  return (
    <Card padded={false} style={styles.card}>
      {items.map((item, index) => (
        <View key={recentKey(item)}>
          {index > 0 ? <Divider inset={spacing.lg} /> : null}
          <FoodRow
            name={item.name}
            detail={recentDetail(item)}
            nutrients={itemTotals(item)}
            badge={item.source === 'ai' ? <SparkleBadge /> : undefined}
            onPress={() => onPick(item)}
            trailing={trailing(item)}
          />
        </View>
      ))}
    </Card>
  );
}

function SparkleBadge() {
  const colors = useColors();
  return <Ionicons name="sparkles" size={12} color={colors.textTertiary} />;
}

function ListState({
  loading,
  error,
  empty,
  emptyIcon,
  emptyTitle,
  emptyText,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyIcon: keyof typeof Ionicons.glyphMap;
  emptyTitle: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <View style={styles.state}>
        <ActivityIndicator />
      </View>
    );
  }
  if (error) {
    return <EmptyState icon="cloud-offline-outline" title="Could not load" description={error} />;
  }
  if (empty) return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyText} />;
  return <>{children}</>;
}

function FoodList({
  query,
  emptyIcon,
  emptyTitle,
  emptyText,
  onPick,
  onLongPress,
  trailing,
}: {
  query: ReturnType<typeof useMyFoods>;
  emptyIcon: keyof typeof Ionicons.glyphMap;
  emptyTitle: string;
  emptyText: string;
  onPick: (food: Food) => void;
  onLongPress: (food: Food) => void;
  trailing: (food: Food) => FoodRowProps['trailing'];
}) {
  const colors = useColors();
  return (
    <ListState
      loading={query.isPending}
      error={query.isError ? describeError(query.error) : null}
      empty={query.data?.length === 0}
      emptyIcon={emptyIcon}
      emptyTitle={emptyTitle}
      emptyText={emptyText}
    >
      <Card padded={false} style={styles.card}>
        {query.data?.map((food, index) => (
          <View key={food.id}>
            {index > 0 ? <Divider inset={spacing.lg} /> : null}
            <FoodRow
              name={food.name}
              detail={foodDetail(food)}
              nutrients={food.servings[0]?.nutrients ?? {}}
              badge={food.isFavorite ? <Ionicons name="star" size={12} color={colors.record} /> : undefined}
              onPress={() => onPick(food)}
              onLongPress={() => onLongPress(food)}
              trailing={trailing(food)}
              accessibilityHint="Long press to favourite, edit or delete."
            />
          </View>
        ))}
      </Card>
    </ListState>
  );
}

function SearchResults({
  loading,
  error,
  result,
  query,
  recents,
  onPick,
  onPickRecent,
  recentTrailing,
  foodTrailing,
  onEstimate,
  onCreate,
}: {
  loading: boolean;
  error: string | null;
  result: ReturnType<typeof useFoodSearch>['data'];
  query: string;
  /** Recents matching the query, filtered on the phone so they show before the server answers. */
  recents: RecentItem[];
  onPick: (food: Food | FoodCandidate) => void;
  onPickRecent: (item: RecentItem) => void;
  recentTrailing: (item: RecentItem) => FoodRowProps['trailing'];
  foodTrailing: (food: Food) => FoodRowProps['trailing'];
  /** Absent in template mode, where an estimate cannot be logged. */
  onEstimate?: () => void;
  onCreate: () => void;
}) {
  const colors = useColors();

  // A food already shown as a recent is listed once, as the recent: it adds at
  // the amount actually eaten, which a saved food's first serving may not be.
  const recentFoodIds = new Set(recents.map((item) => item.foodId).filter(Boolean));
  const mine = (result?.mine ?? []).filter((food) => !recentFoodIds.has(food.id));
  const nothing = !!result && recents.length === 0 && mine.length === 0 && result.external.length === 0;

  return (
    <View style={styles.results}>
      {onEstimate ? (
        <PressableScale
          onPress={onEstimate}
          accessibilityRole="button"
          accessibilityLabel={`Estimate ${query} with AI`}
          style={[styles.estimateRow, { backgroundColor: colors.accentSurface }]}
        >
          <Ionicons name="sparkles" size={18} color={colors.accent} />
          <View style={styles.estimateText}>
            <Text variant="bodyMedium" color="accent" numberOfLines={2}>
              Estimate “{query}”
            </Text>
            <Text variant="caption" color="textSecondary">
              AI works out calories and macros from your words
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.accent} />
        </PressableScale>
      ) : null}

      {recents.length > 0 ? (
        <View style={styles.group}>
          <Text variant="overline" color="textTertiary" style={styles.groupTitle}>
            Recent
          </Text>
          <RecentList items={recents} onPick={onPickRecent} trailing={recentTrailing} />
        </View>
      ) : null}

      {!result && loading ? (
        <View style={styles.state}>
          <ActivityIndicator />
          <Text variant="caption" color="textTertiary">
            Searching your foods, USDA and OpenFoodFacts
          </Text>
        </View>
      ) : null}
      {!result && error ? <EmptyState icon="cloud-offline-outline" title="Search failed" description={error} /> : null}

      {result && loading ? <ActivityIndicator style={styles.inlineSpinner} /> : null}

      {mine.length > 0 ? (
        <View style={styles.group}>
          <Text variant="overline" color="textTertiary" style={styles.groupTitle}>
            Your foods
          </Text>
          <Card padded={false} style={styles.card}>
            {mine.map((food, index) => (
              <View key={food.id}>
                {index > 0 ? <Divider inset={spacing.lg} /> : null}
                <FoodRow
                  name={food.name}
                  detail={foodDetail(food)}
                  nutrients={food.servings[0]?.nutrients ?? {}}
                  badge={food.isFavorite ? <Ionicons name="star" size={12} color={colors.record} /> : undefined}
                  onPress={() => onPick(food)}
                  trailing={foodTrailing(food)}
                />
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {result && result.external.length > 0 ? (
        <View style={styles.group}>
          <Text variant="overline" color="textTertiary" style={styles.groupTitle}>
            Food databases
          </Text>
          <Card padded={false} style={styles.card}>
            {result.external.map((food, index) => (
              <View key={`${food.source}:${food.sourceId}`}>
                {index > 0 ? <Divider inset={spacing.lg} /> : null}
                <FoodRow
                  name={food.name}
                  detail={`${SOURCE_LABELS[food.source] ?? food.source} · ${foodDetail(food)}`}
                  nutrients={food.servings[0]?.nutrients ?? {}}
                  onPress={() => onPick(food)}
                />
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {result && result.unavailable.length > 0 ? (
        <Text variant="caption" color="textTertiary" align="center">
          {result.unavailable.map((source) => SOURCE_LABELS[source] ?? source).join(' and ')} did not answer, so
          these results may be incomplete.
        </Text>
      ) : null}

      {nothing ? (
        <EmptyState
          icon="search-outline"
          title="No matches"
          description={
            onEstimate
              ? 'Try fewer words, let AI estimate it from the words above, or make it yourself.'
              : 'Try fewer words, or make it yourself.'
          }
        />
      ) : null}

      <Pressable onPress={onCreate} style={styles.manage} accessibilityRole="button">
        <Text variant="label" color="accent">
          Create a food instead
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge, gap: spacing.lg },
  top: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  mealChips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  dateNote: { marginLeft: 'auto' },
  tiles: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  segments: { marginHorizontal: spacing.lg },
  card: { marginHorizontal: spacing.lg, overflow: 'hidden' },
  state: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  results: { gap: spacing.lg },
  inlineSpinner: { alignSelf: 'center' },
  group: { gap: spacing.sm },
  groupTitle: { marginHorizontal: spacing.lg },
  manage: { alignSelf: 'center', padding: spacing.sm },
  added: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginTop: -spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  addedText: { flex: 1 },
  estimateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  estimateText: { flex: 1, gap: 2 },
});
