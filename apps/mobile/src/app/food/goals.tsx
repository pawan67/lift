/**
 * Daily targets, and the nutrients the user tracks beyond the built-in list.
 *
 * Macros can be set in grams or as a share of the calorie goal. Percent is how
 * most diet plans are written ("40/30/30"), grams is how a label reads, and
 * people think in one or the other, so both are offered and either way the
 * server stores grams: every bar in the diary compares grams against grams.
 * In percent mode the three must add up to 100 before Save is allowed, and the
 * running sum is shown so the reason is visible rather than a refusal.
 *
 * Every other nutrient, custom ones included, can have a target too, folded
 * away because most people never set one. A blank field means no target, not
 * a target of zero.
 */

import {
  BUILT_IN_NUTRIENTS,
  CORE_NUTRIENT_KEYS,
  KCAL_PER_GRAM,
  macroGramsFromPercent,
  type CustomNutrient,
  type NutrientDefinition,
  type NutrientValues,
} from '@lift/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import {
  Button,
  Card,
  CollapsibleSection,
  Divider,
  EmptyState,
  HeaderAction,
  IconButton,
  Screen,
  SectionHeader,
  SegmentedControl,
  Text,
  TextField,
  useScrollEdge,
} from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { nutritionApi } from '@/features/nutrition/api';
import { parseNutrientDraft, toNutrientDraft, type NutrientDraft } from '@/features/nutrition/components/nutrient-fields';
import { MACROS, macroColors, type MacroKey } from '@/features/nutrition/components/summary';
import { describeError, nutritionKeys, useNutritionProfile } from '@/features/nutrition/queries';
import { showAlert, showConfirm } from '@/store/dialog';
import { font, fontSize, radius, spacing, stroke, useColors } from '@/theme';

type MacroMode = 'grams' | 'percent';

const MODE_OPTIONS = [
  { value: 'grams' as const, label: 'Grams' },
  { value: 'percent' as const, label: 'Percent' },
];

/** A common starting split when someone switches to percent with nothing set. */
const DEFAULT_SPLIT: Record<MacroKey, string> = { protein: '30', carbs: '40', fat: '30' };

function numberOf(text: string | undefined): number | null {
  if (!text || text.trim() === '') return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** One target: label on the left, a typed number and its unit on the right. */
function TargetRow({
  label,
  unit,
  value,
  onChange,
  dot,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (text: string) => void;
  dot?: string;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.row}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      <Text variant="body" style={styles.rowLabel}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={(text) => onChange(text.replace(/[^0-9.,]/g, ''))}
        keyboardType="decimal-pad"
        placeholder="–"
        placeholderTextColor={colors.textTertiary}
        selectTextOnFocus
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={`${label} target in ${unit}`}
        style={[
          styles.rowInput,
          {
            color: colors.text,
            backgroundColor: colors.surfaceMuted,
            borderColor: focused ? colors.accent : colors.surfaceMuted,
          },
        ]}
      />
      <Text variant="caption" color="textTertiary" style={styles.rowUnit}>
        {unit}
      </Text>
    </View>
  );
}

