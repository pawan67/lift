import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeWeekStreak,
  detectPrs,
  effectiveWeightKg,
  estimateOneRepMax,
  repMaxTable,
  setVolumeKg,
  summarizeSets,
  type AnalyticsContext,
  type SetLike,
} from './calculations.ts';
import { EXERCISE_LIBRARY, findDuplicateExerciseIds, scoreExerciseMatch, slugify } from './exercises/index.ts';
import { isUuid, uuidv7, uuidv7Timestamp } from './ids.ts';
import * as barrel from './index.ts';
import { calculatePlates, DEFAULT_PLATES_KG, DEFAULT_PLATES_LB } from './plates.ts';
import { clampUpdatedAt, CLOCK_SKEW_TOLERANCE_MS, shouldOverwrite } from './sync.ts';
import { TRACKING_TYPES, USES_BODYWEIGHT } from './types.ts';
import {
  formatDuration,
  formatDurationDraft,
  formatWeight,
  fromDisplayWeight,
  kgToLb,
  lbToKg,
  parseDuration,
  trimZeros,
} from './units.ts';

// Convenience builder so tests only state the fields they care about.
function set(partial: Partial<SetLike>): SetLike {
  return {
    weightKg: null,
    reps: null,
    durationSeconds: null,
    distanceKm: null,
    setType: 'normal',
    isCompleted: true,
    ...partial,
  };
}

const weightReps: AnalyticsContext = { trackingType: 'weight_reps' };

describe('uuidv7', () => {
  it('produces a well-formed v7 uuid', () => {
    const id = uuidv7();
    assert.ok(isUuid(id));
    assert.equal(id[14], '7', 'version nibble should be 7');
    assert.ok(['8', '9', 'a', 'b'].includes(id[19]!), 'variant nibble should be 10xx');
  });

  it('sorts lexicographically in creation order', () => {
    const early = uuidv7(1_700_000_000_000);
    const late = uuidv7(1_700_000_001_000);
    assert.ok(early < late);
  });

  it('round-trips its embedded timestamp', () => {
    const now = 1_762_000_000_000;
    assert.equal(uuidv7Timestamp(uuidv7(now)), now);
  });

  it('does not collide across a tight loop', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => uuidv7()));
    assert.equal(ids.size, 5000);
  });
});

describe('units', () => {
  it('round-trips kg/lb without drift', () => {
    assert.ok(Math.abs(lbToKg(kgToLb(102.5)) - 102.5) < 1e-9);
  });

  it('trims trailing zeros when formatting', () => {
    assert.equal(formatWeight(100, 'kg'), '100 kg');
    assert.equal(formatWeight(102.5, 'kg'), '102.5 kg');
  });

  it('trims zeros only past the decimal point', () => {
    assert.equal(trimZeros('100.00'), '100');
    assert.equal(trimZeros('102.50'), '102.5');
    assert.equal(trimZeros('102.55'), '102.55');
    assert.equal(trimZeros('1000'), '1000');
  });

  it('survives the round trip as an editable field value', () => {
    // The set row puts this string straight into the weight TextInput, so any
    // float residue or trailing zero is a character the user has to delete.
    for (const [unit, increments] of [
      ['kg', [2.5, 20, 60, 102.5, 137.5, 225]],
      ['lb', [5, 45, 135, 137.5, 225, 315]],
    ] as const) {
      for (const entered of increments) {
        const stored = fromDisplayWeight(entered, unit);
        assert.equal(
          formatWeight(stored, unit, { withUnit: false }),
          String(entered),
          `${entered} ${unit} did not survive the round trip`,
        );
      }
    }
  });

  it('formats durations, adding hours only when needed', () => {
    assert.equal(formatDuration(45), '0:45');
    assert.equal(formatDuration(90), '1:30');
    assert.equal(formatDuration(3723), '1:02:03');
  });

  it('parses duration input in all accepted shapes', () => {
    assert.equal(parseDuration('90'), 90);
    assert.equal(parseDuration('1:30'), 90);
    assert.equal(parseDuration('1:02:03'), 3723);
    assert.equal(parseDuration('abc'), null);
    assert.equal(parseDuration(''), null);
  });

  it('spells typed digits as a clock while a duration is entered', () => {
    assert.equal(formatDurationDraft('1'), '1');
    assert.equal(formatDurationDraft('90'), '90');
    assert.equal(formatDurationDraft('130'), '1:30');
    assert.equal(formatDurationDraft('2500'), '25:00');
    assert.equal(formatDurationDraft('12345'), '1:23:45');
    // Idempotent over its own output, so appending a digit keeps working.
    assert.equal(formatDurationDraft('1:30'), '1:30');
    assert.equal(formatDurationDraft('1:300'), '13:00');
    // A seventh digit would build a fourth group, which parseDuration rejects.
    assert.equal(formatDurationDraft('1234567'), '12:34:56');
  });

  it('only ever spells a duration the parser can read back', () => {
    for (const digits of ['0', '5', '45', '130', '2500', '123456']) {
      assert.notEqual(parseDuration(formatDurationDraft(digits)), null);
    }
  });
});

