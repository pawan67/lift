/**
 * Saved meals: the foods eaten together often enough to log in one tap.
 *
 * Ordered most used first (the server sorts by `useCount`), so the breakfast
 * eaten every day sits at the top without anyone arranging it. The card's own
 * Log button logs to today, into the template's usual meal; long-pressing the
 * card is the way to send it somewhere else, which is the rarer case and so is
 * one gesture further away.
 */

import { MEALS, MEAL_LABELS, formatCalories, totalsOf, type Meal, type MealTemplate } from '@lift/shared';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  EmptyState,
  HeaderAction,
  PressableScale,
  Screen,
  Text,
  useScrollEdge,
} from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { describeDay, todayIso } from '@/features/nutrition/dates';
import { describeError, useLogTemplate, useTemplates } from '@/features/nutrition/queries';
import { macroColors } from '@/features/nutrition/components/summary';
import { showAlert, showDialog } from '@/store/dialog';
import { radius, spacing, useColors } from '@/theme';

function TemplateCard({
  template,
  logging,
  logged,
  onLog,
  onChooseMeal,
}: {
  template: MealTemplate;
  logging: boolean;
  logged: boolean;
  onLog: () => void;
  onChooseMeal: () => void;
}) {
  const colors = useColors();
  const tint = macroColors(colors);
  const totals = totalsOf(template.items);
  const count = template.items.length;

  return (
    // A pressable drawn as a card rather than `Card` itself: `Card` takes a
    // press but not a long press, and the long press is how a template goes to
    // a meal other than its usual one.
    <PressableScale
      onPress={() => router.push({ pathname: '/food/template', params: { id: template.id } })}
      onLongPress={onChooseMeal}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityHint="Opens the template. Long press to log it to another meal."
      fill={colors.surface}
      fillPressed={colors.surfacePressed}
      style={styles.card}
    >
      <View style={styles.cardHead}>
        <View style={styles.cardTitle}>
          <Text variant="subheading" numberOfLines={1}>
            {template.name}
          </Text>
          <View style={styles.badges}>
            {template.meal ? <Badge label={MEAL_LABELS[template.meal]} tone="neutral" /> : null}
            <Text variant="caption" color="textTertiary">
              {count === 1 ? '1 food' : `${count} foods`}
              {template.useCount > 0 ? `  ·  logged ${template.useCount}×` : ''}
            </Text>
          </View>
        </View>
        <Button
          title={logged ? 'Logged' : 'Log'}
          icon={logged ? 'checkmark' : 'add'}
          size="sm"
          variant={logged ? 'success' : 'primary'}
          loading={logging}
          onPress={onLog}
          accessibilityLabel={`Log ${template.name} to ${MEAL_LABELS[template.meal ?? 'snacks']} today`}
        />
      </View>

      <View style={styles.figures}>
        <Text variant="numeric">
          {formatCalories(totals.calories)}
          <Text variant="caption" color="textTertiary">
            {' kcal'}
          </Text>
        </Text>
        {(['protein', 'carbs', 'fat'] as const).map((key) => (
          <View key={key} style={styles.macro}>
            <View style={[styles.dot, { backgroundColor: tint[key] }]} />
            <Text variant="caption" color="textSecondary">
              {Math.round(totals[key] ?? 0)}g {key === 'protein' ? 'protein' : key}
            </Text>
          </View>
        ))}
      </View>

      <Text variant="caption" color="textTertiary" numberOfLines={2}>
        {template.items.map((item) => item.name).join(', ')}
      </Text>
    </PressableScale>
  );
}

export default function TemplatesScreen() {
  const scrollEdge = useScrollEdge();
  const { data: templates, isPending, error, refetch } = useTemplates();
  const logTemplate = useLogTemplate();
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [loggedIds, setLoggedIds] = useState<ReadonlySet<string>>(new Set());

  const log = async (template: MealTemplate, meal: Meal) => {
    setLoggingId(template.id);
    try {
      await logTemplate.mutateAsync({ id: template.id, input: { date: todayIso(), meal } });
      haptics.logged();
      setLoggedIds((ids) => new Set(ids).add(template.id));
    } catch (failure) {
      haptics.rejected();
      void showAlert('Could not log it', describeError(failure));
    } finally {
      setLoggingId(null);
    }
  };

  const chooseMeal = async (template: MealTemplate) => {
    haptics.selection();
    const chosen = await showDialog({
      title: `Log ${template.name}`,
      message: `Add it to ${describeDay(todayIso()).toLowerCase()}'s…`,
      actions: [...MEALS.map((meal) => ({ label: MEAL_LABELS[meal] })), { label: 'Cancel', style: 'cancel' as const }],
    });
    const meal = MEALS[chosen];
    if (meal) await log(template, meal);
  };

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: 'Templates',
          headerRight: () => (
            <HeaderAction
              label="New template"
              title="New"
              variant="filled"
              onPress={() => router.push('/food/template')}
            />
          ),
        }}
      />
      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        {isPending ? (
          <ActivityIndicator style={styles.loading} />
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Could not load templates"
            description={describeError(error)}
            action={<Button title="Try again" variant="secondary" onPress={() => void refetch()} />}
          />
        ) : !templates?.length ? (
          <EmptyState
            icon="albums-outline"
            title="No templates yet"
            description="A template is a group of foods you eat together, logged in one tap. Build one here, or open a meal in your diary and choose Save as template."
            action={<Button title="New template" icon="add" onPress={() => router.push('/food/template')} />}
          />
        ) : (
          templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              logging={loggingId === template.id}
              logged={loggedIds.has(template.id)}
              onLog={() => void log(template, template.meal ?? 'snacks')}
              onChooseMeal={() => void chooseMeal(template)}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.huge },
  loading: { marginTop: spacing.huge },
  card: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardTitle: { flex: 1, gap: spacing.xs },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  figures: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  macro: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
