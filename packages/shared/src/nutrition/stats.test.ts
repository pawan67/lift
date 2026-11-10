import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bucketDays,
  bucketSizeFor,
  buildNutritionStats,
  calorieVerdict,
  eachIsoDate,
  nutritionStatsQuerySchema,
  previousRange,
  shiftIsoDate,
  type StatsEntry,
} from './stats.ts';

function entry(date: string, meal: StatsEntry['meal'], name: string, calories: number, extra: Partial<StatsEntry> = {}): StatsEntry {
  return { date, meal, name, brand: null, quantity: 1, nutrients: { calories, protein: calories / 20 }, ...extra };
}

describe('calendar days', () => {
  it('shifts across month and year ends', () => {
    assert.equal(shiftIsoDate('2026-12-31', 1), '2027-01-01');
    assert.equal(shiftIsoDate('2026-03-01', -1), '2026-02-28');
  });

  it('lists every date in a range, both ends included', () => {
    assert.deepEqual(eachIsoDate('2026-11-08', '2026-11-10'), ['2026-11-08', '2026-11-09', '2026-11-10']);
  });

  it('finds the range of the same length just before', () => {
    assert.deepEqual(previousRange('2026-11-04', '2026-11-10'), { from: '2026-10-28', to: '2026-11-03' });
  });

  it('refuses a range longer than a year or backwards', () => {
    assert.equal(nutritionStatsQuerySchema.safeParse({ from: '2025-01-01', to: '2026-11-10' }).success, false);
    assert.equal(nutritionStatsQuerySchema.safeParse({ from: '2026-11-10', to: '2026-11-01' }).success, false);
    assert.ok(nutritionStatsQuerySchema.safeParse({ from: '2025-11-11', to: '2026-11-10', today: '2026-11-10' }).success);
  });
});

describe('calorie verdict', () => {
  it('allows ten percent either way', () => {
    assert.equal(calorieVerdict(1800, 2000), 'on');
    assert.equal(calorieVerdict(2200, 2000), 'on');
    assert.equal(calorieVerdict(1799, 2000), 'under');
    assert.equal(calorieVerdict(2201, 2000), 'over');
    assert.equal(calorieVerdict(2000, undefined), null);
  });
});