describe('estimateOneRepMax', () => {
  it('returns the weight itself for a single rep', () => {
    assert.equal(estimateOneRepMax(100, 1, 'brzycki'), 100);
    assert.equal(estimateOneRepMax(100, 1, 'epley'), 100);
  });

  it('rejects nonsense input instead of returning NaN', () => {
    assert.equal(estimateOneRepMax(0, 5), 0);
    assert.equal(estimateOneRepMax(100, 0), 0);
    assert.equal(estimateOneRepMax(-100, 5), 0);
    assert.equal(estimateOneRepMax(Number.NaN, 5), 0);
  });

  it('stays finite and positive past Brzycki\'s asymptote', () => {
    // The raw formula divides by (37 - reps): zero at 37, negative beyond.
    for (const reps of [30, 37, 40, 100]) {
      const value = estimateOneRepMax(100, reps, 'brzycki');
      assert.ok(Number.isFinite(value), `reps=${reps} produced ${value}`);
      assert.ok(value > 0, `reps=${reps} produced ${value}`);
    }
  });

  it('increases monotonically with reps', () => {
    let previous = 0;
    for (let reps = 1; reps <= 20; reps++) {
      const value = estimateOneRepMax(100, reps, 'brzycki');
      assert.ok(value >= previous, `1RM dropped at ${reps} reps`);
      previous = value;
    }
  });
});

describe('effective weight', () => {
  it('adds bodyweight for weighted bodyweight movements', () => {
    const ctx: AnalyticsContext = { trackingType: 'weighted_bodyweight', bodyweightKg: 80 };
    assert.equal(effectiveWeightKg(set({ weightKg: 20, reps: 5 }), ctx), 100);
  });

  it('subtracts assistance, never going below zero', () => {
    const ctx: AnalyticsContext = { trackingType: 'assisted_bodyweight', bodyweightKg: 80 };
    assert.equal(effectiveWeightKg(set({ weightKg: 30, reps: 5 }), ctx), 50);
    assert.equal(effectiveWeightKg(set({ weightKg: 200, reps: 5 }), ctx), 0);
  });

  it('uses bodyweight alone for unloaded rep work', () => {
    const ctx: AnalyticsContext = { trackingType: 'bodyweight_reps', bodyweightKg: 75 };
    assert.equal(effectiveWeightKg(set({ reps: 10 }), ctx), 75);
  });
});

describe('USES_BODYWEIGHT', () => {
  it('lists exactly the tracking types whose load moves with bodyweight', () => {
    // Pinned to `effectiveWeightKg` rather than restated, so adding a tracking
    // type without deciding this question fails here instead of silently
    // logging zero volume for it.
    for (const trackingType of TRACKING_TYPES) {
      const sample = set({ weightKg: 30, reps: 5 });
      const unknown = effectiveWeightKg(sample, { trackingType, bodyweightKg: 0 });
      const known = effectiveWeightKg(sample, { trackingType, bodyweightKg: 80 });

      assert.equal(
        USES_BODYWEIGHT.has(trackingType),
        unknown !== known,
        `${trackingType} disagrees with effectiveWeightKg`,
      );
    }
  });
});

describe('volume', () => {
  it('excludes warm-up sets', () => {
    assert.equal(setVolumeKg(set({ weightKg: 60, reps: 10, setType: 'warmup' }), weightReps), 0);
  });

  it('excludes uncompleted sets', () => {
    assert.equal(setVolumeKg(set({ weightKg: 100, reps: 5, isCompleted: false }), weightReps), 0);
  });

  it('sums only working, completed sets', () => {
    const summary = summarizeSets(
      [
        set({ weightKg: 60, reps: 10, setType: 'warmup' }), // ignored
        set({ weightKg: 100, reps: 5 }), // 500
        set({ weightKg: 100, reps: 5, isCompleted: false }), // ignored
        set({ weightKg: 90, reps: 8 }), // 720
      ],
      weightReps,
    );

    assert.equal(summary.volumeKg, 1220);
    assert.equal(summary.workingSets, 2);
    assert.equal(summary.totalReps, 13);
    assert.equal(summary.heaviestKg, 100);
    assert.equal(summary.bestSetVolumeKg, 720);
  });
});

