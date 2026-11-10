/**
 * How much: the one screen between choosing a food and logging it.
 *
 * Three callers share it, read from `useFoodDraft`:
 * - a food about to be logged (from search, favourites, a scan or a recent),
 * - a diary entry being changed,
 * - a template item, which is handed back to the template editor rather than
 *   logged.
 *
 * The amount is entered as a number of servings or, when the serving's weight
 * is known, in grams. Both are typed or stepped with buttons, never dragged: a
 * scroll wheel inside a pushed screen fights the screen's own scroll, and a
 * number is faster to type than to find. Every figure on the screen follows
 * the amount as it changes, so the cost of a second helping is visible before
 * it is logged.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  MEALS,
  MEAL_LABELS,
  formatCalories,
  formatNutrientValue,
  formatQuantity,
  nutrientDefinitions,
  scaleNutrients,
  type EntryItem,
  type Food,
  type FoodCandidate,
  type Meal,
  type Serving,
} from '@lift/shared';
import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Card, Chip, Divider, EmptyState, IconButton, Screen, Text } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { ensureSaved, nutritionApi } from '@/features/nutrition/api';
import {
  NutrientFields,
  parseNutrientDraft,
  toNutrientDraft,
  type NutrientDraft,
} from '@/features/nutrition/components/nutrient-fields';
import { macroColors } from '@/features/nutrition/components/summary';
import { describeDay } from '@/features/nutrition/dates';
import { useFoodDraft, type PortionDraft } from '@/features/nutrition/draft';
import {
  describeError,
  invalidateFoods,
  useCreateEntries,
  useDeleteEntries,
  useNutritionProfile,
  useUpdateEntry,
} from '@/features/nutrition/queries';
import { showConfirm } from '@/store/dialog';
import { font, fontSize, radius, spacing, stroke, useColors } from '@/theme';

const SOURCE_LABELS: Record<string, string> = {
  usda: 'USDA',
  openfoodfacts: 'OpenFoodFacts',
  ai: 'AI estimate',
  custom: 'Your food',
};

const QUICK_AMOUNTS = [0.5, 1, 1.5, 2];

/** What the screen edits, reduced to one shape whatever the caller was. */
interface Subject {
  name: string;
  brand: string | null;
  source: Food['source'];
  servings: Serving[];
  food: Food | FoodCandidate | null;
  initialServingId: string;
  initialQuantity: number;
}

function subjectOf(draft: PortionDraft): Subject {
  if (draft.kind === 'entry') {
    const { entry } = draft;
    return {
      name: entry.name,
      brand: entry.brand,
      source: entry.source,
      servings: [{ id: 'entry', label: entry.servingLabel, grams: entry.servingGrams, nutrients: entry.nutrients }],
      food: null,
      initialServingId: 'entry',
      initialQuantity: entry.quantity,
    };
  }
  if (draft.kind === 'template-item' && !draft.food && draft.item) {
    const { item } = draft;
    return {
      name: item.name,
      brand: item.brand,
      source: item.source,
      servings: [{ id: 'item', label: item.servingLabel, grams: item.servingGrams, nutrients: item.nutrients }],
      food: null,
      initialServingId: 'item',
      initialQuantity: item.quantity,
    };
  }
  const food = draft.kind === 'food' || draft.kind === 'template-item' ? draft.food! : null!;
  const servingId = draft.kind === 'food' && draft.servingId ? draft.servingId : food.servings[0]!.id;
  return {
    name: food.name,
    brand: food.brand,
    source: food.source,
    servings: food.servings,
    food,
    initialServingId: servingId,
    initialQuantity: draft.kind === 'food' && draft.quantity ? draft.quantity : 1,
  };
}

export default function PortionScreen() {
  const draft = useFoodDraft((state) => state.portion);
  if (!draft || (draft.kind === 'template-item' && !draft.food && !draft.item)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Amount' }} />
        <EmptyState icon="help-circle-outline" title="Nothing to add" description="Go back and pick a food." />
      </Screen>
    );
  }
  return <PortionEditor draft={draft} />;
}

