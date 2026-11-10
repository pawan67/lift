import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  carriesCoachLog,
  COACH_TOOL_NAMES,
  COACH_TOOLS,
  coachChatBrief,
  coachTurnText,
  describeToolCall,
  isSmallTalk,
  lastChoices,
  parseCoachReply,
  parseRichText,
  withCoachLog,
} from './coach-chat.ts';

describe('parseCoachReply', () => {
  it('leaves a reply with no cards as one block of prose', () => {
    assert.deepEqual(parseCoachReply('Squat moved.\n\nBench did not.'), [
      { kind: 'text', text: 'Squat moved.\n\nBench did not.' },
    ]);
  });

  it('lifts a card out of the prose around it', () => {
    const reply = [
      'Bench has stalled.',
      '```lift',
      '{"card":"exercise","exercise":"Bench Press (Barbell)"}',
      '```',
      'Three sessions at the same load.',
    ].join('\n');

    assert.deepEqual(parseCoachReply(reply), [
      { kind: 'text', text: 'Bench has stalled.' },
      { kind: 'card', card: { card: 'exercise', exercise: 'Bench Press (Barbell)' } },
      { kind: 'text', text: 'Three sessions at the same load.' },
    ]);
  });

  it('holds the place of a card that is still streaming instead of printing half its JSON', () => {
    const reply = 'Here is the plan.\n```lift\n{"card":"plan","exer';
    assert.deepEqual(parseCoachReply(reply), [
      { kind: 'text', text: 'Here is the plan.' },
      { kind: 'pending' },
    ]);
  });

  it('accepts a card in a json fence, which is where a model drifts to', () => {
    const reply = '```json\n{"card":"muscles"}\n```';
    assert.deepEqual(parseCoachReply(reply), [{ kind: 'card', card: { card: 'muscles' } }]);
  });

  it('keeps json that is not a card as the text it is', () => {
    const reply = '```json\n{"sets":3}\n```';
    assert.deepEqual(parseCoachReply(reply), [{ kind: 'text', text: reply }]);
  });

  it('drops a lift block that is broken rather than showing raw JSON', () => {
    const reply = 'Before.\n```lift\n{"card":"exercise",}\n```\nAfter.';
    assert.deepEqual(parseCoachReply(reply), [
      { kind: 'text', text: 'Before.' },
      { kind: 'text', text: 'After.' },
    ]);
  });

  it('keeps other code blocks verbatim', () => {
    const reply = 'Like this:\n```\n3 x 8\n```';
    assert.deepEqual(parseCoachReply(reply), [{ kind: 'text', text: reply }]);
  });

  it('reads choices, capped at four, with an optional question', () => {
    const reply =
      '```lift\n{"card":"choices","question":"How is recovery?","options":["Fresh","Tired","Sore","Hurt","Other"]}\n```';
    assert.deepEqual(parseCoachReply(reply), [
      {
        kind: 'card',
        card: { card: 'choices', question: 'How is recovery?', options: ['Fresh', 'Tired', 'Sore', 'Hurt'] },
      },
    ]);
  });

  it('drops choices with nothing to choose', () => {
    assert.deepEqual(parseCoachReply('```lift\n{"card":"choices","options":[]}\n```'), []);
  });

  it('reads a plan, normalising what a model writes loosely', () => {
    const reply = [
      '```lift',
      JSON.stringify({
        card: 'plan',
        title: 'Push A',
        routine: 'Push A',
        exercises: [
          { exercise: 'Bench Press (Barbell)', sets: 4, reps: '6–8', weight: '80', rpe: 8, rest: 180 },
          { name: 'Lateral Raise (Dumbbell)', sets: '3', reps: 15 },
          { exercise: 'Plank', reps: 'AMRAP' },
          { sets: 3 },
        ],
      }),
      '```',
    ].join('\n');

    const [segment] = parseCoachReply(reply);
    assert.equal(segment?.kind, 'card');
    if (segment?.kind !== 'card' || segment.card.card !== 'plan') return;

    const { plan } = segment.card;
    assert.equal(plan.routine, 'Push A');
    assert.equal(plan.notes, null);
    assert.deepEqual(plan.exercises, [
      {
        exercise: 'Bench Press (Barbell)',
        sets: 4,
        repsLow: 6,
        repsHigh: 8,
        weight: 80,
        rpe: 8,
        restSeconds: 180,
        note: null,
      },
      {
        exercise: 'Lateral Raise (Dumbbell)',
        sets: 3,
        repsLow: 15,
        repsHigh: 15,
        weight: null,
        rpe: null,
        restSeconds: null,
        note: null,
      },
      {
        exercise: 'Plank',
        sets: 1,
        repsLow: null,
        repsHigh: null,
        weight: null,
        rpe: null,
        restSeconds: null,
        note: null,
      },
    ]);
  });

  it('drops a plan with no usable exercises', () => {
    assert.deepEqual(parseCoachReply('```lift\n{"card":"plan","exercises":[{"sets":3}]}\n```'), []);
  });
});

