import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { EQUIPMENT_LABELS, type Equipment, type MuscleGroup } from '@lift/shared';
import {
  buildTrainingIndex,
  countExercisesPerMuscle,
  filterExercises,
  suggestExercises,
} from '@lift/shared/exercises';
import { asc, isNull } from 'drizzle-orm';
import { router, Stack } from 'expo-router';
import { Fragment, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Divider,
  EmptyState,
  FilterSelect,
  HeaderAction,
  Screen,
  SearchBar,
  SectionHeader,
  Text,
  useScrollEdge,
} from '@/components/ui';
import { db } from '@/db/client';
import { exercises as exercisesTable } from '@/db/schema';
import { useRows } from '@/db/use-rows';
import { ExerciseRow } from '@/features/exercises/exercise-row';
import { MuscleFilter } from '@/features/exercises/muscle-filter';
import {
  exerciseListColumns,
  trainingHistoryQuery,
  type ExerciseListItem,
} from '@/features/exercises/repository';
import { useDebounced } from '@/hooks/use-debounced';
import { useScrollToTopOn } from '@/hooks/use-scroll-to-top-on';
import { useExercisePicker } from '@/store/exercise-picker';
import { spacing } from '@/theme';

/** Hoisted so the list reuses separators instead of remounting them. */
function ListSeparator() {
  return <Divider inset={70} />;
}

interface SuggestionsProps {
  exercises: ExerciseListItem[];
  /** True when the workout being built is what shaped the order. */
  fromContext: boolean;
  selected: ReadonlySet<string>;
  /** Each selected id's place in the selection, from 1. */
  order: ReadonlyMap<string, number>;
  onPress: (exercise: ExerciseListItem) => void;
}

/**
 * The short list, above the catalog.
 *
 * Mid-workout the exercise you are reaching for is nearly always one you have
 * done before, and the catalog answers that with 6,800 rows and a keyboard.
 * Eight rows answer it with a thumb.
 *
 * Deliberately the same rows as the list below it, under a plain section
 * header: this is a shortcut into the catalog, not a second, richer way of
 * choosing. A carousel or a card deck here would out-shout the list that
 * actually holds everything.
 *
 * The subtitle exists because a ranked list that doesn't say what it ranked on
 * reads as an arbitrary one, and this one is worth trusting.
 */
function Suggestions({ exercises, fromContext, selected, order, onPress }: SuggestionsProps) {
  return (
    <View>
      <SectionHeader title={fromContext ? 'Suggested' : 'Your lifts'} />
      <Text variant="caption" color="textTertiary" style={styles.suggestionNote}>
        {fromContext
          ? 'What you usually train alongside this session'
          : 'What you train most often'}
      </Text>
      {exercises.map((exercise, index) => (
        <Fragment key={exercise.id}>
          {index > 0 && <ListSeparator />}
          <ExerciseRow
            exercise={exercise}
            selectable
            selected={selected.has(exercise.id)}
            order={order.get(exercise.id)}
            onPress={onPress}
          />
        </Fragment>
      ))}
      <SectionHeader title="All exercises" />
    </View>
  );
}

/**
 * Multi-select exercise picker.
 *
 * Publishes the chosen ids to `useExercisePicker` rather than writing to the
 * database itself: the caller knows whether they're building a routine or
 * adding to a live workout, and this screen shouldn't. It doesn't address the
 * delivery either: the opener stamps the channel with its own name before
 * navigating here, so this screen still needs to know nothing about it.
 */
