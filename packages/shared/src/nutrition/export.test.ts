import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildNutritionExport,
  csvCell,
  describeIsoDate,
  nutritionDailyCsv,
  nutritionEntriesCsv,
  nutritionExportFileName,
} from './export.ts';
import { buildNutritionStats, dayExtremes, weekdayAverages } from './stats.ts';
import type { FoodEntry } from './types.ts';

let position = 0;
function entry(date: string, meal: FoodEntry['meal'], name: string, nutrients: Record<string, number>, quantity = 1): FoodEntry {
  position += 1;
  return {
    id: `e${position}`,
    date,
    meal,
    position,
    quantity,
    foodId: null,
    name,
    brand: null,
    servingLabel: '1 serving',
    servingGrams: 100,
    nutrients,
    source: 'custom',
    createdAt: position,
    updatedAt: position,
  };
}

const entries = [
  entry('2026-11-10', 'dinner', 'Dal, tadka', { calories: 300, protein: 12, carbs: 40, fat: 9, fiber: 6 }),
  entry('2026-11-09', 'breakfast', 'Idli', { calories: 60, protein: 2, carbs: 12, fat: 0.4 }, 3),
  { ...entry('2026-11-10', 'breakfast', '=cmd', { calories: 100, protein: 1, carbs: 20, fat: 1 }), time: '08:30' },
];

describe('csv cells', () => {
  it('quotes commas, quotes and line breaks', () => {
    assert.equal(csvCell('Dal, tadka'), '"Dal, tadka"');
    assert.equal(csvCell('6" sub'), '"6"" sub"');
    assert.equal(csvCell('a\nb'), '"a\nb"');
  });

  it('defuses text a spreadsheet would run as a formula, and leaves numbers alone', () => {
    assert.equal(csvCell('=cmd'), "'=cmd");
    assert.equal(csvCell(-5), '-5');
    assert.equal(csvCell(null), '');
  });
});

describe('entries csv', () => {
  const csv = nutritionEntriesCsv(entries);
  const [header, ...rows] = csv.trim().split('\n');

  it('has the core four, then only the extra nutrients that appear', () => {
    assert.equal(header, 'date,time,meal,food,brand,quantity,serving,grams,calories_kcal,protein_g,carbs_g,fat_g,fiber_g,source');
  });

  it('sorts by date then meal, and writes the portion as eaten', () => {
    assert.equal(rows.length, 3);
    assert.ok(rows[0]!.startsWith('2026-11-09,,breakfast,Idli,,3,1 serving,300,180,6,36,1.2,,custom'));
    assert.ok(rows[1]!.startsWith("2026-11-10,08:30,breakfast,'=cmd"));
    assert.ok(rows[2]!.startsWith('2026-11-10,,dinner,"Dal, tadka"'));
  });
});

describe('daily csv', () => {
  it('totals each day and judges it against the goal', () => {
    const csv = nutritionDailyCsv(entries, 400).trim().split('\n');
    assert.equal(csv[0], 'date,calories_kcal,protein_g,carbs_g,fat_g,entries,goal_kcal,vs_goal');
    assert.equal(csv[1], '2026-11-09,180,6,36,1.2,1,400,under');
    assert.equal(csv[2], '2026-11-10,400,13,60,10,2,400,on target');
  });
});

describe('markdown report', () => {
  const stats = buildNutritionStats({
    from: '2026-11-09',
    to: '2026-11-10',
    today: '2026-11-10',
    entries,
    targets: { calories: 400, protein: 20 },
    loggedDates: [],
  });
  const md = buildNutritionExport('markdown', { from: '2026-11-09', to: '2026-11-10', entries, stats });

  it('titles the range and summarises it', () => {
    assert.ok(md.startsWith('# Food log: 9 Nov 2026 to 10 Nov 2026'));
    assert.match(md, /\| Calories \| 180 kcal \| 400 kcal \|/);
    assert.match(md, /Averages leave out today/);
  });

  it('lists every day with its foods, escaping pipes', () => {
    assert.match(md, /### Mon 9 Nov 2026/);
    assert.match(md, /### Tue 10 Nov 2026/);
    assert.match(md, /\| Dinner \|  \| Dal, tadka \| 1 × 1 serving \| 300 \| 12 \| 40 \| 9 \|/);
  });

  it('says so when nothing was logged', () => {
    const empty = buildNutritionExport('markdown', { from: '2026-11-10', to: '2026-11-10', entries: [], stats: null });
    assert.match(empty, /^# Food log: Tue 10 Nov 2026/);
    assert.match(empty, /Nothing was logged/);
  });
});

describe('json', () => {
  it('parses, and groups entries by day', () => {
    const parsed = JSON.parse(buildNutritionExport('json', { from: '2026-11-09', to: '2026-11-10', entries, stats: null }));
    assert.equal(parsed.days.length, 2);
    assert.equal(parsed.days[0].totals.calories, 180);
    assert.equal(parsed.days[1].entries[0].name, '=cmd');
  });
});

describe('file names and dates', () => {
  it('names a day and a range', () => {
    assert.equal(nutritionExportFileName('2026-11-10', '2026-11-10', 'markdown'), 'lift-food-2026-11-10.md');
    assert.equal(nutritionExportFileName('2026-11-01', '2026-11-10', 'csv-daily'), 'lift-food-2026-11-01-to-2026-11-10-daily.csv');
  });

  it('describes a date without a locale', () => {
    assert.equal(describeIsoDate('2026-11-10'), 'Tue 10 Nov 2026');
    assert.equal(describeIsoDate('2027-01-01', false), '1 Jan 2027');
  });
});

describe('patterns', () => {
  const day = (date: string, calories: number, inProgress = false) => ({
    date, calories, protein: 0, carbs: 0, fat: 0, entryCount: 1, verdict: null, inProgress,
  });

  it('averages calories by weekday, leaving today out', () => {
    // 2026-11-07 and 2026-11-14 are Saturdays.
    const out = weekdayAverages([day('2026-11-07', 3000), day('2026-11-14', 2000), day('2026-11-10', 1500, true)]);
    assert.equal(out[6]!.calories, 2500);
    assert.equal(out[6]!.days, 2);
    assert.equal(out[2]!.days, 0);
  });

  it('finds the highest and lowest complete day', () => {
    const out = dayExtremes([day('2026-11-08', 1800), day('2026-11-09', 2600), day('2026-11-10', 100, true)]);
    assert.equal(out?.highest.date, '2026-11-09');
    assert.equal(out?.lowest.date, '2026-11-08');
    assert.equal(dayExtremes([day('2026-11-08', 1800)]), null);
  });
});
