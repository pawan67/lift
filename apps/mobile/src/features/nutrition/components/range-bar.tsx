/**
 * Choosing the window the food statistics read: a row of presets that starts
 * at a single day, arrows that step the same length of time back and forward,
 * and a calendar for any pair of dates.
 *
 * The calendar is taps only (a month at a time, with arrows) rather than a
 * swipeable pager: scroll gestures inside a sheet are unreliable on Android
 * here, and two taps is all a range needs anyway.
 */

import { isoDaysBetween, shiftIsoDate } from '@lift/shared';
import { addMonths, format, parseISO, startOfMonth } from 'date-fns';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip, IconButton, Sheet, SheetScrollView, Text, useSheetLayout } from '@/components/ui';
import { weekdayHeadings } from '@/features/analytics/calendar';
import { haptics } from '@/features/feedback/haptics';
import { toIsoDate } from '@/features/nutrition/dates';
import {
  describeRange,
  FOOD_RANGE_PRESETS,
  MAX_RANGE_DAYS,
  nameRange,
  presetRange,
  rangeLength,
  stepRange,
  type FoodRange,
} from '@/features/nutrition/range';
import { useSettings } from '@/store/settings';
import { mix, radius, readableOn, spacing, stroke, useColors } from '@/theme';

export function RangeBar({
  range,
  today,
  onChange,
}: {
  range: FoodRange;
  today: string;
  onChange: (range: FoodRange) => void;
}) {
  const colors = useColors();
  const [picking, setPicking] = useState(false);
  // Each opening mounts a fresh calendar, so it starts from the range on screen
  // rather than from a half-finished pick. Closing keeps the same instance, so
  // the sheet still animates away.
  const [opened, setOpened] = useState(0);
  const pick = () => {
    setOpened((count) => count + 1);
    setPicking(true);
  };
  const length = rangeLength(range);
  const atToday = range.to >= today;

  const change = (next: FoodRange) => {
    haptics.selection();
    onChange(next);
  };

  return (
    <View style={styles.bar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {FOOD_RANGE_PRESETS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            selected={range.preset === option.value}
            onPress={() => change(presetRange(option.value, today))}
          />
        ))}
        <Chip label="Custom" icon="calendar-outline" selected={range.preset === 'custom'} onPress={pick} />
      </ScrollView>

      <View style={[styles.stepper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <IconButton
          name="chevron-back"
          accessibilityLabel={length === 1 ? 'The day before' : `The ${length} days before`}
          onPress={() => change(stepRange(range, -1, today))}
        />
        <Pressable
          style={styles.stepperLabel}
          onPress={pick}
          accessibilityRole="button"
          accessibilityLabel={`${describeRange(range, today)}. Choose dates`}
        >
          <Text variant="bodyMedium" numberOfLines={1}>
            {describeRange(range, today)}
          </Text>
          <Text variant="caption" color="textTertiary">
            {length === 1 ? format(parseISO(range.to), 'EEEE') : `${length} days`}
          </Text>
        </Pressable>
        <IconButton
          name="chevron-forward"
          accessibilityLabel={length === 1 ? 'The day after' : `The ${length} days after`}
          disabled={atToday}
          color={atToday ? colors.border : undefined}
          onPress={() => change(stepRange(range, 1, today))}
        />
      </View>

      <RangeSheet
        key={opened}
        visible={picking}
        range={range}
        today={today}
        onClose={() => setPicking(false)}
        onApply={(next) => {
          setPicking(false);
          change(next);
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------

function RangeSheet({
  visible,
  range,
  today,
  onClose,
  onApply,
}: {
  visible: boolean;
  range: FoodRange;
  today: string;
  onClose: () => void;
  onApply: (range: FoodRange) => void;
}) {
  const colors = useColors();
  const { bottomInset } = useSheetLayout();
  const firstDayOfWeek = useSettings((state) => state.firstDayOfWeek);
  const [start, setStart] = useState(range.from);
  const [end, setEnd] = useState<string | null>(range.to);
  const [month, setMonth] = useState(() => startOfMonth(parseISO(range.to)));

  const headings = useMemo(() => weekdayHeadings(firstDayOfWeek), [firstDayOfWeek]);
  const weeks = useMemo(() => monthWeeks(month, firstDayOfWeek), [month, firstDayOfWeek]);
  const thisMonth = startOfMonth(parseISO(today));
  const canForward = month < thisMonth;

  const tap = (iso: string) => {
    haptics.selection();
    if (end === null && iso >= start) {
      // Second tap: the far end, capped at what the server reads in one go.
      setEnd(isoDaysBetween(start, iso) + 1 > MAX_RANGE_DAYS ? shiftIsoDate(start, MAX_RANGE_DAYS - 1) : iso);
    } else {
      setStart(iso);
      setEnd(null);
    }
  };

  const shortcut = (from: string, to: string) => {
    setStart(from);
    setEnd(to > today ? today : to);
    setMonth(startOfMonth(parseISO(from)));
  };

  const todayDate = parseISO(today);
  const weekStart = toIsoDate(
    new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - ((todayDate.getDay() - firstDayOfWeek + 7) % 7)),
  );
  const monthStart = toIsoDate(thisMonth);
  const lastMonthStart = toIsoDate(addMonths(thisMonth, -1));

  const chosenEnd = end ?? start;
  const days = isoDaysBetween(start, chosenEnd) + 1;

  return (
    <Sheet
      visible={visible}
      label="Choose dates"
      onClose={onClose}
      footer={
        <View style={[styles.footer, { paddingBottom: spacing.md + bottomInset }]}>
          <Text variant="caption" color="textSecondary" style={styles.flex} numberOfLines={2}>
            {end === null
              ? `From ${format(parseISO(start), 'd MMM')}. Tap the last day, or apply for one day.`
              : `${describeRange({ preset: 'custom', from: start, to: chosenEnd }, today)} · ${days} ${days === 1 ? 'day' : 'days'}`}
          </Text>
          <Button title="Apply" size="sm" onPress={() => onApply(nameRange(start, chosenEnd, today))} />
        </View>
      }
    >
      <SheetScrollView contentContainerStyle={styles.sheetBody}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="This week" onPress={() => shortcut(weekStart, today)} />
          <Chip label="Last week" onPress={() => shortcut(shiftIsoDate(weekStart, -7), shiftIsoDate(weekStart, -1))} />
          <Chip label="This month" onPress={() => shortcut(monthStart, today)} />
          <Chip label="Last month" onPress={() => shortcut(lastMonthStart, shiftIsoDate(monthStart, -1))} />
        </ScrollView>

        <View style={styles.monthHead}>
          <IconButton name="chevron-back" accessibilityLabel="Previous month" onPress={() => setMonth((m) => addMonths(m, -1))} />
          <Text variant="subheading" align="center" style={styles.flex}>
            {format(month, 'MMMM yyyy')}
          </Text>
          <IconButton
            name="chevron-forward"
            accessibilityLabel="Next month"
            disabled={!canForward}
            color={canForward ? undefined : colors.border}
            onPress={() => setMonth((m) => addMonths(m, 1))}
          />
        </View>

        <View style={styles.grid}>
          <View style={styles.row}>
            {headings.map((heading) => (
              <Text key={heading.long} variant="caption" color="textTertiary" align="center" style={styles.cell}>
                {heading.narrow}
              </Text>
            ))}
          </View>
          {weeks.map((week, index) => (
            <View key={index} style={styles.row}>
              {week.map((iso, column) => {
                if (!iso) return <View key={column} style={styles.cell} />;
                const future = iso > today;
                const isEdge = iso === start || iso === chosenEnd;
                const inside = iso > start && iso < chosenEnd;
                const fill = isEdge ? colors.accent : inside ? mix(colors.surface, colors.accent, 0.22) : 'transparent';
                return (
                  <Pressable
                    key={iso}
                    disabled={future}
                    onPress={() => tap(iso)}
                    style={[styles.cell, styles.day, { backgroundColor: fill, borderColor: iso === today && !isEdge ? colors.textTertiary : fill }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isEdge || inside, disabled: future }}
                    accessibilityLabel={format(parseISO(iso), 'EEEE d MMMM yyyy')}
                  >
                    <Text
                      variant="body"
                      style={{ color: future ? colors.textTertiary : isEdge ? readableOn(colors.accent, colors) : colors.text }}
                    >
                      {parseISO(iso).getDate()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </SheetScrollView>
    </Sheet>
  );
}

/** The month as rows of seven, `null` for the days that belong to the months either side. */
function monthWeeks(month: Date, firstDayOfWeek: 0 | 1): (string | null)[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() - firstDayOfWeek + 7) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(toIsoDate(new Date(month.getFullYear(), month.getMonth(), day)));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { gap: spacing.sm },
  chips: { gap: spacing.sm, paddingRight: spacing.sm },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: stroke.outline,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  stepperLabel: { flex: 1, alignItems: 'center' },
  sheetBody: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  monthHead: { flexDirection: 'row', alignItems: 'center' },
  grid: { gap: 4 },
  row: { flexDirection: 'row', gap: 4 },
  cell: { flex: 1 },
  day: {
    aspectRatio: 1,
    maxHeight: 44,
    borderRadius: radius.md,
    borderWidth: stroke.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
});