export default function ExercisePickerScreen() {
  const scrollEdge = useScrollEdge();

  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState('');
  const [muscles, setMuscles] = useState<MuscleGroup[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  // A Set, not an array: `selected.includes(id)` ran once per rendered row on
  // every keystroke and every toggle. This screen opens mid-set, with the
  // keyboard already up. It is the most latency-sensitive list in the app.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const { rows: allExercises, loaded } = useRows(
    db
      .select(exerciseListColumns)
      .from(exercisesTable)
      .where(isNull(exercisesTable.deletedAt))
      .orderBy(asc(exercisesTable.name)),
  );

  const { rows: history, loaded: historyLoaded } = useRows(trainingHistoryQuery());

  // What the opener already has on its list. Read once on mount: the workout
  // behind this screen cannot change while the picker is up, and re-ranking the
  // suggestions under the user's thumb is the one thing this block must not do.
  const [context] = useState(() => useExercisePicker.getState().context);

  const index = useMemo(() => buildTrainingIndex(history), [history]);

  // Debounced then deferred, for the same reason as the library screen: the
  // field must never wait on a 6,800-row filter, and it should not run that
  // filter once per character either. See the note there. This screen opens
  // mid-set with the keyboard already up, so it is the one that feels it.
  const debouncedSearch = useDebounced(search);
  const deferredSearch = useDeferredValue(debouncedSearch);

  const suggestions = useMemo(
    () => suggestExercises({ catalog: allExercises, index, context }),
    [allExercises, index, context],
  );

  // The suggestion block belongs to the *deferred* view, so it disappears on the
  // same frame the list stops being the full catalog. Keyed off `search` it
  // would vanish one render before the rows it sits above changed.
  const browsing = deferredSearch.length === 0 && muscles.length === 0 && equipment.length === 0;
  const suggesting = browsing && suggestions.length > 0;

  const visible = useMemo(
    () =>
      filterExercises(
        allExercises,
        { search: deferredSearch, muscles, equipment },
        // Usage ranking is handed to the list only when the block above it is
        // *not* showing. Both would otherwise open on the same four lifts, one
        // set under the other, and the shortcut would look like a duplicate of
        // the first screenful rather than a shortcut past it. Filtered or
        // searched, the block is gone and the list takes the job back.
        suggesting ? undefined : index.usage,
      ),
    [allExercises, deferredSearch, muscles, equipment, index, suggesting],
  );

  const equipmentOptions = useMemo(() => {
    const counts = new Map<Equipment, number>();
    for (const exercise of allExercises) {
      if (exercise.isArchived) continue;
      counts.set(exercise.equipment, (counts.get(exercise.equipment) ?? 0) + 1);
    }
    return [...counts]
      .map(([value, count]) => ({ value, label: EQUIPMENT_LABELS[value], count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allExercises]);

  const muscleCounts = useMemo(() => countExercisesPerMuscle(allExercises), [allExercises]);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      // `delete` reports whether it was there, so this is one lookup, not two.
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // Each selected id's place in the order it will be added, which a Set keeps.
  const order = useMemo(
    () => new Map([...selected].map((id, index) => [id, index + 1])),
    [selected],
  );

  // One stable handler for every row rather than an arrow per row: `ExerciseRow`
  // hands its own exercise back, and its `memo` can only hold if the callback
  // identity survives a re-render. Toggling then re-renders exactly one row.
  const handlePress = useCallback((exercise: ExerciseListItem) => toggle(exercise.id), [toggle]);

  const renderItem = useCallback(
    ({ item }: { item: ExerciseListItem }) => (
      <ExerciseRow
        exercise={item}
        selectable
        selected={selected.has(item.id)}
        order={order.get(item.id)}
        onPress={handlePress}
      />
    ),
    [selected, order, handlePress],
  );

  const listRef = useRef<FlashListRef<ExerciseListItem>>(null);

  // Same key as the library screen: everything that changes what the list *is*.
  // Selecting a row deliberately is not in it, since toggling a checkbox must
  // not throw away the reader's place in the results.
  useScrollToTopOn(listRef, [deferredSearch, ...muscles, ...equipment].join('\u0000'));

  // Both queries have to have answered before anything renders. Not for the
  // catalog's sake (it is empty either way) but so the suggestion block can't
  // appear a frame late and shove the first rows of the list down under a
  // thumb already on its way to one of them.
  const ready = loaded && historyLoaded;

  const showSuggestions = ready && suggesting;

  const submit = useExercisePicker((state) => state.submit);

  const confirm = () => {
    if (selected.size === 0) return;
    // Publish before dismissing. Order matters: exercises are added in the
    // order the user picked them, which a Set preserves: re-selecting after a
    // deselect moves the id to the end, exactly as the array version did.
    submit([...selected]);
    router.back();
  };

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: 'Add exercise',
          // Both stay plain, and the pair is the reason why. The action this
          // screen exists to complete is the confirm bar at its foot. It is
          // the one that carries the count of what you picked, so filling
          // either of these would put the emphasis on leaving or on a detour.
          headerLeft: () => (
            <HeaderAction
              side="left"
              label="Cancel adding exercises"
              title="Cancel"
              onPress={() => router.back()}
            />
          ),
          headerRight: () => (
            <HeaderAction
              label="Create custom exercise"
              title="New"
              onPress={() => router.push('/exercise/new')}
            />
          ),
        }}
      />

      <View style={styles.header}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          onClear={() => setSearch('')}
          placeholder="Search exercises"
          autoFocus
        />

        <View style={styles.filters}>
          <MuscleFilter values={muscles} onChange={setMuscles} counts={muscleCounts} />
          <FilterSelect
            label="Equipment"
            values={equipment}
            options={equipmentOptions}
            onChange={setEquipment}
          />
        </View>
      </View>

      <FlashList
        ref={listRef}
        {...scrollEdge.list}
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={ListSeparator}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          showSuggestions ? (
            <Suggestions
              exercises={suggestions}
              fromContext={context.length > 0}
              selected={selected}
              order={order}
              onPress={handlePress}
            />
          ) : null
        }
        ListEmptyComponent={
          // Only once the query has reported. Seeded to `[]` it would otherwise
          // announce that 6,800 exercises don't exist for the first frame.
          ready ? (
            <EmptyState
              icon="search"
              title="No matches"
              description="Try a different search, or create a custom exercise."
            />
          ) : null
        }
      />

      {selected.size > 0 && (
        // The confirm bar is the lowest thing on screen, so it carries the
        // system navigation inset itself rather than padding the whole Screen
        // (which would leave a dead strip under the list when the bar is
        // hidden).
        <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
          <Button
            title={`Add ${selected.size} ${selected.size === 1 ? 'exercise' : 'exercises'}`}
            fullWidth
            size="lg"
            onPress={confirm}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  filters: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  suggestionNote: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  footer: { padding: spacing.lg },
});
