/**
 * Adding food to a meal: every way in, on one screen.
 *
 * The order is the order of how often each is the right answer. Most of a
 * diary is food eaten before, so Recent is what opens, and each of its rows has
 * a one-tap add at the amount used last time. Searching is next, and covers the
 * user's own foods, then USDA's generic foods and OpenFoodFacts' products. The
 * four tiles under the search bar are the other ways: scan a barcode, describe
 * or photograph the meal for an AI estimate, type the figures in, or make a food.
 *
 * In template mode (`for=template`) the same screen picks a food for a template
 * instead of logging it. Nothing is logged, the quick-add buttons are hidden,
 * and choosing a food goes to the portion screen, which hands the item back.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  MEALS,
  MEAL_LABELS,
  formatQuantity,
  itemTotals,
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
import { FoodRow } from '@/features/nutrition/components/food-row';
import { describeDay, todayIso } from '@/features/nutrition/dates';
import { useFoodDraft, type LogTarget } from '@/features/nutrition/draft';
import { nutritionApi } from '@/features/nutrition/api';
import {
  describeError,
  invalidateFoods,
  useCreateEntries,
  useFavorites,
  useFoodSearch,
  useLogTemplate,
  useMyFoods,
  useRecents,
  useTemplates,
} from '@/features/nutrition/queries';
import { useDebounced } from '@/hooks/use-debounced';
import { showConfirm, showDialog } from '@/store/dialog';
import { radius, spacing, useColors } from '@/theme';

type Tab = 'recent' | 'favorites' | 'mine' | 'templates';

const SOURCE_LABELS: Record<string, string> = {
  usda: 'USDA',
  openfoodfacts: 'OpenFoodFacts',
  ai: 'AI',
  custom: 'Yours',
};

function parseMeal(value: unknown): Meal {
  return MEALS.includes(value as Meal) ? (value as Meal) : 'snacks';
}

/** "Amul · 1 cup (240 g)". The first serving is the one a food opens with. */
function foodDetail(food: Food | FoodCandidate): string {
  const serving = food.servings[0]?.label ?? '';
  return food.brand ? `${food.brand} · ${serving}` : serving;
}