describe('buildNutritionStats', () => {
  const from = '2026-11-04';
  const to = '2026-11-10';
  const entries = [
    entry('2026-11-07', 'breakfast', 'Oats', 400),
    entry('2026-11-07', 'dinner', 'Rice', 1600),
    entry('2026-11-08', 'breakfast', 'Oats', 400),
    entry('2026-11-08', 'lunch', 'Pizza', 2000),
    entry('2026-11-09', 'breakfast', 'oats ', 400),
    entry('2026-11-09', 'snacks', 'Apple', 100, { quantity: 2 }),
    // Today, half eaten.
    entry('2026-11-10', 'breakfast', 'Oats', 400),
  ];

  const stats = buildNutritionStats({
    from,
    to,
    today: to,
    entries,
    targets: { calories: 2000, protein: 150, carbs: 200, fat: 67 },
    loggedDates: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05'],
    previous: [
      { date: '2026-10-30', calories: 1500, protein: 80, carbs: 150, fat: 50, entryCount: 3 },
      { date: '2026-10-31', calories: 2500, protein: 120, carbs: 250, fat: 90, entryCount: 4 },
    ],
  });

  it('counts calendar, logged and counted days', () => {
    assert.equal(stats.days, 7);
    assert.equal(stats.daysLogged, 4);
    // Today is left out of the averages.
    assert.equal(stats.daysCounted, 3);
  });

  it('averages over complete logged days only', () => {
    // (2000 + 2400 + 600) / 3
    assert.equal(Math.round(stats.averages.calories!), 1667);
  });

  it('judges days against the goal, and holds back on today', () => {
    assert.deepEqual(stats.adherence, { under: 1, on: 1, over: 1 });
    const today = stats.daily.find((day) => day.date === to)!;
    assert.equal(today.inProgress, true);
    assert.equal(today.verdict, null);
  });

  it('splits calories by meal over counted days', () => {
    const breakfast = stats.meals.find((meal) => meal.meal === 'breakfast')!;
    assert.equal(breakfast.entries, 3);
    assert.equal(breakfast.average, 400);
    const total = stats.meals.reduce((sum, meal) => sum + meal.share, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
  });

  it('groups foods by name regardless of case and spacing, including today', () => {
    assert.equal(stats.topFoods[0]!.name, 'Oats');
    assert.equal(stats.topFoods[0]!.entries, 4);
    assert.equal(stats.topFoods[0]!.days, 4);
    assert.equal(stats.topCalorieSources[0]!.name, 'Pizza');
    const apple = stats.topFoods.find((food) => food.name === 'Apple')!;
    assert.equal(apple.calories, 200);
  });

  it('keeps a streak running into today, and finds the longest in range', () => {
    // 7, 8, 9, 10 in the range; 6 is missing, so the run starts on the 7th.
    assert.equal(stats.streak.current, 4);
    assert.equal(stats.streak.longest, 4);
  });

  it('does not break the streak for an unlogged today', () => {
    const morning = buildNutritionStats({
      from,
      to,
      today: to,
      entries: entries.filter((e) => e.date !== to),
      targets: {},
      loggedDates: [],
    });
    assert.equal(morning.streak.current, 3);
    assert.equal(morning.adherence, null);
    assert.equal(morning.previous, null);
  });

  it('compares with the range before', () => {
    assert.deepEqual(stats.previous, { daysLogged: 2, averages: { calories: 2000, protein: 100, carbs: 200, fat: 70 } });
  });

  it('splits energy by macro, and reads the goal split from the targets', () => {
    assert.ok(stats.goalSplit);
    assert.ok(Math.abs(stats.goalSplit.protein - 600 / 2003) < 1e-9);
    // Only protein was logged in these entries, so all the macro energy is protein.
    assert.deepEqual(stats.macroSplit, { protein: 1, carbs: 0, fat: 0 });
  });

  it('counts today when it is the only day there is', () => {
    const first = buildNutritionStats({ from, to, today: to, entries: [entry(to, 'lunch', 'Soup', 300)], targets: {}, loggedDates: [] });
    assert.equal(first.daysCounted, 1);
    assert.equal(first.averages.calories, 300);
  });
});

describe('bucketDays', () => {
  const day = (date: string, calories: number, inProgress = false) => ({
    date,
    calories,
    protein: 0,
    carbs: 0,
    fat: 0,
    entryCount: 1,
    verdict: null,
    inProgress,
  });

  it('picks a bar size from the length of the range', () => {
    assert.equal(bucketSizeFor(7), 'day');
    assert.equal(bucketSizeFor(30), 'day');
    assert.equal(bucketSizeFor(91), 'week');
    assert.equal(bucketSizeFor(365), 'month');
  });

  it('keeps empty days as empty bars', () => {
    const buckets = bucketDays([day('2026-11-09', 1800)], '2026-11-08', '2026-11-10', 'day');
    assert.deepEqual(
      buckets.map((b) => [b.start, b.calories, b.daysLogged]),
      [
        ['2026-11-08', 0, 0],
        ['2026-11-09', 1800, 1],
        ['2026-11-10', 0, 0],
      ],
    );
  });

  it('cuts weeks back from the end and averages logged days, leaving today out', () => {
    const buckets = bucketDays(
      [day('2026-10-30', 3000), day('2026-11-04', 2000), day('2026-11-06', 1000), day('2026-11-10', 200, true)],
      '2026-10-30',
      '2026-11-10',
      'week',
    );
    assert.deepEqual(
      buckets.map((b) => [b.start, b.end]),
      [
        ['2026-10-30', '2026-11-03'],
        ['2026-11-04', '2026-11-10'],
      ],
    );
    assert.equal(buckets[1]!.calories, 1500);
    assert.equal(buckets[1]!.daysLogged, 3);
    assert.equal(buckets[1]!.inProgress, false);
  });

  it('clips calendar months to the range', () => {
    const buckets = bucketDays([], '2026-01-15', '2026-03-10', 'month');
    assert.deepEqual(
      buckets.map((b) => [b.start, b.end]),
      [
        ['2026-01-15', '2026-01-31'],
        ['2026-02-01', '2026-02-28'],
        ['2026-03-01', '2026-03-10'],
      ],
    );
  });
});
