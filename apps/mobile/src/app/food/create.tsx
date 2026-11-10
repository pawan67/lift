/**
 * Typing a food in: three jobs on one form.
 *
 * - **Quick add** (`mode=quick`): figures straight into the diary, for a meal
 *   out with the numbers on the receipt. Not saved as a food unless asked.
 * - **New food**: a food of your own, kept under My foods. Saving it goes on
 *   to the portion screen, because a food is made in order to be eaten.
 * - **Edit** (`id=`): changes a saved food. The diary is untouched, since every
 *   entry carries its own copy of the figures.
 *
 * Only calories are required. A food with nothing but calories is still worth
 * logging, and an unknown figure is left blank rather than guessed as zero.
 */

import {
  MEALS,
  MEAL_LABELS,
  uuidv7,
  type Food,
  type Meal,
} from '@lift/shared';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, Screen, Text, TextField, Toggle } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { nutritionApi } from '@/features/nutrition/api';
import {
  NutrientFields,
  parseNutrientDraft,
  toNutrientDraft,
  type NutrientDraft,
} from '@/features/nutrition/components/nutrient-fields';
import { todayIso } from '@/features/nutrition/dates';
import { useFoodDraft } from '@/features/nutrition/draft';
import {
  describeError,
  invalidateFoods,
  useCreateEntries,
  useMyFoods,
  useNutritionProfile,
} from '@/features/nutrition/queries';
import { spacing, stroke, useColors } from '@/theme';

export default function CreateFoodScreen() {
  const params = useLocalSearchParams<{
    mode?: string;
    id?: string;
    barcode?: string;
    name?: string;
    date?: string;
    meal?: string;
    for?: string;
  }>();
  const myFoods = useMyFoods();

  if (params.id) {
    const food = myFoods.data?.find((f) => f.id === params.id);
    if (!food) {
      return (
        <Screen>
          <Stack.Screen options={{ title: 'Edit food' }} />
          {myFoods.isPending ? null : <EmptyState icon="help-circle-outline" title="Food not found" />}
        </Screen>
      );
    }
    return <FoodForm params={params} editing={food} />;
  }
  return <FoodForm params={params} editing={null} />;
}

