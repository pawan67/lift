/**
 * Builds or edits a template.
 *
 * Three ways in: `id` edits a saved one, `fromDate` + `fromMeal` starts from a
 * meal already in the diary ("save this breakfast"), and no params starts
 * empty. The second is the one that matters most: nobody wants to rebuild a
 * meal they have just logged, so the diary hands over its entries as they are.
 *
 * Items are added and edited through the shared add and portion screens rather
 * than a picker of this screen's own. The portion screen leaves its result in
 * `useFoodDraft().templateResult`, and this screen collects it when it is
 * focused again, so the round trip needs no callback threaded through routes.
 */

import {
  MEALS,
  MEAL_LABELS,
  formatCalories,
  describeAmount,
  itemTotals,
  totalsOf,
  type EntryItem,
  type Meal,
  type MealTemplate,
} from '@lift/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseISO, format } from 'date-fns';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  EmptyState,
  HeaderAction,
  Screen,
  SectionHeader,
  SegmentedControl,
  Text,
  TextField,
  useScrollEdge,
} from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { nutritionApi } from '@/features/nutrition/api';
import { FoodRow } from '@/features/nutrition/components/food-row';
import { macroColors } from '@/features/nutrition/components/summary';
import { todayIso } from '@/features/nutrition/dates';
import { useFoodDraft } from '@/features/nutrition/draft';
import { describeError, nutritionKeys, useSignedIn, useTemplates } from '@/features/nutrition/queries';
import { showAlert, showConfirm } from '@/store/dialog';
import { spacing, useColors } from '@/theme';

type MealChoice = Meal | 'any';

const MEAL_OPTIONS: readonly { value: MealChoice; label: string }[] = [
  { value: 'any', label: 'Any' },
  ...MEALS.map((meal) => ({ value: meal, label: MEAL_LABELS[meal] })),
];

/** An entry, reduced to what a template keeps: everything but where and when it was eaten. */
function toItem(entry: EntryItem): EntryItem {
  return {
    foodId: entry.foodId,
    name: entry.name,
    brand: entry.brand,
    servingLabel: entry.servingLabel,
    servingGrams: entry.servingGrams,
    nutrients: entry.nutrients,
    source: entry.source,
    quantity: entry.quantity,
  };
}

