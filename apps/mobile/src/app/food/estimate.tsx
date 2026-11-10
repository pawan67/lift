/**
 * Estimate a meal with AI: describe it, photograph it, or both, then review
 * what the model thinks it was before anything reaches the diary.
 *
 * The review is the feature. A model guessing at a plate is wrong about the
 * portion often enough that every item stays editable (name, amount, every
 * figure) and nothing is logged until "Log" is pressed. Confidence is shown as
 * a word rather than a number so 0.73 is not read as a measurement.
 *
 * Search hands over what was typed (`description`, with `auto`), so a meal
 * typed into the add screen's search is estimated without retyping it.
 *
 * Steppers and typed fields only. Swipe and scroll controls inside this app's
 * modals do not register, and a quantity is one number anyway.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  MEAL_LABELS,
  MEALS,
  confidenceLabel,
  formatCalories,
  formatQuantity,
  itemTotals,
  totalsOf,
  type AiImage,
  type EntryItem,
  type EstimatedItem,
  type Meal,
} from '@lift/shared';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  NumericField,
  Screen,
  Text,
  TextField,
  Toggle,
  useScrollEdge,
} from '@/components/ui';
import { loadAiConfig } from '@/features/ai/client';
import { AiError } from '@/features/ai/errors';
import { haptics } from '@/features/feedback/haptics';
import { nutritionApi } from '@/features/nutrition/api';
import {
  NutrientFields,
  parseNutrientDraft,
  toNutrientDraft,
  type NutrientDraft,
} from '@/features/nutrition/components/nutrient-fields';
import { macroColors } from '@/features/nutrition/components/summary';
import { todayIso } from '@/features/nutrition/dates';
import { estimateFood, pickMealPhoto } from '@/features/nutrition/estimate';
import { describeError, invalidateFoods, useCreateEntries, useNutritionProfile } from '@/features/nutrition/queries';
import { useSettings } from '@/store/settings';
import { radius, spacing, stroke, useColors } from '@/theme';

/** Room for a whole day's eating in one go; the model's reply now has room for the list it makes. */
const MAX_DESCRIPTION = 2000;
const QUANTITY_STEP = 0.5;
const QUANTITY_MIN = 0.25;

/** One reviewed item. `draft` is non-null while its nutrients are open for editing. */
interface Row {
  key: number;
  item: EstimatedItem;
  draft: NutrientDraft | null;
}

