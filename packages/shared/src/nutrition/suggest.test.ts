import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchRecents, mealForTime, recentKey, usualAt } from './suggest.ts';
import type { RecentItem } from './types.ts';

function recent(name: string, meals: RecentItem['meals'], lastLoggedAt = 0, brand: string | null = null): RecentItem {
  const timesLogged = Object.values(meals ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);
  return {
    foodId: null,
    name,
    brand,
    servingLabel: '1 serving',
    servingGrams: null,
    nutrients: { calories: 100 },
    source: 'custom',
    quantity: 1,
    lastLoggedAt,
    timesLogged,
    meals,
  };
}

describe('usualAt', () => {
  const oats = recent('Oats', { breakfast: 12 }, 5);
  const eggs = recent('Eggs', { breakfast: 3, lunch: 1 }, 9);
  const curry = recent('Chicken curry', { dinner: 40, lunch: 1 }, 7);
  const sandwich = recent('Sandwich', { lunch: 1 }, 3);

  it('ranks by how often it was eaten at that meal', () => {
    assert.deepEqual(
      usualAt([eggs, oats, curry], 'breakfast').map((item) => item.name),
      ['Oats', 'Eggs'],
    );
  });

  it('skips a food only eaten there by exception', () => {
    assert.deepEqual(
      usualAt([curry, sandwich], 'lunch').map((item) => item.name),
      ['Sandwich'],
    );
  });

  it('leaves out what the meal already has', () => {
    const exclude = new Set([recentKey(oats)]);
    assert.deepEqual(
      usualAt([oats, eggs], 'breakfast', { exclude }).map((item) => item.name),
      ['Eggs'],
    );
  });

  it('suggests nothing when the server sent no meal counts', () => {
    assert.deepEqual(usualAt([recent('Old', undefined)], 'lunch'), []);
  });
});

describe('mealForTime', () => {
  const at = (hours: number, minutes = 0) => new Date(2026, 10, 10, hours, minutes);

  it('follows the day', () => {
    assert.equal(mealForTime(at(7, 30)), 'breakfast');
    assert.equal(mealForTime(at(13)), 'lunch');
    assert.equal(mealForTime(at(16)), 'snacks');
    assert.equal(mealForTime(at(20)), 'dinner');
    assert.equal(mealForTime(at(23, 30)), 'snacks');
  });
});

describe('matchRecents', () => {
  const items = [recent('Greek yogurt', {}, 1, 'Epigamia'), recent('Masala chai', {}, 2), recent('Yogurt bowl', {}, 3)];

  it('needs every word, in name or brand', () => {
    assert.deepEqual(
      matchRecents(items, 'yogurt epig').map((item) => item.name),
      ['Greek yogurt'],
    );
    assert.deepEqual(
      matchRecents(items, 'YOGURT').map((item) => item.name),
      ['Greek yogurt', 'Yogurt bowl'],
    );
  });

  it('matches nothing for a blank query', () => {
    assert.deepEqual(matchRecents(items, '  '), []);
  });
});