describe('repMaxTable', () => {
  it('carries a heavy set forward to lower rep counts', () => {
    // 100 kg × 8 also proves 100 kg for 1–7 reps.
    const table = repMaxTable([set({ weightKg: 100, reps: 8 })], weightReps);
    for (let reps = 1; reps <= 8; reps++) {
      assert.equal(table.get(reps), 100, `expected 100 at ${reps} reps`);
    }
    assert.equal(table.get(9), undefined);
  });

  it('keeps the heaviest load at each rep count', () => {
    const table = repMaxTable(
      [set({ weightKg: 100, reps: 5 }), set({ weightKg: 80, reps: 10 })],
      weightReps,
    );
    assert.equal(table.get(5), 100);
    assert.equal(table.get(10), 80);
  });
});

describe('detectPrs', () => {
  const sets = [set({ weightKg: 100, reps: 5 })];

  it('reports records when previous bests are beaten', () => {
    const prs = detectPrs(sets, weightReps, { heaviestKg: 95 });
    assert.ok(prs.some((pr) => pr.kind === 'heaviest_weight' && pr.value === 100));
  });

  it('does not report a PR for merely matching a previous best', () => {
    const prs = detectPrs(sets, weightReps, {
      heaviestKg: 100,
      bestOneRepMaxKg: 999,
      bestSetVolumeKg: 999,
      bestSessionVolumeKg: 999,
      mostReps: 999,
    });
    assert.equal(prs.length, 0);
  });

  it('returns nothing when there are no working sets', () => {
    const prs = detectPrs([set({ weightKg: 100, reps: 5, setType: 'warmup' })], weightReps, {});
    assert.equal(prs.length, 0);
  });

  it('points at the set that produced the record', () => {
    const prs = detectPrs(
      [set({ weightKg: 80, reps: 5 }), set({ weightKg: 120, reps: 3 })],
      weightReps,
      { heaviestKg: 100 },
    );
    const heaviest = prs.find((pr) => pr.kind === 'heaviest_weight');
    assert.equal(heaviest?.setIndex, 1);
  });
});

describe('computeWeekStreak', () => {
  const monday = (weeksAgo: number) => {
    const d = new Date(2026, 7, 12); // Wed 12 Aug 2026
    d.setDate(d.getDate() - weeksAgo * 7);
    return d;
  };

  it('counts consecutive training weeks', () => {
    const now = new Date(2026, 7, 12);
    assert.equal(computeWeekStreak([monday(0), monday(1), monday(2)], now), 3);
  });

  it('stops at a skipped week', () => {
    const now = new Date(2026, 7, 12);
    assert.equal(computeWeekStreak([monday(0), monday(1), monday(3)], now), 2);
  });

  it('keeps the streak alive when the current week is still empty', () => {
    // Trained last week, nothing yet this week. The week is not over, so the
    // streak should hold rather than reset to zero.
    const now = new Date(2026, 7, 12);
    assert.equal(computeWeekStreak([monday(1), monday(2)], now), 2);
  });

  it('returns zero with no history', () => {
    assert.equal(computeWeekStreak([]), 0);
  });
});

describe('calculatePlates', () => {
  it('loads a standard 100 kg exactly', () => {
    const result = calculatePlates(100, 20, DEFAULT_PLATES_KG);
    assert.ok(result.exact);
    assert.equal(result.achievedKg, 100);
    // 40 kg per side = 25 + 15
    assert.deepEqual(
      result.plates.map((p) => [p.weightKg, p.perSide]),
      [
        [25, 1],
        [15, 1],
      ],
    );
  });

  it('handles fractional targets with micro plates', () => {
    const result = calculatePlates(102.5, 20, DEFAULT_PLATES_KG);
    assert.ok(result.exact, `remainder was ${result.remainderKg}`);
    assert.equal(result.achievedKg, 102.5);
  });

  it('flags a target below the bar', () => {
    const result = calculatePlates(15, 20, DEFAULT_PLATES_KG);
    assert.ok(result.belowBar);
    assert.equal(result.plates.length, 0);
  });

  it('returns the bar alone for exactly bar weight', () => {
    const result = calculatePlates(20, 20, DEFAULT_PLATES_KG);
    assert.ok(result.exact);
    assert.equal(result.plates.length, 0);
  });

  it('respects a limited inventory and reports the shortfall', () => {
    // Only one pair of 20s available: 20 + 40 = 60, short of 100.
    const result = calculatePlates(100, 20, [{ weightKg: 20, count: 2 }]);
    assert.equal(result.achievedKg, 60);
    assert.equal(result.remainderKg, 40);
    assert.ok(!result.exact);
  });

  it('never suggests an unpairable odd plate', () => {
    const result = calculatePlates(45, 20, [{ weightKg: 25, count: 1 }]);
    assert.equal(result.plates.length, 0);
  });

  it('loads a weight it built itself, in pounds', () => {
    // A pound plate in kilograms is never round, so a remainder that is
    // exactly one plate lands a float's width under it. The solver used to
    // skip that plate and report its own answer as unloadable.
    const barKg = 20.4117;
    const target = 45.3591;
    const result = calculatePlates(target, barKg, DEFAULT_PLATES_LB);
    assert.ok(result.exact, `expected loadable, short by ${result.remainderKg}`);
    assert.ok(Math.abs(result.achievedKg - target) < 1e-6);
  });
});