function FoodForm({
  params,
  editing,
}: {
  params: { mode?: string; barcode?: string; name?: string; date?: string; meal?: string; for?: string };
  editing: Food | null;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const quick = params.mode === 'quick' && !editing;
  const forTemplate = params.for === 'template';
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayIso();
  const meal: Meal = MEALS.includes(params.meal as Meal) ? (params.meal as Meal) : 'snacks';

  const profile = useNutritionProfile();
  const create = useCreateEntries();

  const first = editing?.servings[0];
  const [name, setName] = useState(editing?.name ?? params.name ?? '');
  const [brand, setBrand] = useState(editing?.brand ?? '');
  const [servingLabel, setServingLabel] = useState(first?.label ?? (quick ? '1 serving' : ''));
  const [gramsText, setGramsText] = useState(first?.grams ? String(first.grams) : '');
  const [nutrients, setNutrients] = useState<NutrientDraft>(() => (first ? toNutrientDraft(first.nutrients) : {}));
  const [saveFood, setSaveFood] = useState(!quick);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A barcode that was not found arrives here to be made into a food; say so.
  const [barcode] = useState(params.barcode ?? editing?.barcode ?? null);

  const grams = gramsText.trim() ? Number(gramsText.replace(',', '.')) : null;
  const gramsValid = grams === null || (Number.isFinite(grams) && grams > 0);

  const submit = async () => {
    const values = parseNutrientDraft(nutrients);
    const finalName = name.trim() || (quick ? 'Quick add' : '');
    const label = servingLabel.trim() || (grams ? `${grams} g` : '1 serving');

    setError(null);
    if (!finalName) return reject('Give the food a name.');
    if (values.calories === undefined) return reject('Calories are needed.');
    if (!gramsValid) return reject('The serving weight must be a number.');

    setBusy(true);
    try {
      if (editing) {
        const servings = [{ ...editing.servings[0]!, label, grams, nutrients: values }, ...editing.servings.slice(1)];
        await nutritionApi.updateFood(editing.id, { name: finalName, brand: brand.trim() || null, servings });
        await invalidateFoods();
        haptics.logged();
        router.back();
        return;
      }

      const serving = { id: uuidv7().slice(-12), label, grams, nutrients: values };

      if (quick && !saveFood) {
        await create.mutateAsync({
          date,
          meal,
          items: [
            {
              foodId: null,
              name: finalName,
              brand: null,
              servingLabel: label,
              servingGrams: grams,
              nutrients: values,
              source: 'custom',
              quantity: 1,
            },
          ],
        });
        haptics.logged();
        router.back();
        return;
      }

      const food = await nutritionApi.createFood({
        name: finalName,
        brand: brand.trim() || null,
        barcode,
        source: 'custom',
        servings: [serving],
      });
      void invalidateFoods();

      if (quick) {
        await create.mutateAsync({
          date,
          meal,
          items: [
            {
              foodId: food.id,
              name: food.name,
              brand: food.brand,
              servingLabel: label,
              servingGrams: grams,
              nutrients: values,
              source: 'custom',
              quantity: 1,
            },
          ],
        });
        haptics.logged();
        router.back();
        return;
      }

      // A new food goes on to its amount, which is what it was made for.
      haptics.added();
      useFoodDraft
        .getState()
        .setPortion(
          forTemplate ? { kind: 'template-item', food, item: null, index: null } : { kind: 'food', food, target: { date, meal } },
        );
      router.replace('/food/portion');
    } catch (failure) {
      reject(describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  function reject(message: string) {
    haptics.rejected();
    setError(message);
  }

  const title = editing ? 'Edit food' : quick ? 'Quick add' : 'New food';
  const action = editing ? 'Save' : quick ? (saveFood ? 'Save and add' : `Add to ${MEAL_LABELS[meal]}`) : 'Save food';

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {barcode && !editing ? (
            <Text variant="caption" color="textSecondary">
              Barcode {barcode} is not in the food databases. Saved here, it will be found the next time you scan it.
            </Text>
          ) : null}

          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder={quick ? 'Quick add' : 'Masala dosa'}
            autoFocus={!editing && !quick}
            returnKeyType="next"
          />
          {!quick ? (
            <TextField label="Brand" value={brand} onChangeText={setBrand} placeholder="Optional" />
          ) : null}

          <View style={styles.servingRow}>
            <TextField
              label="Serving"
              value={servingLabel}
              onChangeText={setServingLabel}
              placeholder="1 plate"
              containerStyle={styles.flex}
            />
            <TextField
              label="Weight (g)"
              value={gramsText}
              onChangeText={(text) => setGramsText(text.replace(/[^0-9.,]/g, ''))}
              placeholder="Optional"
              keyboardType="decimal-pad"
              containerStyle={styles.grams}
              error={gramsValid ? undefined : 'Not a number'}
            />
          </View>
          <Text variant="caption" color="textTertiary">
            The figures below are for one serving. A weight lets you log it in grams too.
          </Text>

          <NutrientFields
            value={nutrients}
            onChange={setNutrients}
            customNutrients={profile.data?.customNutrients ?? []}
          />

          {quick ? (
            <View style={[styles.toggleRow, { borderColor: colors.border }]}>
              <View style={styles.flex}>
                <Text variant="bodyMedium">Save to my foods</Text>
                <Text variant="caption" color="textSecondary">
                  Keep it for next time, searchable and in My foods.
                </Text>
              </View>
              <Toggle value={saveFood} onValueChange={setSaveFood} accessibilityLabel="Save to my foods" />
            </View>
          ) : null}

          {error ? (
            <Text variant="caption" color="danger" align="center">
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.footer,
            { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <Button title={action} icon="checkmark" loading={busy} onPress={() => void submit()} fullWidth />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.huge },
  servingRow: { flexDirection: 'row', gap: spacing.md },
  grams: { width: 112 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: stroke.rule,
  },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: stroke.rule },
});