function PortionEditor({ draft }: { draft: PortionDraft }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const subject = useMemo(() => subjectOf(draft), [draft]);
  const profile = useNutritionProfile();
  const customNutrients = profile.data?.customNutrients ?? [];

  const [servingId, setServingId] = useState(subject.initialServingId);
  const serving = subject.servings.find((s) => s.id === servingId) ?? subject.servings[0]!;
  const [inGrams, setInGrams] = useState(false);
  const [amountText, setAmountText] = useState(formatQuantity(subject.initialQuantity));
  const [meal, setMeal] = useState<Meal>(
    draft.kind === 'food' ? draft.target.meal : draft.kind === 'entry' ? draft.entry.meal : 'snacks',
  );
  const [favorite, setFavorite] = useState(subject.food?.isFavorite ?? false);
  const [editNutrients, setEditNutrients] = useState(false);
  const [nutrientDraft, setNutrientDraft] = useState<NutrientDraft>(() => toNutrientDraft(serving.nutrients));
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = useCreateEntries();
  const update = useUpdateEntry(draft.kind === 'entry' ? draft.entry.date : '');
  const remove = useDeleteEntries(draft.kind === 'entry' ? draft.entry.date : '');

  const typed = Number(amountText.replace(',', '.'));
  const amountValid = amountText.trim() !== '' && Number.isFinite(typed) && typed > 0;
  /** Always in servings, whatever the field shows. */
  const quantity = amountValid ? (inGrams && serving.grams ? typed / serving.grams : typed) : 0;

  const perServing = editNutrients ? parseNutrientDraft(nutrientDraft) : serving.nutrients;
  const totals = scaleNutrients(perServing, quantity);
  const tint = macroColors(colors);

  const selectServing = (next: Serving) => {
    haptics.selection();
    // Keep the weight the same across a serving change when both know it, so
    // switching from "100 g" to "1 cup (240 g)" with 240 typed reads as 1 cup.
    if (!inGrams && serving.grams && next.grams && amountValid) {
      setAmountText(formatQuantity((typed * serving.grams) / next.grams));
    }
    setServingId(next.id);
    setNutrientDraft(toNutrientDraft(next.nutrients));
    if (!next.grams) setInGrams(false);
  };

  const toggleGrams = () => {
    if (!serving.grams) return;
    haptics.selection();
    if (amountValid) {
      setAmountText(formatQuantity(inGrams ? typed / serving.grams : typed * serving.grams));
    }
    setInGrams(!inGrams);
  };

  const step = (direction: 1 | -1) => {
    haptics.selection();
    const base = amountValid ? typed : 0;
    const size = inGrams ? (base >= 100 ? 25 : 10) : 0.5;
    const next = Math.max(size, Math.round((base + direction * size) / size) * size);
    setAmountText(formatQuantity(next));
  };

  const item = (): EntryItem => ({
    foodId: subject.food?.id ?? (draft.kind === 'entry' ? draft.entry.foodId : draft.kind === 'template-item' ? draft.item?.foodId ?? null : null),
    name: subject.name,
    brand: subject.brand,
    servingLabel: serving.label,
    servingGrams: serving.grams,
    nutrients: perServing,
    source: subject.source,
    quantity,
  });

  const toggleFavorite = async () => {
    if (!subject.food) return;
    haptics.selection();
    const next = !favorite;
    setFavorite(next);
    try {
      const saved = await ensureSaved({ ...subject.food, isFavorite: next });
      if (saved.isFavorite !== next) await nutritionApi.updateFood(saved.id, { isFavorite: next });
      await invalidateFoods();
    } catch (failure) {
      setFavorite(!next);
      setError(describeError(failure));
    }
  };

  const submit = async () => {
    if (!amountValid) {
      haptics.rejected();
      setError('Enter an amount.');
      return;
    }
    if (!('calories' in perServing)) {
      haptics.rejected();
      setError('Calories are needed.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (draft.kind === 'entry') {
        await update.mutateAsync({
          id: draft.entry.id,
          patch: {
            quantity,
            meal,
            ...(editNutrients ? { nutrients: perServing } : {}),
          },
        });
        haptics.logged();
        router.back();
        return;
      }

      if (draft.kind === 'template-item') {
        let next = item();
        // A food from a database is saved first, so the template can point at it.
        if (subject.food && !subject.food.id) {
          const saved = await ensureSaved(subject.food);
          next = { ...next, foodId: saved.id };
          void invalidateFoods();
        }
        useFoodDraft.getState().setTemplateResult({ item: next, index: draft.index });
        haptics.added();
        // From the template editor directly when editing an item; through the
        // add screen when it is a new one.
        if (draft.index === null && router.canDismiss()) router.dismiss(2);
        else router.back();
        return;
      }

      let next = item();
      // Foods picked from USDA or OpenFoodFacts are kept, so they turn up under
      // My foods and in search next time without asking the database again.
      if (subject.food && !subject.food.id && subject.food.source !== 'ai') {
        const saved = await ensureSaved(subject.food);
        next = { ...next, foodId: saved.id };
        void invalidateFoods();
      }
      await create.mutateAsync({ date: draft.target.date, meal, items: [next] });
      haptics.logged();
      useFoodDraft.getState().noteAdded(`${subject.name} to ${MEAL_LABELS[meal]}`);
      router.back();
    } catch (failure) {
      haptics.rejected();
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async () => {
    if (draft.kind !== 'entry') return;
    const ok = await showConfirm({ title: `Delete ${draft.entry.name}?`, confirmLabel: 'Delete' });
    if (!ok) return;
    haptics.destructive();
    remove.mutate([draft.entry.id]);
    router.back();
  };

  const definitions = nutrientDefinitions(customNutrients).filter((d) => totals[d.key] !== undefined);

  const actionLabel =
    draft.kind === 'entry'
      ? 'Save'
      : draft.kind === 'template-item'
        ? draft.index === null
          ? 'Add to template'
          : 'Update item'
        : `Add to ${MEAL_LABELS[meal]}`;

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          title: draft.kind === 'entry' ? 'Edit entry' : 'Amount',
          headerRight: subject.food
            ? () => (
                <IconButton
                  name={favorite ? 'star' : 'star-outline'}
                  color={favorite ? colors.record : colors.textSecondary}
                  accessibilityLabel={favorite ? 'Remove from favourites' : 'Add to favourites'}
                  onPress={() => void toggleFavorite()}
                />
              )
            : undefined,
        }}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={styles.head}>
            <Text variant="title" numberOfLines={3}>
              {subject.name}
            </Text>
            <View style={styles.headMeta}>
              {subject.brand ? (
                <Text variant="body" color="textSecondary">
                  {subject.brand}
                </Text>
              ) : null}
              <Badge
                label={SOURCE_LABELS[subject.source] ?? subject.source}
                icon={subject.source === 'ai' ? 'sparkles' : undefined}
              />
            </View>
          </View>

          {/* Figures for the amount as typed */}
          <Card style={styles.figures}>
            <View style={styles.kcalBlock}>
              <Text variant="numericLarge" style={styles.kcal}>
                {formatCalories(totals.calories)}
              </Text>
              <Text variant="caption" color="textSecondary">
                kcal
              </Text>
            </View>
            <View style={styles.macroRow}>
              {(['protein', 'carbs', 'fat'] as const).map((key) => (
                <View key={key} style={styles.macroCell}>
                  <View style={[styles.macroBar, { backgroundColor: tint[key] }]} />
                  <Text variant="numeric">
                    {totals[key] === undefined ? '–' : formatNutrientValue(key, totals[key])}
                    <Text variant="caption" color="textTertiary">
                      {' g'}
                    </Text>
                  </Text>
                  <Text variant="caption" color="textSecondary">
                    {key === 'protein' ? 'Protein' : key === 'carbs' ? 'Carbs' : 'Fat'}
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          {/* Serving */}
          {subject.servings.length > 1 || serving.grams ? (
            <View style={styles.block}>
              <Text variant="overline" color="textTertiary">
                Serving
              </Text>
              <View style={styles.chips}>
                {subject.servings.map((option) => (
                  <Chip
                    key={option.id}
                    label={option.label}
                    selected={option.id === serving.id && !inGrams}
                    onPress={() => {
                      if (inGrams && option.id === serving.id) toggleGrams();
                      else selectServing(option);
                    }}
                  />
                ))}
                {serving.grams ? <Chip label="Grams" selected={inGrams} onPress={toggleGrams} /> : null}
              </View>
            </View>
          ) : null}

          {/* Amount */}
          <View style={styles.block}>
            <Text variant="overline" color="textTertiary">
              {inGrams ? 'Grams' : `Servings · ${serving.label}`}
            </Text>
            <View style={styles.amountRow}>
              <StepButton icon="remove" label="Less" onPress={() => step(-1)} />
              <View style={[styles.amountField, { backgroundColor: colors.surfaceMuted, borderColor: amountValid ? colors.surfaceMuted : colors.danger }]}>
                <TextInput
                  value={amountText}
                  onChangeText={(text) => setAmountText(text.replace(/[^0-9.,]/g, ''))}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  accessibilityLabel={inGrams ? 'Amount in grams' : 'Number of servings'}
                  style={[styles.amountInput, { color: colors.text }]}
                />
                <Text variant="body" color="textTertiary" style={styles.amountUnit}>
                  {inGrams ? 'g' : '×'}
                </Text>
              </View>
              <StepButton icon="add" label="More" onPress={() => step(1)} />
            </View>
            {!inGrams ? (
              <View style={styles.chips}>
                {QUICK_AMOUNTS.map((amount) => (
                  <Chip
                    key={amount}
                    label={amount === 0.5 ? '½' : amount === 1.5 ? '1½' : String(amount)}
                    selected={amountValid && typed === amount}
                    onPress={() => {
                      haptics.selection();
                      setAmountText(formatQuantity(amount));
                    }}
                  />
                ))}
              </View>
            ) : serving.grams ? (
              <Text variant="caption" color="textTertiary">
                {formatQuantity(quantity)} × {serving.label}
              </Text>
            ) : null}
          </View>

          {/* Meal */}
          {draft.kind !== 'template-item' ? (
            <View style={styles.block}>
              <Text variant="overline" color="textTertiary">
                {draft.kind === 'food' ? `Meal · ${describeDay(draft.target.date)}` : `Meal · ${describeDay(draft.entry.date)}`}
              </Text>
              <View style={styles.chips}>
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
              </View>
            </View>
          ) : null}

          {/* Nutrients */}
          <View style={styles.block}>
            <View style={styles.rowBetween}>
              <Pressable onPress={() => setShowAll((open) => !open)} style={styles.inline} accessibilityRole="button">
                <Text variant="label" color="textSecondary">
                  {showAll ? 'Hide nutrients' : `All nutrients (${definitions.length})`}
                </Text>
                <Ionicons name={showAll ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
              </Pressable>
              <Pressable onPress={() => setEditNutrients((open) => !open)} accessibilityRole="button">
                <Text variant="label" color="accent">
                  {editNutrients ? 'Done editing' : 'Correct figures'}
                </Text>
              </Pressable>
            </View>
            {editNutrients ? (
              <>
                <Text variant="caption" color="textTertiary">
                  Per one {serving.label}. Changes apply to this {draft.kind === 'template-item' ? 'item' : 'entry'} only.
                </Text>
                <NutrientFields value={nutrientDraft} onChange={setNutrientDraft} customNutrients={customNutrients} />
              </>
            ) : showAll ? (
              <Card padded={false}>
                {definitions.map((definition, index) => (
                  <View key={definition.key}>
                    {index > 0 ? <Divider inset={spacing.lg} /> : null}
                    <View style={styles.nutrientRow}>
                      <Text variant="body" style={styles.flex}>
                        {definition.label}
                      </Text>
                      <Text variant="numeric">
                        {formatNutrientValue(definition.key, totals[definition.key]!, customNutrients)}
                        <Text variant="caption" color="textTertiary">{` ${definition.unit}`}</Text>
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}
          </View>

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
          {draft.kind === 'entry' ? (
            <Button title="Delete" variant="ghost" icon="trash-outline" onPress={() => void deleteEntry()} />
          ) : null}
          <Button
            title={actionLabel}
            icon={draft.kind === 'entry' ? 'checkmark' : 'add'}
            loading={busy}
            disabled={!amountValid}
            onPress={() => void submit()}
            style={styles.flex}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function StepButton({ icon, label, onPress }: { icon: 'add' | 'remove'; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.step,
        { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border },
      ]}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge },
  head: { gap: spacing.sm },
  headMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  figures: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  kcalBlock: { alignItems: 'center', minWidth: 76 },
  kcal: { fontSize: fontSize.xxxl, ...font('bold') },
  macroRow: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  macroCell: { gap: 2 },
  macroBar: { width: 18, height: 3, borderRadius: 2, marginBottom: spacing.xs },
  block: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  amountField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 56,
    borderRadius: radius.lg,
    borderWidth: stroke.outline,
  },
  // Right-aligned in a fixed width, with the unit straight after it, so the
  // number and its unit read as one value whatever the number's length.
  amountInput: {
    width: 104,
    textAlign: 'right',
    fontSize: fontSize.xxl,
    ...font('bold'),
    fontVariant: ['tabular-nums'],
    paddingVertical: 0,
  },
  amountUnit: { width: 104, textAlign: 'left' },
  step: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    borderWidth: stroke.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  nutrientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: stroke.rule,
  },
});