export default function AddFoodScreen() {
  const params = useLocalSearchParams<{ date?: string; meal?: string; for?: string }>();
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
  const create = useCreateEntries();
  const logTemplate = useLogTemplate();

  /** Rows added from here this visit, so their button turns into a tick. */
  const [added, setAdded] = useState<Set<string>>(new Set());
  const noteAdded = useFoodDraft((state) => state.noteAdded);
  // Only what was added since this screen opened: a stale "Added" from the
  // last visit would claim something this visit did not do.
  const [openedAt] = useState(() => Date.now());
  const lastAdded = useFoodDraft((state) => (state.lastAdded && state.lastAdded.at >= openedAt ? state.lastAdded : null));

  const markAdded = (key: string, name: string) => {
    setAdded((prev) => new Set(prev).add(key));
    noteAdded(`${name} to ${MEAL_LABELS[meal]}`);
  };

  const pickFood = (food: Food | FoodCandidate) => {
    haptics.selection();
    useFoodDraft
      .getState()
      .setPortion(forTemplate ? { kind: 'template-item', food, item: null, index: null } : { kind: 'food', food, target });
    router.push('/food/portion');
  };

  const pickRecent = (item: RecentItem) => {
    haptics.selection();
    const { lastLoggedAt: _at, timesLogged: _times, ...entryItem } = item;
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

  const quickLog = async (key: string, item: RecentItem) => {
    const { lastLoggedAt: _at, timesLogged: _times, ...entryItem } = item;
    try {
      await create.mutateAsync({ date, meal, items: [entryItem] });
      haptics.logged();
      markAdded(key, item.name);
    } catch (error) {
      haptics.rejected();
      await showDialog({ title: 'Could not add', message: describeError(error) });
    }
  };

  const addTemplate = async (template: MealTemplate) => {
    try {
      await logTemplate.mutateAsync({ id: template.id, input: { date, meal } });
      haptics.logged();
      markAdded(`template:${template.id}`, template.name);
    } catch (error) {
      haptics.rejected();
      await showDialog({ title: 'Could not add', message: describeError(error) });
    }
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
            placeholder="Search foods, brands, barcodes"
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
          </View>
        ) : null}

        {searching ? (
          <SearchResults
            loading={search.isFetching}
            error={search.isError ? describeError(search.error) : null}
            result={search.data}
            onPick={pickFood}
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
                <Card padded={false} style={styles.card}>
                  {recents.data?.map((item, index) => {
                    const key = `recent:${item.name}:${item.servingLabel}`;
                    return (
                      <View key={key}>
                        {index > 0 ? <Divider inset={spacing.lg} /> : null}
                        <FoodRow
                          name={item.name}
                          detail={`${item.quantity === 1 ? item.servingLabel : `${formatQuantity(item.quantity)} × ${item.servingLabel}`}${item.timesLogged > 1 ? ` · ${item.timesLogged}×` : ''}`}
                          nutrients={itemTotals(item)}
                          onPress={() => pickRecent(item)}
                          trailing={
                            forTemplate
                              ? undefined
                              : {
                                  icon: 'add',
                                  label: `Add ${item.name} to ${MEAL_LABELS[meal]}`,
                                  done: added.has(key),
                                  onPress: () => void quickLog(key, item),
                                }
                          }
                        />
                      </View>
                    );
                  })}
                </Card>
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
                          done: added.has(`template:${template.id}`),
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
}: {
  query: ReturnType<typeof useMyFoods>;
  emptyIcon: keyof typeof Ionicons.glyphMap;
  emptyTitle: string;
  emptyText: string;
  onPick: (food: Food) => void;
  onLongPress: (food: Food) => void;
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
  onPick,
  onCreate,
}: {
  loading: boolean;
  error: string | null;
  result: ReturnType<typeof useFoodSearch>['data'];
  onPick: (food: Food | FoodCandidate) => void;
  onCreate: () => void;
}) {
  const colors = useColors();

  if (!result && loading) {
    return (
      <View style={styles.state}>
        <ActivityIndicator />
        <Text variant="caption" color="textTertiary">
          Searching your foods, USDA and OpenFoodFacts
        </Text>
      </View>
    );
  }
  if (!result && error) return <EmptyState icon="cloud-offline-outline" title="Search failed" description={error} />;
  if (!result) return null;

  const nothing = result.mine.length === 0 && result.external.length === 0;

  return (
    <View style={styles.results}>
      {loading ? <ActivityIndicator style={styles.inlineSpinner} /> : null}

      {result.mine.length > 0 ? (
        <View style={styles.group}>
          <Text variant="overline" color="textTertiary" style={styles.groupTitle}>
            Your foods
          </Text>
          <Card padded={false} style={styles.card}>
            {result.mine.map((food, index) => (
              <View key={food.id}>
                {index > 0 ? <Divider inset={spacing.lg} /> : null}
                <FoodRow
                  name={food.name}
                  detail={foodDetail(food)}
                  nutrients={food.servings[0]?.nutrients ?? {}}
                  badge={food.isFavorite ? <Ionicons name="star" size={12} color={colors.record} /> : undefined}
                  onPress={() => onPick(food)}
                />
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {result.external.length > 0 ? (
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

      {result.unavailable.length > 0 ? (
        <Text variant="caption" color="textTertiary" align="center">
          {result.unavailable.map((source) => SOURCE_LABELS[source] ?? source).join(' and ')} did not answer, so
          these results may be incomplete.
        </Text>
      ) : null}

      {nothing ? (
        <EmptyState
          icon="search-outline"
          title="No matches"
          description="Try fewer words, or make it yourself. An AI estimate works for home cooking too."
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
});