describe('lastChoices', () => {
  it('finds the choices that close a reply', () => {
    const segments = parseCoachReply(
      'Text.\n```lift\n{"card":"muscles"}\n```\n```lift\n{"card":"choices","options":["Yes","No"]}\n```',
    );
    assert.deepEqual(lastChoices(segments), { card: 'choices', question: null, options: ['Yes', 'No'] });
  });

  it('is null when the model forgot them', () => {
    assert.equal(lastChoices(parseCoachReply('Just text.')), null);
  });
});

describe('parseRichText', () => {
  it('joins wrapped lines into one paragraph and splits on blank lines', () => {
    assert.deepEqual(parseRichText('One\ntwo\n\nThree'), [
      { kind: 'paragraph', spans: [{ text: 'One two', bold: false }] },
      { kind: 'paragraph', spans: [{ text: 'Three', bold: false }] },
    ]);
  });

  it('reads bullets, numbered items and headings', () => {
    assert.deepEqual(
      parseRichText('# Plan\n- Squat\n2. Bench').map((block) => [block.kind, 'marker' in block ? block.marker : null]),
      [
        ['heading', null],
        ['bullet', '•'],
        ['bullet', '2.'],
      ],
    );
  });

  it('marks bold and leaves an unmatched marker alone', () => {
    assert.deepEqual(parseRichText('**Squat** is up, 5** reps'), [
      {
        kind: 'paragraph',
        spans: [
          { text: 'Squat', bold: true },
          { text: ' is up, 5** reps', bold: false },
        ],
      },
    ]);
  });
});

describe('the brief and the tools', () => {
  it('names the weight unit plans are written in', () => {
    assert.match(coachChatBrief('lb'), /"weight" is in lb/);
    assert.match(coachChatBrief('kg'), /"weight" is in kg/);
  });

  it('defines exactly the tools the app answers', () => {
    assert.deepEqual(
      COACH_TOOLS.map((tool) => tool.name),
      [...COACH_TOOL_NAMES],
    );
  });

  it('describes a lookup in words a user follows', () => {
    assert.equal(
      describeToolCall({ id: '1', name: 'exercise_history', input: { exercise: 'Squat' } }),
      'Read your Squat history',
    );
    assert.equal(describeToolCall({ id: '2', name: 'nonsense', input: {} }), 'Looked something up');
  });
});

describe('isSmallTalk', () => {
  it('lets greetings and thanks go without the log', () => {
    for (const text of ['hi', 'Hey coach!', 'good morning', "what's up", 'thanks a lot', 'ok cool', '👋', 'how are you doing?']) {
      assert.equal(isSmallTalk(text), true, text);
    }
  });

  it('sends the log with anything about training', () => {
    for (const text of ['PRs?', 'hi, how is my bench going', 'check in', 'thanks, now plan my week', 'how much should I squat', '', '100']) {
      assert.equal(isSmallTalk(text), false, text);
    }
  });
});

describe('the log in a turn', () => {
  it('round-trips the question out of a tagged turn', () => {
    const turn = withCoachLog('## About me\n\n- Weights are in kg.', 'How is my squat?');
    assert.equal(carriesCoachLog(turn), true);
    assert.equal(coachTurnText(turn), 'How is my squat?');
  });

  it('still reads the question out of a thread from before the tags', () => {
    const turn = '## About me\n\n- Weights are in kg.\n\nHow is my squat?';
    assert.equal(carriesCoachLog(turn), true);
    assert.equal(coachTurnText(turn), 'How is my squat?');
  });

  it('leaves an ordinary turn alone', () => {
    assert.equal(carriesCoachLog('hi'), false);
    assert.equal(coachTurnText('hi'), 'hi');
  });

  it('tells the model which way the log is coming', () => {
    assert.match(coachChatBrief('kg'), /training_log/);
    assert.match(coachChatBrief('kg', { withLog: false }), /has not been attached/);
  });
});

describe('food in the coach', () => {
  const card = (json: string) => parseCoachReply(['```lift', json, '```'].join('\n'))[0];

  it('reads the nutrition card, clamping its window', () => {
    assert.deepEqual(card('{"card":"nutrition","days":14}'), { kind: 'card', card: { card: 'nutrition', days: 14 } });
    assert.deepEqual(card('{"card":"nutrition","days":400}'), { kind: 'card', card: { card: 'nutrition', days: 90 } });
    assert.deepEqual(card('{"card":"nutrition"}'), { kind: 'card', card: { card: 'nutrition', days: 7 } });
  });

  it('reads the food day card, dropping a date it cannot use', () => {
    assert.deepEqual(card('{"card":"food_day","date":"2026-11-10"}'), {
      kind: 'card',
      card: { card: 'food_day', date: '2026-11-10' },
    });
    assert.deepEqual(card('{"card":"food_day","date":"yesterday"}'), { kind: 'card', card: { card: 'food_day', date: null } });
  });

  it('tells the model the date and that the food diary exists', () => {
    const brief = coachChatBrief('kg', { today: '2026-11-10' });
    assert.match(brief, /Today is 2026-11-10/);
    assert.match(brief, /food_summary/);
    assert.doesNotMatch(coachChatBrief('kg'), /Today is/);
  });

  it('describes the food lookups', () => {
    assert.equal(describeToolCall({ id: '1', name: 'food_summary', input: { days: 30 } }), 'Read your food diary for 30 days');
    assert.equal(describeToolCall({ id: '2', name: 'food_day', input: {} }), "Opened today's food diary");
  });
});
