import { Ionicons } from '@expo/vector-icons';
import {
  EQUIPMENT_LABELS,
  formatVolume,
  MUSCLE_GROUP_LABELS,
  type WeightUnit,
} from '@lift/shared';
import { router, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card, EmptyState, Screen, Text, useScrollEdge } from '@/components/ui';
import { pluralSessions } from '@/features/analytics/format';
import { getMainExercises, type MainExercise } from '@/features/analytics/exercise-stats';
import { RangePicker } from '@/features/analytics/range-picker';
import type { StatRange } from '@/features/analytics/windows';
import { ExerciseThumbnail } from '@/features/exercises/exercise-thumbnail';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { radius, spacing, useColors } from '@/theme';

/** How many rows carry a rank badge before the list becomes an ordinary list. */
const RANKED = 3;

export default function MainExercisesScreen() {
  const scrollEdge = useScrollEdge();

  const weightUnit = useSettings((state) => state.weightUnit);
  const bodyweightKg = useSettings((state) => state.bodyweightKg);
  const formula = useSettings((state) => state.oneRepMaxFormula);

  const [range, setRange] = useState<StatRange>('30d');
  const [result, setResult] = useState<Awaited<ReturnType<typeof getMainExercises>> | null>(null);

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const next = await getMainExercises(range, { bodyweightKg, formula }).catch(() => null);
        if (!cancelled) setResult(next);
      })();

      return () => {
        cancelled = true;
      };
    }, [range, bodyweightKg, formula]),
  );

  const ranged = result?.range === range ? result : null;

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Main exercises' }} />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        <RangePicker value={range} onChange={setRange} />

        {!ranged ? null : ranged.exercises.length === 0 ? (
          <EmptyState
            icon="barbell-outline"
            title="No exercises in this range"
            description="Every lift you complete a working set of shows up here, ordered by how often you train it."
          />
        ) : (
          <>
            <Text variant="caption" color="textTertiary" style={styles.summary}>
              {ranged.exercises.length} exercises across {pluralSessions(ranged.sessions)} ·{' '}
              {ranged.totalSets} working sets
            </Text>

            <Card padded={false}>
              {ranged.exercises.map((exercise, index) => (
                <ExerciseStatRow
                  key={exercise.id}
                  exercise={exercise}
                  rank={index < RANKED ? index + 1 : null}
                  sessions={ranged.sessions}
                  weightUnit={weightUnit}
                />
              ))}
            </Card>

            <Text variant="caption" color="textTertiary" style={styles.footnote}>
              Ordered by how many sessions each lift appeared in, not by set count. Five sets of
              curls in one session should not outrank three separate squat days. Warm-ups are not
              counted.
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function ExerciseStatRow({
  exercise,
  rank,
  sessions,
  weightUnit,
}: {
  exercise: MainExercise;
  rank: number | null;
  sessions: number;
  weightUnit: WeightUnit;
}) {
  const colors = useColors();

  const share = sessions === 0 ? 0 : Math.round((exercise.times / sessions) * 100);
  const detail = `${exercise.sets} sets · ${formatVolume(exercise.volumeKg, weightUnit)} · ${
    MUSCLE_GROUP_LABELS[exercise.primaryMuscle]
  }`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        rank ? `Number ${rank}` : null,
        exercise.name,
        `${pluralSessions(exercise.times)}, ${share}% of sessions`,
        detail,
        EQUIPMENT_LABELS[exercise.equipment],
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: exercise.id } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      <ExerciseThumbnail name={exercise.name} url={exercise.thumbnailUrl} size={44} />

      <View style={styles.body}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {exercise.name}
        </Text>
        <Text variant="label" color="textSecondary" numberOfLines={1}>
          {pluralSessions(exercise.times)} · {share}% of sessions
        </Text>
        <Text variant="caption" color="textTertiary" numberOfLines={1}>
          {detail}
        </Text>
      </View>

      {/*
        A rank marker on the top three only.
        Numbering all forty rows turns a ranked list into a numbered one: the
        badge stops meaning "this is what you train" and starts meaning "this is
        row 27". Three is what a person remembers about their own programme.

        Neutral rather than the accent tint it was: three accented pills down
        one list is three times the budget, and the badge already prints the
        rank as a digit.
      */}
      {rank !== null && (
        <View style={[styles.rank, { backgroundColor: colors.surfaceMuted }]}>
          <Text variant="caption" color="textSecondary">
            {rank}
          </Text>
        </View>
      )}

      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
  summary: { paddingHorizontal: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  body: { flex: 1, gap: 2 },
  rank: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footnote: { paddingHorizontal: spacing.xs },
});