function isMeal(value: unknown): value is Meal {
  return typeof value === 'string' && (MEALS as readonly string[]).includes(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** The item as it will be logged: open nutrient edits applied, confidence dropped. */
function finalItem(row: Row): EntryItem {
  const { confidence: _confidence, ...item } = row.item;
  void _confidence;
  if (!row.draft) return item;
  return { ...item, nutrients: { ...item.nutrients, ...parseNutrientDraft(row.draft) } };
}

function errorText(error: unknown): string {
  if (error instanceof AiError) {
    // The parser's sentence is more useful than the generic one for this
    // screen: it says the model did not find food, which suggests rewording.
    if (error.kind === 'bad-response' && error.detail) {
      return /cut off/.test(error.detail)
        ? `${error.detail} Try a shorter description, or one meal at a time.`
        : `${error.detail} Try describing it differently.`;
    }
    return error.message;
  }
  return describeError(error);
}

export default function EstimateScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const scrollEdge = useScrollEdge();
  const params = useLocalSearchParams<{ date?: string; meal?: string; description?: string; auto?: string }>();
  const date = isIsoDate(params.date) ? params.date : todayIso();
  const meal: Meal = isMeal(params.meal) ? params.meal : 'snacks';

  const provider = useSettings((state) => state.aiProvider);
  const profile = useNutritionProfile();
  const customNutrients = useMemo(() => profile.data?.customNutrients ?? [], [profile.data]);
  const createEntries = useCreateEntries();

  // `undefined` while the key is being read from secure storage.
  const [configured, setConfigured] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadAiConfig().then((config) => {
      if (live) setConfigured(!!config);
    });
    return () => {
      live = false;
    };
  }, []);

  const [description, setDescription] = useState(() =>
    typeof params.description === 'string' ? params.description.slice(0, MAX_DESCRIPTION) : '',
  );
  const [image, setImage] = useState<AiImage | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [found, setFound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [saveAsFoods, setSaveAsFoods] = useState(false);
  const [logging, setLogging] = useState(false);

  const nextKey = useRef(0);
  const abort = useRef<AbortController | null>(null);
  // Leaving mid-estimate must not leave a request running behind a closed screen.
  useEffect(() => () => abort.current?.abort(), []);

  const choosePhoto = async (source: 'camera' | 'library') => {
    setError(null);
    try {
      const picked = await pickMealPhoto(source);
      if (picked) setImage(picked);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the photo.');
    }
  };

  const estimate = async () => {
    if (!description.trim() && !image) {
      haptics.rejected();
      setError('Describe what you ate, or add a photo.');
      return;
    }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setEstimating(true);
    setFound(0);
    setError(null);
    try {
      const result = await estimateFood({
        description,
        image,
        customNutrients,
        signal: controller.signal,
        onProgress: (count) => {
          if (abort.current === controller) setFound(count);
        },
      });
      setNote(result.note);
      setRows(result.items.map((item) => ({ key: nextKey.current++, item, draft: null })));
      haptics.added();
    } catch (cause) {
      if (cause instanceof AiError && cause.kind === 'aborted') return;
      haptics.rejected();
      setError(errorText(cause));
    } finally {
      if (abort.current === controller) abort.current = null;
      setEstimating(false);
    }
  };

  // Handed over from search: estimate straight away once the key is known to
  // exist, rather than making the user press Estimate on words already typed.
  // Started from a timer, which the cleanup cancels, so a Strict Mode remount
  // sends one request, not two.
  useEffect(() => {
    if (configured !== true || params.auto !== '1' || !description.trim()) return;
    const timer = setTimeout(() => void estimate(), 0);
    return () => clearTimeout(timer);
    // Runs once, when the key check lands; `estimate` reads the current description.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  const update = (key: number, change: (row: Row) => Row) =>
    setRows((current) => current.map((row) => (row.key === key ? change(row) : row)));

  const items = rows.map(finalItem);
  const total = totalsOf(items);

  const log = async () => {
    if (items.length === 0) return;
    setLogging(true);
    setError(null);
    try {
      let toLog = items;
      if (saveAsFoods) {
        // Saved one at a time so a failure part-way leaves the ones already
        // saved, which the user can find under My foods, rather than nothing.
        toLog = [];
        for (const item of items) {
          const food = await nutritionApi.createFood({
            name: item.name,
            brand: item.brand,
            source: 'ai',
            servings: [{ id: 'ai', label: item.servingLabel, grams: item.servingGrams, nutrients: item.nutrients }],
          });
          toLog.push({ ...item, foodId: food.id });
        }
        void invalidateFoods();
      }
      await createEntries.mutateAsync({ date, meal, items: toLog });
      haptics.logged();
      router.dismissTo('/food' as Href);
    } catch (cause) {
      haptics.rejected();
      setError(describeError(cause));
    } finally {
      setLogging(false);
    }
  };

  const header = <Stack.Screen options={{ title: 'Estimate with AI' }} />;

  if (configured === false) {
    return (
      <Screen>
        {header}
        <EmptyState
          icon="sparkles-outline"
          title="Set up AI first"
          description="Estimates use your own AI provider and key, the same one the coach uses. Nothing is sent anywhere until you add one."
          action={<Button title="Open AI settings" onPress={() => router.push('/settings/ai')} />}
        />
      </Screen>
    );
  }

  const tint = macroColors(colors);
  const mealLabel = MEAL_LABELS[meal];

  return (
    <Screen scrolled={scrollEdge.progress} width="form">
      {header}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          {...scrollEdge.list}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <TextField
              label="What did you eat?"
              value={description}
              onChangeText={setDescription}
              placeholder="2 rotis, dal, a bowl of rice"
              multiline
              style={styles.description}
              maxLength={MAX_DESCRIPTION}
            />

            {image ? (
              <View style={styles.photoRow}>
                <Image
                  source={{ uri: `data:${image.mediaType};base64,${image.data}` }}
                  style={[styles.thumb, { backgroundColor: colors.surfaceMuted }]}
                  contentFit="cover"
                  accessibilityLabel="Meal photo"
                />
                <View style={styles.photoText}>
                  <Text variant="bodyMedium">Photo attached</Text>
                  <Text variant="caption" color="textSecondary">
                    Sent with your description.
                  </Text>
                </View>
                <IconButton name="close" onPress={() => setImage(null)} accessibilityLabel="Remove photo" />
              </View>
            ) : (
              <View style={styles.photoButtons}>
                <Button
                  title="Take photo"
                  icon="camera-outline"
                  variant="secondary"
                  size="sm"
                  style={styles.flex}
                  onPress={() => void choosePhoto('camera')}
                />
                <Button
                  title="Choose photo"
                  icon="image-outline"
                  variant="secondary"
                  size="sm"
                  style={styles.flex}
                  onPress={() => void choosePhoto('library')}
                />
              </View>
            )}

            {image && provider === 'deepseek' ? (
              <Text variant="caption" color="warning">
                DeepSeek cannot read photos. Describe the meal, or switch to a vision model in AI settings.
              </Text>
            ) : (
              <Text variant="caption" color="textTertiary">
                Photos need a model that can see images, such as Claude or GPT-4o.
              </Text>
            )}

            <Button
              title={rows.length > 0 ? 'Estimate again' : 'Estimate'}
              icon="sparkles"
              variant={rows.length > 0 ? 'secondary' : 'primary'}
              loading={estimating}
              disabled={estimating || configured === undefined}
              fullWidth
              onPress={() => void estimate()}
            />

            {estimating ? (
              <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
                {found > 0 ? `Found ${found} ${found === 1 ? 'food' : 'foods'} so far…` : 'Reading the meal…'}
              </Text>
            ) : null}

            {error ? (
              <Text variant="body" color="danger" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
          </View>

          {rows.length > 0 && (
            <View style={styles.section}>
              <Text variant="overline" color="textTertiary">
                Review before logging
              </Text>
              {note ? (
                <Text variant="caption" color="textSecondary">
                  {note}
                </Text>
              ) : null}

              {rows.map((row) => {
                const figures = itemTotals(finalItem(row));
                const confidence = confidenceLabel(row.item.confidence);
                return (
                  <Card key={row.key} style={styles.itemCard}>
                    <View style={styles.itemHead}>
                      <TextField
                        value={row.item.name}
                        onChangeText={(name) => update(row.key, (r) => ({ ...r, item: { ...r.item, name } }))}
                        containerStyle={styles.flex}
                        accessibilityLabel="Food name"
                        maxLength={160}
                      />
                      <IconButton
                        name="trash-outline"
                        color={colors.danger}
                        onPress={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                        accessibilityLabel={`Remove ${row.item.name}`}
                      />
                    </View>

                    <View style={styles.metaRow}>
                      <Badge
                        label={`${confidence[0]!.toUpperCase()}${confidence.slice(1)} confidence`}
                        tone={confidence === 'low' ? 'warning' : confidence === 'high' ? 'success' : 'neutral'}
                      />
                      <Text variant="caption" color="textSecondary" numberOfLines={1} style={styles.flex}>
                        {row.item.servingLabel}
                      </Text>
                    </View>

                    <View style={styles.quantityRow}>
                      <Text variant="label" color="textSecondary" style={styles.flex}>
                        Servings
                      </Text>
                      <IconButton
                        name="remove"
                        filled
                        accessibilityLabel="Fewer servings"
                        onPress={() =>
                          update(row.key, (r) => ({
                            ...r,
                            item: { ...r.item, quantity: Math.max(QUANTITY_MIN, r.item.quantity - QUANTITY_STEP) },
                          }))
                        }
                      />
                      <NumericField
                        value={formatQuantity(row.item.quantity)}
                        onChangeText={(text) => {
                          const quantity = Number(text.replace(',', '.'));
                          if (Number.isFinite(quantity) && quantity > 0) {
                            update(row.key, (r) => ({ ...r, item: { ...r.item, quantity } }));
                          }
                        }}
                        keyboardType="decimal-pad"
                        accessibilityLabel="Servings"
                        style={styles.quantityField}
                      />
                      <IconButton
                        name="add"
                        filled
                        accessibilityLabel="More servings"
                        onPress={() =>
                          update(row.key, (r) => ({
                            ...r,
                            item: { ...r.item, quantity: r.item.quantity + QUANTITY_STEP },
                          }))
                        }
                      />
                    </View>

                    <View style={[styles.figures, { borderTopColor: colors.border }]}>
                      <View>
                        <Text variant="numericLarge">{formatCalories(figures.calories)}</Text>
                        <Text variant="caption" color="textTertiary">
                          kcal
                        </Text>
                      </View>
                      {(['protein', 'carbs', 'fat'] as const).map((macro) => (
                        <View key={macro} style={styles.macro}>
                          <View style={[styles.macroDot, { backgroundColor: tint[macro] }]} />
                          <Text variant="numeric">{Math.round(figures[macro] ?? 0)} g</Text>
                          <Text variant="caption" color="textTertiary">
                            {macro === 'protein' ? 'Protein' : macro === 'carbs' ? 'Carbs' : 'Fat'}
                          </Text>
                        </View>
                      ))}
                    </View>

                    <Pressable
                      onPress={() =>
                        update(row.key, (r) =>
                          r.draft
                            ? // Folding commits the edits into the item, so they survive re-opening.
                              { ...r, item: { ...r.item, nutrients: finalItem(r).nutrients }, draft: null }
                            : { ...r, draft: toNutrientDraft(r.item.nutrients) },
                        )
                      }
                      style={styles.editToggle}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: !!row.draft }}
                    >
                      <Ionicons name={row.draft ? 'chevron-up' : 'create-outline'} size={16} color={colors.accent} />
                      <Text variant="label" color="accent">
                        {row.draft ? 'Done editing' : 'Edit nutrients (per serving)'}
                      </Text>
                    </Pressable>

                    {row.draft ? (
                      <NutrientFields
                        value={row.draft}
                        onChange={(draft) => update(row.key, (r) => ({ ...r, draft }))}
                        customNutrients={customNutrients}
                      />
                    ) : null}
                  </Card>
                );
              })}

              <Pressable
                onPress={() => setSaveAsFoods((on) => !on)}
                style={styles.saveRow}
                accessibilityRole="switch"
                accessibilityState={{ checked: saveAsFoods }}
                accessibilityLabel="Also save as my foods"
              >
                <View style={styles.flex}>
                  <Text variant="bodyMedium">Also save as my foods</Text>
                  <Text variant="caption" color="textSecondary">
                    So they turn up in search next time, without asking the AI again.
                  </Text>
                </View>
                <Toggle value={saveAsFoods} onValueChange={setSaveAsFoods} presentational />
              </Pressable>
            </View>
          )}
        </ScrollView>

        {rows.length > 0 && (
          <View
            style={[
              styles.footer,
              {
                backgroundColor: colors.background,
                borderTopColor: colors.border,
                paddingBottom: spacing.md + insets.bottom,
              },
            ]}
          >
            <View>
              <Text variant="numericLarge">{formatCalories(total.calories)}</Text>
              <Text variant="caption" color="textTertiary">
                kcal total
              </Text>
            </View>
            <Button
              title={`Log ${rows.length} ${rows.length === 1 ? 'item' : 'items'} to ${mealLabel}`}
              icon="checkmark"
              loading={logging}
              disabled={logging || estimating}
              style={styles.flex}
              onPress={() => void log()}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.xxl, paddingBottom: spacing.huge },
  section: { gap: spacing.md },
  description: { minHeight: 88, textAlignVertical: 'top' },
  photoButtons: { flexDirection: 'row', gap: spacing.sm },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  photoText: { flex: 1, gap: 2 },
  itemCard: { gap: spacing.md },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  quantityField: { width: 64 },
  figures: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    borderTopWidth: stroke.rule,
  },
  macro: { alignItems: 'flex-end', gap: 2 },
  macroDot: { width: 6, height: 6, borderRadius: 3 },
  editToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: stroke.rule,
  },
});
