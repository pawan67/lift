/**
 * One-tap adds under a meal in the diary, so the foods eaten every day never
 * need the add screen at all.
 *
 * Two kinds of chip:
 * - "Same as yesterday", when this meal is empty and the day before had one.
 *   It copies that meal as it was, which is the commonest repeat there is.
 * - The foods usually eaten at this meal (see `usualAt`), at the amount used
 *   last time, leaving out what the meal already has.
 *
 * A tap logs straight away and says so under the chips with Undo, the same as
 * the add screen, so a stray tap is one more tap to take back. Habits show on
 * today's diary and on any day whose meal is still empty; a filled meal on a
 * past day is history being read, and chips there would be noise.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  formatCalories,
  itemTotals,
  recentKey,
  totalsOf,
  usualAt,
  type FoodEntry,
  type Meal,
  type RecentItem,
} from '@lift/shared';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Chip, Text } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { showDialog } from '@/store/dialog';
import { HIT_SLOP, radius, spacing, useColors } from '@/theme';

import { shiftIso } from '../dates';
import { describeError, useCopyEntries, useCreateEntries, useDeleteEntries, useRecents } from '../queries';

interface Props {
  date: string;
  meal: Meal;
  /** Whether `date` is today: habits are offered on today even when the meal has food. */
  isToday: boolean;
  /** What the meal has on `date`. */
  current: FoodEntry[];
  /** What the same meal had the day before, or empty when unknown. */
  previous: FoodEntry[];
}

export function MealSuggestions({ date, meal, isToday, current, previous }: Props) {
  const colors = useColors();
  const recents = useRecents();
  const create = useCreateEntries();
  const copy = useCopyEntries();
  const remove = useDeleteEntries(date);
  const [note, setNote] = useState<{ name: string; ids: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const empty = current.length === 0;
  const exclude = useMemo(() => new Set(current.map(recentKey)), [current]);
  const usual = useMemo(
    () => (empty || isToday ? usualAt(recents.data ?? [], meal, { exclude, limit: 4 }) : []),
    [empty, isToday, recents.data, meal, exclude],
  );
  const repeat = empty && previous.length > 0;
  const dayBefore = isToday ? 'yesterday' : 'the day before';

  if (!note && !repeat && usual.length === 0) return null;

  const run = async (name: string, action: () => Promise<FoodEntry[]>) => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await action();
      haptics.logged();
      setNote({ name, ids: created.map((entry) => entry.id) });
    } catch (error) {
      haptics.rejected();
      await showDialog({ title: 'Could not add', message: describeError(error) });
    } finally {
      setBusy(false);
    }
  };

  const addRecent = (item: RecentItem) => {
    const { lastLoggedAt: _at, timesLogged: _times, meals: _meals, ...entryItem } = item;
    void run(item.name, () => create.mutateAsync({ date, meal, items: [entryItem] }));
  };

  const repeatYesterday = () =>
    void run(`${dayBefore}'s ${previous.length === 1 ? previous[0]!.name : `${previous.length} items`}`, () =>
      copy.mutateAsync({ from: { date: shiftIso(date, -1), meal }, to: { date, meal } }),
    );

  const undo = () => {
    if (!note) return;
    haptics.destructive();
    remove.mutate(note.ids);
    setNote(null);
  };

  return (
    <View style={styles.wrap}>
      {repeat || usual.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          {repeat ? (
            <Chip
              icon="repeat"
              label={`Same as ${dayBefore} · ${formatCalories(totalsOf(previous).calories)} kcal`}
              onPress={repeatYesterday}
              accessibilityLabel={`Copy ${dayBefore}'s ${meal}, ${formatCalories(totalsOf(previous).calories)} calories`}
            />
          ) : null}
          {usual.map((item) => (
            <Chip
              key={recentKey(item)}
              icon="add"
              label={`${shorten(item.name)} · ${formatCalories(itemTotals(item).calories)} kcal`}
              onPress={() => addRecent(item)}
              accessibilityLabel={`Add ${item.name}, ${formatCalories(itemTotals(item).calories)} calories`}
            />
          ))}
        </ScrollView>
      ) : null}

      {note ? (
        <View style={[styles.note, { backgroundColor: colors.successSurface }]} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text variant="caption" color="success" numberOfLines={1} style={styles.noteText}>
            Added {note.name}
          </Text>
          <Pressable onPress={undo} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel={`Undo adding ${note.name}`}>
            <Text variant="label" color="success">
              Undo
            </Text>
          </Pressable>
          <Pressable onPress={() => setNote(null)} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Ionicons name="close" size={16} color={colors.success} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** Chips sit in one scrolling row; a long product name would fill the screen with one food. */
function shorten(name: string): string {
  return name.length > 26 ? `${name.slice(0, 25).trimEnd()}…` : name;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  // The chips scroll edge to edge of the meal block, so a long name is not cut
  // and the row never wraps into a wall of buttons.
  chips: { gap: spacing.sm },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  noteText: { flex: 1 },
});
