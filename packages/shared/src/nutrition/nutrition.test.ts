import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRequest } from '../ai/providers.ts';

import { buildFoodEstimateRequest, estimateProgress, parseFoodEstimate } from './ai.ts';
import { groupByMeal, macroEnergySplit, macroGramsFromPercent, sumNutrients, totalsOf } from './math.ts';
import { copyEntriesSchema, createEntriesSchema, type FoodEntry } from './types.ts';

const custom = [{ id: '0190-caffeine', name: 'Caffeine', unit: 'mg', createdAt: 0 }];

describe('diary arithmetic', () => {
  it('keeps keys only one item knows about', () => {
    assert.deepEqual(sumNutrients([{ calories: 100, sugar: 5 }, { calories: 50 }]), { calories: 150, sugar: 5 });
  });

  it('multiplies by quantity before summing', () => {
    const totals = totalsOf([
      { nutrients: { calories: 120, protein: 3 }, quantity: 2 },
      { nutrients: { calories: 50, protein: 1 }, quantity: 0.5 },
    ]);
    assert.deepEqual(totals, { calories: 265, protein: 6.5 });
  });

  it('splits energy by macro from grams', () => {
    const split = macroEnergySplit({ protein: 25, carbs: 25, fat: 0 });
    assert.deepEqual(split, { protein: 0.5, carbs: 0.5, fat: 0 });
    assert.equal(macroEnergySplit({ calories: 10 }), null);
  });

  it('turns a percentage split into grams', () => {
    assert.deepEqual(macroGramsFromPercent(2000, { protein: 30, carbs: 40, fat: 30 }), {
      protein: 150,
      carbs: 200,
      fat: 67,
    });
  });

  it('groups entries by meal in position order', () => {
    const entry = (id: string, meal: FoodEntry['meal'], position: number) =>
      ({ id, meal, position, createdAt: 0 }) as FoodEntry;
    const grouped = groupByMeal([entry('b', 'lunch', 2), entry('a', 'lunch', 1), entry('c', 'snacks', 0)]);
    assert.deepEqual(
      grouped.lunch.map((e) => e.id),
      ['a', 'b'],
    );
    assert.equal(grouped.breakfast.length, 0);
  });
});

describe('request schemas', () => {
  it('refuses a copy that names both ids and a day', () => {
    const result = copyEntriesSchema.safeParse({ ids: ['x'], from: { date: '2026-11-09' }, to: { date: '2026-11-10' } });
    assert.equal(result.success, false);
  });

  it('accepts copy-yesterday', () => {
    assert.ok(copyEntriesSchema.safeParse({ from: { date: '2026-11-09' }, to: { date: '2026-11-10' } }).success);
  });

  it('refuses negative nutrients', () => {
    const result = createEntriesSchema.safeParse({
      date: '2026-11-10',
      meal: 'lunch',
      items: [
        {
          foodId: null,
          name: 'X',
          brand: null,
          servingLabel: '1',
          servingGrams: null,
          nutrients: { calories: -1 },
          source: 'custom',
          quantity: 1,
        },
      ],
    });
    assert.equal(result.success, false);
  });
});

describe('AI estimate', () => {
  it('asks for custom nutrients by id', () => {
    const request = buildFoodEstimateRequest({ description: '2 rotis', customNutrients: custom });
    assert.match(request.system, /"0190-caffeine": Caffeine \(mg\)/);
  });

  it('sends a photo as an image block on both wire formats', () => {
    const request = buildFoodEstimateRequest({
      description: '',
      image: { mediaType: 'image/jpeg', data: 'AAAA' },
      customNutrients: [],
    });
    const anthropic = JSON.parse(
      buildRequest({ provider: 'anthropic', model: 'm', apiKey: 'k' }, request).body,
    );
    assert.equal(anthropic.messages[0].content[0].type, 'image');
    assert.equal(anthropic.messages[0].content[0].source.data, 'AAAA');

    const openai = JSON.parse(
      buildRequest({ provider: 'openai-compatible', model: 'm', apiKey: 'k' }, request).body,
    );
    const parts = openai.messages[1].content;
    assert.equal(parts[1].image_url.url, 'data:image/jpeg;base64,AAAA');
  });

  it('reads a fenced reply, coerces strings and drops unknown keys', () => {
    const reply = `Here you go:
\`\`\`json
{"items":[{"name":"Chapati","servingLabel":"1 medium","servingGrams":"40","quantity":2,"confidence":0.8,
"nutrients":{"calories":"120","protein":3.1,"carbs":18,"fat":3.7,"madeUp":9,"0190-caffeine":0}}],"note":"Assumed ghee."}
\`\`\``;
    const estimate = parseFoodEstimate(reply, custom);
    assert.equal(estimate.items.length, 1);
    assert.deepEqual(estimate.items[0]!.nutrients, {
      calories: 120,
      protein: 3.1,
      carbs: 18,
      fat: 3.7,
      '0190-caffeine': 0,
    });
    assert.equal(estimate.items[0]!.servingGrams, 40);
    assert.equal(estimate.note, 'Assumed ghee.');
  });

  it('drops an item without the core four, and throws when none remain', () => {
    assert.throws(() =>
      parseFoodEstimate('{"items":[{"name":"Tea","nutrients":{"calories":30}}]}', []),
    );
  });

  it('keeps the finished foods from a reply cut off by the output limit', () => {
    const food = (name: string) =>
      `{"name":"${name}","servingLabel":"1 bowl {big}","quantity":1,"confidence":0.7,"nutrients":{"calories":200,"protein":5,"carbs":30,"fat":6}}`;
    const reply = `{"items":[${food('Dal')},${food('Rice \\"jeera\\"')},{"name":"Raita","servingLabel":"1 bo`;
    const estimate = parseFoodEstimate(reply, []);
    assert.deepEqual(
      estimate.items.map((item) => item.name),
      ['Dal', 'Rice "jeera"'],
    );
    assert.match(estimate.note ?? '', /cut short/);
  });

  it('says so when a cut-off reply finished no food at all', () => {
    assert.throws(() => parseFoodEstimate('{"items":[{"name":"Dal","nutri', []), /cut off/);
    assert.throws(() => parseFoodEstimate('Sorry, I cannot help with that.', []), /did not reply/);
  });

  it('counts the foods a streaming reply has started', () => {
    assert.equal(estimateProgress(''), 0);
    assert.equal(estimateProgress('{"items":[{"name":"Dal","nutrients":{}},{"name" : "Ri'), 2);
  });

  it('leaves room for a long list', () => {
    const request = buildFoodEstimateRequest({ description: 'a lot', customNutrients: [] });
    assert.ok(request.maxOutputTokens >= 8000);
  });
});