export default function TemplateEditorScreen() {
  const params = useLocalSearchParams<{ id?: string; fromDate?: string; fromMeal?: string }>();
  const id = params.id;
  const fromDate = params.fromDate;
  const fromMeal = MEALS.includes(params.fromMeal as Meal) ? (params.fromMeal as Meal) : undefined;

  const colors = useColors();
  const tint = macroColors(colors);
  const scrollEdge = useScrollEdge();
  const client = useQueryClient();

  const templates = useTemplates();
  // The diary day a "save as template" came from. Not `useDiaryDay`, which
  // always runs: this one must not fire at all when there is no source day.
  const { signedIn } = useSignedIn();
  const sourceDay = useQuery({
    queryKey: nutritionKeys.day(fromDate ?? ''),
    queryFn: () => nutritionApi.day(fromDate!),
    enabled: signedIn && !!fromDate,
  });

  const [name, setName] = useState('');
  const [meal, setMeal] = useState<MealChoice>('any');
  const [items, setItems] = useState<EntryItem[]>([]);
  const [saving, setSaving] = useState(false);

  const existing: MealTemplate | undefined = id ? templates.data?.find((t) => t.id === id) : undefined;

  // Fill the form once, from whichever source applies, the first time it is
  // available. After that the form is the user's, and a background refetch of
  // the source must not overwrite what they have typed. Done during render
  // rather than in an effect, which would paint an empty form for a frame first.
  const [filled, setFilled] = useState(false);
  if (!filled) {
    if (id) {
      if (existing) {
        setName(existing.name);
        setMeal(existing.meal ?? 'any');
        setItems(existing.items.map(toItem));
        setFilled(true);
      }
    } else if (fromDate) {
      const day = sourceDay.data;
      if (day && day.date === fromDate) {
        const entries = day.entries
          .filter((entry) => !fromMeal || entry.meal === fromMeal)
          .sort((a, b) => a.position - b.position);
        setItems(entries.map(toItem));
        if (fromMeal) {
          setMeal(fromMeal);
          setName(`${MEAL_LABELS[fromMeal]}, ${format(parseISO(fromDate), 'd MMM')}`);
        }
        setFilled(true);
      }
    } else {
      setFilled(true);
    }
  }

  // Collect whatever the portion screen produced while this one was covered.
  useFocusEffect(
    useCallback(() => {
      const { templateResult, setTemplateResult } = useFoodDraft.getState();
      if (!templateResult) return;
      setTemplateResult(null);
      const { item, index } = templateResult;
      setItems((current) =>
        index === null || index >= current.length
          ? [...current, item]
          : current.map((existingItem, i) => (i === index ? item : existingItem)),
      );
    }, []),
  );

  const addFood = () => {
    haptics.added();
    router.push({ pathname: '/food/add', params: { for: 'template', date: todayIso(), meal: meal === 'any' ? 'snacks' : meal } });
  };

  const editItem = (item: EntryItem, index: number) => {
    useFoodDraft.getState().setPortion({ kind: 'template-item', food: null, item, index });
    router.push('/food/portion');
  };

  const removeItem = (index: number) => {
    haptics.destructive();
    setItems((current) => current.filter((_, i) => i !== index));
  };

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && items.length > 0 && !saving;

  const save = async () => {
    if (!canSave) {
      haptics.rejected();
      void showAlert(
        trimmed ? 'Add a food first' : 'Name it first',
        trimmed ? 'A template needs at least one food in it.' : 'Give the template a name you will recognise in a list.',
      );
      return;
    }
    setSaving(true);
    try {
      const input = { name: trimmed, meal: meal === 'any' ? null : meal, items };
      if (id) await nutritionApi.updateTemplate(id, input);
      else await nutritionApi.createTemplate(input);
      await client.invalidateQueries({ queryKey: nutritionKeys.templates });
      haptics.logged();
      router.back();
    } catch (error) {
      haptics.rejected();
      void showAlert('Could not save', describeError(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    const confirmed = await showConfirm({
      title: 'Delete this template?',
      message: 'Meals already logged from it stay in your diary.',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    try {
      await nutritionApi.deleteTemplate(id);
      await client.invalidateQueries({ queryKey: nutritionKeys.templates });
      haptics.destructive();
      router.back();
    } catch (error) {
      void showAlert('Could not delete', describeError(error));
    }
  };

  const totals = totalsOf(items);
  const loading = (id && !existing && templates.isPending) || (fromDate && !filled && sourceDay.isPending);

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: id ? 'Edit template' : 'New template',
          headerRight: () => (
            <HeaderAction
              label="Save template"
              title="Save"
              variant="filled"
              disabled={saving}
              onPress={() => void save()}
            />
          ),
        }}
      />
      {loading ? (
        <ActivityIndicator style={styles.loading} />
      ) : id && !existing ? (
        <EmptyState icon="help-circle-outline" title="Template not found" description="It may have been deleted on another device." />
      ) : (
        <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Usual breakfast"
            maxLength={80}
            returnKeyType="done"
          />

          <View style={styles.field}>
            <Text variant="label" color="textSecondary">
              Usually eaten at
            </Text>
            <SegmentedControl options={MEAL_OPTIONS} value={meal} onChange={setMeal} size="sm" label="Usual meal" />
          </View>

          <SectionHeader title="Foods" />
          <Card padded={false}>
            {items.length === 0 ? (
              <View style={styles.emptyItems}>
                <Text variant="body" color="textSecondary" align="center">
                  No foods yet.
                </Text>
              </View>
            ) : (
              items.map((item, index) => (
                <View key={`${item.name}-${index}`}>
                  {index > 0 && <Divider inset={spacing.lg} />}
                  <FoodRow
                    name={item.name}
                    detail={describeAmount(item)}
                    nutrients={itemTotals(item)}
                    onPress={() => editItem(item, index)}
                    accessibilityHint="Change the amount"
                    trailing={{ icon: 'close', label: `Remove ${item.name}`, onPress: () => removeItem(index) }}
                  />
                </View>
              ))
            )}
          </Card>
          <Button title="Add food" icon="add" variant="secondary" onPress={addFood} />

          {items.length > 0 && (
            <Card style={styles.totals}>
              <Text variant="overline" color="textTertiary">
                Total
              </Text>
              <View style={styles.totalsRow}>
                <Text variant="numericLarge">
                  {formatCalories(totals.calories)}
                  <Text variant="caption" color="textTertiary">
                    {' kcal'}
                  </Text>
                </Text>
                <View style={styles.macros}>
                  {(['protein', 'carbs', 'fat'] as const).map((key) => (
                    <View key={key} style={styles.macro}>
                      <View style={[styles.dot, { backgroundColor: tint[key] }]} />
                      <Text variant="label" color="textSecondary">
                        {Math.round(totals[key] ?? 0)}g {key}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </Card>
          )}

          {id && <Button title="Delete template" variant="ghost" onPress={() => void remove()} style={styles.delete} />}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: spacing.huge },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.huge },
  field: { gap: spacing.xs },
  emptyItems: { padding: spacing.xl },
  totals: { gap: spacing.sm },
  totalsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.md },
  macros: { gap: spacing.xs },
  macro: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 4 },
  delete: { marginTop: spacing.md },
});
