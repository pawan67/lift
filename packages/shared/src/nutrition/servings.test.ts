import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseFoodEstimate } from './ai.ts';
import {
  convertQuantity,
  describeAmount,
  isGramServing,
  servingAt,
  servingOptions,
  splitServingLabel,
  withGrams,
} from './servings.ts';
import type { Serving } from './types.ts';

const egg: Serving = { id: 'egg', label: '1 large egg (50 g)', grams: 50, nutrients: { calories: 72, protein: 6.3 } };

describe('serving labels', () => {
  it('puts the weight in brackets, once', () => {
    assert.equal(withGrams('1 egg', 50), '1 egg (50 g)');
    assert.equal(withGrams('1 egg (50 g)', 60), '1 egg (60 g)');
    assert.equal(withGrams('100 g', 100), '100 g');
    assert.equal(withGrams('', 150), '150 g');
    assert.equal(withGrams('1 cup (240 ml)', 240), '1 cup (240 ml)');
    assert.equal(withGrams('1 serving', null), '1 serving');
  });

  it('splits a label back into name and weight', () => {
    assert.deepEqual(splitServingLabel('1 large egg (50 g)'), { name: '1 large egg', grams: 50 });
    assert.deepEqual(splitServingLabel('100 g'), { name: '', grams: 100 });
    assert.deepEqual(splitServingLabel('1 bowl'), { name: '1 bowl', grams: null });
  });
});

describe('servingOptions', () => {
  it('adds the extras and gram sizes, scaled by weight', () => {
    const options = servingOptions([egg], [{ label: '1 dozen (600 g)', grams: 600 }]);
    assert.deepEqual(
      options.map((o) => o.label),
      ['1 large egg (50 g)', '1 dozen (600 g)', '100 g', '1 g'],
    );
    assert.equal(options[1]!.nutrients.calories, 864);
    assert.equal(options[2]!.nutrients.calories, 144);
    assert.ok(isGramServing(options[3]!));
  });

  it('does not offer a size twice', () => {
    const hundred: Serving = { id: 'h', label: '100g', grams: 100, nutrients: { calories: 50 } };
    assert.deepEqual(
      servingOptions([hundred], [{ label: '100 G', grams: 100 }]).map((o) => o.label),
      ['100g', '1 g'],
    );
  });

  it('offers nothing extra when no weight is known', () => {
    const bowl: Serving = { id: 'b', label: '1 bowl', grams: null, nutrients: { calories: 200 } };
    assert.equal(servingOptions([bowl], [{ label: '1 plate (300 g)', grams: 300 }]).length, 1);
  });
});

describe('resizing', () => {
  it('scales figures by weight, and keeps them when a weight is new', () => {
    assert.ok(Math.abs(servingAt(egg, { label: '1 egg (60 g)', grams: 60 }).nutrients.calories! - 86.4) < 1e-9);
    const bowl: Serving = { id: 'b', label: '1 bowl', grams: null, nutrients: { calories: 200 } };
    assert.deepEqual(servingAt(bowl, { label: '1 bowl (250 g)', grams: 250 }).nutrients, { calories: 200 });
  });

  it('keeps the weight eaten when the size changes', () => {
    assert.equal(convertQuantity(2, egg, { grams: 1 }), 100);
    assert.equal(convertQuantity(2, egg, { grams: null }), 2);
  });

  it('says an amount the way a person would', () => {
    assert.equal(describeAmount({ quantity: 150, servingLabel: '1 g' }), '150 g');
    assert.equal(describeAmount({ quantity: 1.5, servingLabel: '100 g' }), '150 g');
    assert.equal(describeAmount({ quantity: 2, servingLabel: '1 large egg (50 g)' }), '2 × 1 large egg (50 g)');
    assert.equal(describeAmount({ quantity: 1, servingLabel: '1 bowl' }), '1 bowl');
  });
});

describe('AI serving sizes', () => {
  it('reads alternatives and adds the weight to the label', () => {
    const reply = JSON.stringify({
      items: [
        {
          name: 'Egg',
          servingLabel: '1 large egg',
          servingGrams: 50,
          quantity: 3,
          confidence: 0.9,
          nutrients: { calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8 },
          servings: [{ label: '1 dozen', grams: '600' }, { label: 'no weight' }, 'junk'],
        },
      ],
      note: null,
    });
    const [item] = parseFoodEstimate(reply, []).items;
    assert.equal(item!.servingLabel, '1 large egg (50 g)');
    assert.equal(item!.quantity, 3);
    assert.deepEqual(item!.servingOptions, [{ label: '1 dozen (600 g)', grams: 600 }]);
  });
});