describe('sync conflict resolution', () => {
  it('overwrites only on a strictly newer write', () => {
    assert.equal(shouldOverwrite(2000, 1000), true);
    assert.equal(shouldOverwrite(1000, 2000), false);
  });

  it('keeps the incumbent on a tie, making replays idempotent', () => {
    assert.equal(shouldOverwrite(1000, 1000), false);
  });
});

describe('clock skew clamping', () => {
  const now = 1_700_000_000_000;

  it('leaves an honest timestamp alone', () => {
    assert.equal(clampUpdatedAt(now - 5000, now), now - 5000);
  });

  it('tolerates a device a little fast, so it still wins the writes it should', () => {
    const slightlyAhead = now + 60_000;
    assert.equal(clampUpdatedAt(slightlyAhead, now), slightlyAhead);
  });

  it('caps a clock set into the future at the tolerance', () => {
    const nextYear = now + 365 * 24 * 60 * 60 * 1000;
    assert.equal(clampUpdatedAt(nextYear, now), now + CLOCK_SKEW_TOLERANCE_MS);
  });

  it('leaves a later honest edit able to win against a clamped one', () => {
    // The whole point: without the clamp the future-stamped row is unbeatable,
    // and every real edit after it is answered `stale` and then destroyed.
    const stored = clampUpdatedAt(now + 10 * 365 * 24 * 60 * 60 * 1000, now);
    const honestEditLater = now + CLOCK_SKEW_TOLERANCE_MS + 1;
    assert.equal(shouldOverwrite(clampUpdatedAt(honestEditLater, honestEditLater), stored), true);
  });
});

describe('exercise library', () => {
  it('has no colliding slugs', () => {
    assert.deepEqual(findDuplicateExerciseIds(), []);
  });

  it('slugifies names predictably', () => {
    assert.equal(slugify('Bench Press (Barbell)'), 'bench-press-barbell');
    assert.equal(slugify("Farmer's Walk"), 'farmer-s-walk');
  });

  it('ships a substantial library', () => {
    assert.ok(EXERCISE_LIBRARY.length >= 200, `only ${EXERCISE_LIBRARY.length} exercises`);
  });

  it('ranks exact above whole-word above mid-word above substring', () => {
    const exact = scoreExerciseMatch('Squat (Barbell)', 'squat (barbell)');
    const word = scoreExerciseMatch('Goblet Squat (Dumbbell)', 'squat');
    const midWord = scoreExerciseMatch('Squatting Reach', 'squat');
    const buried = scoreExerciseMatch('Antisquat Drill', 'squat');
    const none = scoreExerciseMatch('Bench Press (Barbell)', 'squat');

    assert.ok(exact > word);
    assert.ok(word > midWord);
    assert.ok(midWord > buried);
    assert.ok(buried > none);
    assert.equal(none, 0);
  });

  /*
   * The regression the whole-word tier exists for. Ranking "starts with the
   * query" above "contains the query as a word" answered "row" with Rowing,
   * Rowing Boat Yoga Pose and Rowing Straight Back before any actual row, and
   * "press" with Press Under before Bench Press.
   */
  it('puts a name containing the word above one merely starting with it', () => {
    assert.ok(scoreExerciseMatch('Barbell Row', 'row') > scoreExerciseMatch('Rowing', 'row'));
    assert.ok(
      scoreExerciseMatch('Bench Press', 'press') > scoreExerciseMatch('Pressure Hold', 'press'),
    );
  });

  it('does not drop a tier over a plural', () => {
    assert.equal(scoreExerciseMatch('Barbell Squats', 'squat'), scoreExerciseMatch('Barbell Squat', 'squat'));
    assert.equal(scoreExerciseMatch('Leg Presses', 'press'), scoreExerciseMatch('Leg Press', 'press'));
  });

  it('matches multi-token queries in any order', () => {
    assert.ok(scoreExerciseMatch('Bench Press (Barbell)', 'barbell bench') > 0);
  });

  it('stays out of the main barrel', () => {
    // ~6,800 generated rows. Re-exporting them from `index.ts` put the whole
    // catalog in the module graph of every screen that only wanted a unit
    // conversion; the seeder and the exercise repository import
    // `@lift/shared/exercises` directly instead.
    assert.ok(!('EXERCISE_LIBRARY' in barrel));
    assert.ok(!('createExerciseMatcher' in barrel));
  });
});