/** Name and unit, for adding a nutrient or renaming one. */
function NutrientForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: CustomNutrient;
  submitLabel: string;
  onSubmit: (name: string, unit: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length > 0 && unit.trim().length > 0 && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await onSubmit(name.trim(), unit.trim());
      if (!initial) {
        setName('');
        setUnit('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <View style={styles.formFields}>
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Caffeine"
          maxLength={40}
          containerStyle={styles.formName}
        />
        <TextField
          label="Unit"
          value={unit}
          onChangeText={setUnit}
          placeholder="mg"
          maxLength={12}
          autoCapitalize="none"
          containerStyle={styles.formUnit}
        />
      </View>
      <View style={styles.formActions}>
        {onCancel ? <Button title="Cancel" variant="ghost" size="sm" onPress={onCancel} /> : null}
        <Button title={submitLabel} size="sm" disabled={!ready} loading={busy} onPress={() => void submit()} />
      </View>
    </View>
  );
}

export default function GoalsScreen() {
  const colors = useColors();
  const tint = macroColors(colors);
  const scrollEdge = useScrollEdge();
  const client = useQueryClient();
  const { data: profile, isPending, error, refetch } = useNutritionProfile();

  const [calories, setCalories] = useState('');
  const [mode, setMode] = useState<MacroMode>('grams');
  const [grams, setGrams] = useState<Record<MacroKey, string>>({ protein: '', carbs: '', fat: '' });
  const [percent, setPercent] = useState<Record<MacroKey, string>>(DEFAULT_SPLIT);
  const [others, setOthers] = useState<NutrientDraft>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  // Seed the form from the server once, during render so the first paint is
  // already filled. Later refetches (after adding a custom nutrient, say) must
  // not wipe targets typed but not yet saved.
  if (!loaded && profile) {
    const draft = toNutrientDraft(profile.goals.targets);
    setCalories(draft.calories ?? '');
    setGrams({ protein: draft.protein ?? '', carbs: draft.carbs ?? '', fat: draft.fat ?? '' });
    const rest: NutrientDraft = {};
    for (const [key, value] of Object.entries(draft)) {
      if (!(CORE_NUTRIENT_KEYS as readonly string[]).includes(key)) rest[key] = value;
    }
    setOthers(rest);
    setLoaded(true);
  }

  const calorieGoal = numberOf(calories);
  const percentSum = MACROS.reduce((sum, macro) => sum + (numberOf(percent[macro.key]) ?? 0), 0);
  const percentValid = Math.abs(percentSum - 100) < 0.5;

  const switchMode = (next: MacroMode) => {
    if (next === mode) return;
    haptics.selection();
    if (next === 'percent') {
      // Carry the current grams over as a split, so switching to look does
      // not throw away what was there.
      const kcal = MACROS.map((m) => (numberOf(grams[m.key]) ?? 0) * KCAL_PER_GRAM[m.key]);
      const total = kcal.reduce((a, b) => a + b, 0);
      if (total > 0) {
        const split = kcal.map((k) => Math.round((k / total) * 100));
        // Rounding can leave 99 or 101; the largest share absorbs it.
        const drift = 100 - split.reduce((a, b) => a + b, 0);
        split[split.indexOf(Math.max(...split))]! += drift;
        setPercent({ protein: String(split[0]), carbs: String(split[1]), fat: String(split[2]) });
      }
    } else if (calorieGoal && percentValid) {
      const computed = macroGramsFromPercent(calorieGoal, {
        protein: numberOf(percent.protein) ?? 0,
        carbs: numberOf(percent.carbs) ?? 0,
        fat: numberOf(percent.fat) ?? 0,
      });
      setGrams({ protein: String(computed.protein), carbs: String(computed.carbs), fat: String(computed.fat) });
    }
    setMode(next);
  };

  const percentGrams =
    calorieGoal && percentValid
      ? macroGramsFromPercent(calorieGoal, {
          protein: numberOf(percent.protein) ?? 0,
          carbs: numberOf(percent.carbs) ?? 0,
          fat: numberOf(percent.fat) ?? 0,
        })
      : null;

  const save = async () => {
    if (mode === 'percent' && (!percentValid || !calorieGoal)) {
      haptics.rejected();
      void showAlert(
        !calorieGoal ? 'Set a calorie goal first' : 'Percentages must add up to 100',
        !calorieGoal
          ? 'Percentages are a share of the calorie goal, so they need one to turn into grams.'
          : `They add up to ${Math.round(percentSum)} right now.`,
      );
      return;
    }

    const targets: NutrientValues = parseNutrientDraft(others);
    if (calorieGoal !== null) targets.calories = calorieGoal;
    const macros =
      mode === 'percent' && percentGrams
        ? percentGrams
        : { protein: numberOf(grams.protein), carbs: numberOf(grams.carbs), fat: numberOf(grams.fat) };
    for (const macro of MACROS) {
      const value = macros[macro.key];
      if (value !== null && value !== undefined) targets[macro.key] = value;
    }

    setSaving(true);
    try {
      await nutritionApi.setGoals({ targets });
      await client.invalidateQueries({ queryKey: nutritionKeys.profile });
      haptics.logged();
      router.back();
    } catch (failure) {
      haptics.rejected();
      void showAlert('Could not save', describeError(failure));
    } finally {
      setSaving(false);
    }
  };

  const addNutrient = async (name: string, unit: string) => {
    try {
      await nutritionApi.createNutrient({ name, unit });
      await client.invalidateQueries({ queryKey: nutritionKeys.profile });
      haptics.added();
    } catch (failure) {
      haptics.rejected();
      void showAlert('Could not add it', describeError(failure));
    }
  };

  const renameNutrient = async (nutrient: CustomNutrient, name: string, unit: string) => {
    try {
      await nutritionApi.updateNutrient(nutrient.id, { name, unit });
      await client.invalidateQueries({ queryKey: nutritionKeys.profile });
      setEditing(null);
    } catch (failure) {
      void showAlert('Could not save', describeError(failure));
    }
  };

  const deleteNutrient = async (nutrient: CustomNutrient) => {
    const confirmed = await showConfirm({
      title: `Stop tracking ${nutrient.name}?`,
      message:
        'It disappears from forms, the diary and your goals. Amounts already logged are kept, so adding it back does not lose anything.',
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    try {
      await nutritionApi.deleteNutrient(nutrient.id);
      setOthers((draft) => {
        const next = { ...draft };
        delete next[nutrient.id];
        return next;
      });
      await client.invalidateQueries({ queryKey: nutritionKeys.profile });
      haptics.destructive();
    } catch (failure) {
      void showAlert('Could not remove it', describeError(failure));
    }
  };

  const custom = profile?.customNutrients ?? [];
  const otherDefinitions: NutrientDefinition[] = BUILT_IN_NUTRIENTS.filter(
    (n) => !(CORE_NUTRIENT_KEYS as readonly string[]).includes(n.key),
  );
  const setCount = Object.values(others).filter((v) => numberOf(v) !== null).length;

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: 'Goals & nutrients',
          headerRight: () => (
            <HeaderAction
              label="Save goals"
              title="Save"
              variant="filled"
              disabled={saving || !loaded}
              onPress={() => void save()}
            />
          ),
        }}
      />
      {isPending ? (
        <ActivityIndicator style={styles.loading} />
      ) : error ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Could not load your goals"
          description={describeError(error)}
          action={<Button title="Try again" variant="secondary" onPress={() => void refetch()} />}
        />
      ) : (
        <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SectionHeader title="Daily calories" />
          <Card padded={false} style={styles.card}>
            <TargetRow label="Calories" unit="kcal" value={calories} onChange={setCalories} />
          </Card>

          <SectionHeader title="Macros" />
          <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={switchMode} size="sm" label="Macro goals in" />
          <Card padded={false} style={styles.card}>
            {MACROS.map((macro, index) => (
              <View key={macro.key}>
                {index > 0 && <Divider />}
                {mode === 'grams' ? (
                  <TargetRow
                    label={macro.label}
                    unit="g"
                    dot={tint[macro.key]}
                    value={grams[macro.key]}
                    onChange={(text) => setGrams((g) => ({ ...g, [macro.key]: text }))}
                  />
                ) : (
                  <View>
                    <TargetRow
                      label={macro.label}
                      unit="%"
                      dot={tint[macro.key]}
                      value={percent[macro.key]}
                      onChange={(text) => setPercent((p) => ({ ...p, [macro.key]: text }))}
                    />
                  </View>
                )}
              </View>
            ))}
          </Card>
          {mode === 'percent' && (
            <Text variant="caption" color={percentValid ? 'textTertiary' : 'danger'} style={styles.note}>
              {percentValid
                ? percentGrams
                  ? `That is ${percentGrams.protein} g protein, ${percentGrams.carbs} g carbs and ${percentGrams.fat} g fat a day.`
                  : 'Set a calorie goal to turn these into grams.'
                : `Adds up to ${Math.round(percentSum)}%. Make it 100.`}
            </Text>
          )}

          <CollapsibleSection
            title="Other nutrients"
            summary={setCount > 0 ? `${setCount} set` : 'None set'}
            defaultExpanded={setCount > 0}
          >
            <Card padded={false} style={styles.card}>
              {[
                ...otherDefinitions.map((n) => ({ key: n.key, label: n.label, unit: n.unit as string })),
                ...custom.map((c) => ({ key: c.id, label: c.name, unit: c.unit })),
              ].map((n, index) => (
                <View key={n.key}>
                  {index > 0 && <Divider />}
                  <TargetRow
                    label={n.label}
                    unit={n.unit}
                    value={others[n.key] ?? ''}
                    onChange={(text) => setOthers((draft) => ({ ...draft, [n.key]: text }))}
                  />
                </View>
              ))}
            </Card>
          </CollapsibleSection>

          <SectionHeader title="Your nutrients" />
          <Text variant="caption" color="textTertiary" style={styles.note}>
            Track anything the built-in list does not have, like caffeine or omega-3. They appear on every food form,
            in the diary, and in AI estimates.
          </Text>
          <Card padded={false} style={styles.card}>
            {custom.map((nutrient, index) => (
              <View key={nutrient.id}>
                {index > 0 && <Divider />}
                {editing === nutrient.id ? (
                  <NutrientForm
                    initial={nutrient}
                    submitLabel="Save"
                    onSubmit={(name, unit) => renameNutrient(nutrient, name, unit)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <View style={styles.customRow}>
                    <Text variant="body" style={styles.rowLabel}>
                      {nutrient.name}
                      <Text variant="caption" color="textTertiary">{`  ${nutrient.unit}`}</Text>
                    </Text>
                    <IconButton
                      name="create-outline"
                      accessibilityLabel={`Rename ${nutrient.name}`}
                      onPress={() => setEditing(nutrient.id)}
                    />
                    <IconButton
                      name="trash-outline"
                      color={colors.danger}
                      accessibilityLabel={`Remove ${nutrient.name}`}
                      onPress={() => void deleteNutrient(nutrient)}
                    />
                  </View>
                )}
              </View>
            ))}
            {custom.length > 0 && <Divider />}
            <NutrientForm submitLabel="Add nutrient" onSubmit={addNutrient} />
          </Card>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: spacing.huge },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.huge },
  card: { paddingHorizontal: spacing.lg },
  note: { paddingHorizontal: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowLabel: { flex: 1 },
  rowInput: {
    width: 96,
    textAlign: 'right',
    fontSize: fontSize.md,
    ...font('semibold'),
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    borderWidth: stroke.outline,
    fontVariant: ['tabular-nums'],
  },
  rowUnit: { width: 30 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  form: { paddingVertical: spacing.md, gap: spacing.sm },
  formFields: { flexDirection: 'row', gap: spacing.sm },
  formName: { flex: 2 },
  formUnit: { flex: 1 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
