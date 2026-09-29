import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  autoregulateRemaining,
  loadAtEffort,
  loadPercent,
  oneRepMaxAtEffort,
  type AutoregulationConfig,
} from './autoregulate.ts';
import type { PerformedSet } from './progression.ts';

/** A completed working set, rated. The shape most of these tests need. */
function done(
  weightKg: number | null,
  reps: number,
  rpe?: number,
  over: Partial<PerformedSet> = {},
): PerformedSet {
  return { weightKg, reps, setType: 'normal', isCompleted: true, rpe, ...over };
}

/** A working set nobody has checked off yet: the rows this engine talks about. */
function open(
  weightKg: number | null,
  reps: number | null,
  over: Partial<PerformedSet> = {},
): PerformedSet {
  return { weightKg, reps, setType: 'normal', isCompleted: false, ...over };
}

const BARBELL: AutoregulationConfig = {
  trackingType: 'weight_reps',
  incrementKg: 2.5,
  targetRpe: 8,
  minReps: 5,
  maxReps: 12,
};

/** Every suggested load, in order, for the assertions that only care about those. */
function weights(sets: readonly { weightKg: number | null }[]): (number | null)[] {
  return sets.map((set) => set.weightKg);
}

// ---------------------------------------------------------------------------

describe('loadPercent', () => {
  it('reproduces the published chart at RPE 10, where reps are reps to failure', () => {
    assert.equal(loadPercent(1, 10), 1);
    assert.equal(loadPercent(5, 10), 0.863);
    assert.equal(loadPercent(10, 10), 0.739);
    assert.equal(loadPercent(12, 10), 0.68);
  });

  it('reads a submaximal set off the row for reps plus reps in reserve', () => {
    // The whole premise of storing one row instead of the grid: 8 @ RPE 8 is
    // two in reserve, so it is loaded like a set of 10 taken to failure.
    assert.equal(loadPercent(8, 8), loadPercent(10, 10));
    assert.equal(loadPercent(5, 7), loadPercent(8, 10));
    assert.equal(loadPercent(3, 6), loadPercent(7, 10));
  });

  it('reproduces every cell of the published grid, including the half rows', () => {
    /*
     * The chart as it is actually printed: RPE down, reps 1 to 12 across, in
     * percent. This is the fixture the single stored row has to be checked
     * against, because the row is a claim *about* this grid: that every cell in
     * it is the same curve read at reps plus reps in reserve.
     *
     * Agreement to within half of the last printed digit, which is all a source
     * rounded to one decimal place can be held to: 8 @ RPE 8.5 is 9.5 reps to
     * failure, the midpoint of 76.2 and 73.9 is 75.05, and the cell says 75.1.
     */
    const GRID: Record<string, number[]> = {
      '10': [100.0, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0],
      '9.5': [97.8, 93.9, 90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7],
      '9': [95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3],
      '8.5': [93.9, 90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7, 64.0],
      '8': [92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.6],
      '7.5': [90.7, 87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7, 64.0, 61.3],
      '7': [89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.6, 59.9],
      '6.5': [87.8, 85.0, 82.4, 79.9, 77.4, 75.1, 72.3, 69.4, 66.7, 64.0, 61.3, 58.6],
      '6': [86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.6, 59.9, 57.2],
    };

    for (const [column, cells] of Object.entries(GRID)) {
      const rpe = Number(column);
      cells.forEach((cell, index) => {
        const reps = index + 1;
        const percent = loadPercent(reps, rpe);
        assert.ok(percent !== null, `${reps} @ RPE ${rpe} should be in the table`);
        assert.ok(
          Math.abs(percent * 100 - cell) <= 0.05 + 1e-9,
          `${reps} @ RPE ${rpe} gave ${(percent * 100).toFixed(2)}, chart says ${cell}`,
        );
      });
    }
  });

  it('is a flat 2.7 points per rep from 11 on, which is what pins 13 to 16', () => {
    // 12 @ RPE 6 is 16 reps to failure, so the corner of the printed grid fixes
    // this row four entries past its own last column. The tail being arithmetic
    // is what makes those four agree, and it is the only basis 17 to 20 have.
    for (let toFailure = 12; toFailure <= 20; toFailure += 1) {
      const step = loadPercent(toFailure - 1, 10)! - loadPercent(toFailure, 10)!;
      assert.ok(Math.abs(step - 0.027) < 1e-9, `step into ${toFailure} was ${step}`);
    }
  });

  it('gets heavier as the reps fall and as the effort rises', () => {
    for (let reps = 2; reps <= 12; reps += 1) {
      const fewer = loadPercent(reps - 1, 8)!;
      const more = loadPercent(reps, 8)!;
      assert.ok(fewer > more, `${reps - 1} reps should outweigh ${reps}`);
    }

    for (let rpe = 6; rpe < 10; rpe += 0.5) {
      const easier = loadPercent(8, rpe)!;
      const harder = loadPercent(8, rpe + 0.5)!;
      assert.ok(harder > easier, `RPE ${rpe + 0.5} should outweigh RPE ${rpe}`);
    }
  });

  it('declines past the end of the table rather than extrapolating', () => {
    // 18 reps with 5 left is 23 to failure: a set nobody counts accurately and
    // a percentage flat enough that dividing by it invents a one-rep max.
    assert.equal(loadPercent(18, 5), null);
    assert.equal(loadPercent(21, 10), null);
    assert.equal(loadPercent(0, 10), null);
  });

  it('refuses efforts off the stored scale, matching the importer', () => {
    assert.equal(loadPercent(8, 0), null);
    assert.equal(loadPercent(8, 11), null);
    assert.equal(loadPercent(8, Number.NaN), null);
  });
});

describe('oneRepMaxAtEffort', () => {
  it('tells apart two identical sets rated differently', () => {
    const easy = oneRepMaxAtEffort(80, 8, 6)!;
    const hard = oneRepMaxAtEffort(80, 8, 10)!;
    assert.ok(easy > hard, 'the easier 8 implies the stronger lifter');
  });

  it('round-trips through loadAtEffort', () => {
    const oneRepMax = oneRepMaxAtEffort(100, 5, 8)!;
    const back = loadAtEffort(oneRepMax, 5, 8)!;
    assert.ok(Math.abs(back - 100) < 1e-9);
  });

  it('refuses a set it cannot read', () => {
    assert.equal(oneRepMaxAtEffort(0, 8, 8), null);
    assert.equal(oneRepMaxAtEffort(80, 25, 10), null);
  });
});

// ---------------------------------------------------------------------------

describe('autoregulateRemaining', () => {
  it('raises the sets still open when the one just logged was easy', () => {
    const result = autoregulateRemaining(
      [done(80, 8, 5), open(80, 8), open(80, 8)],
      BARBELL,
    );

    assert.ok(result);
    assert.equal(result.kind, 'autoregulate');
    // 8 @ RPE 5 is 13 reps to failure (65.5%), so a 122 kg one-rep max, and 8 @
    // RPE 8 of that is 90 kg. The 10% cap brings it back to 88, which rounds to
    // the nearest thing a barbell can make.
    assert.deepEqual(weights(result.sets), [87.5, 87.5]);
    assert.deepEqual(result.sets.map((set) => set.reps), [8, 8]);
  });

  it('lowers them when it was harder than the target', () => {
    const result = autoregulateRemaining(
      [done(80, 8, 10), open(80, 8), open(80, 8)],
      BARBELL,
    );

    assert.ok(result);
    assert.deepEqual(weights(result.sets), [75, 75]);
  });

  it('only ever speaks about the sets that are still open', () => {
    const result = autoregulateRemaining(
      [done(80, 8, 5), done(80, 8, 6), open(80, 8), open(80, 8)],
      BARBELL,
    );

    assert.ok(result);
    assert.equal(result.sets.length, 2);
    // The ordinals are the ones the logging screen prints, so the patch lands
    // on rows three and four rather than on the two already logged.
    assert.deepEqual(result.sets.map((set) => set.workingIndex), [3, 4]);
  });

  it('re-anchors on the newest rating, which is how it needs no fatigue model', () => {
    // Set one said "easy". Set two, at the weight that answer produced, said
    // "that was plenty". Set three has to be planned from set two.
    const result = autoregulateRemaining(
      [done(80, 8, 5), done(87.5, 8, 9.5), open(87.5, 8)],
      BARBELL,
    );

    assert.ok(result);
    const [only] = result.sets;
    assert.ok(only);
    assert.ok(
      only.weightKg !== null && only.weightKg < 87.5,
      `expected a back-off from 87.5, got ${only.weightKg}`,
    );
    assert.match(result.reason, /^Set 2 /);
  });

  it('skips over a set left unrated rather than reading it as easy', () => {
    const result = autoregulateRemaining(
      [done(80, 8, 5), done(80, 8), open(80, 8)],
      BARBELL,
    );

    assert.ok(result);
    assert.match(result.reason, /^Set 1 /);
  });

  it('says nothing until a set has been rated', () => {
    assert.equal(
      autoregulateRemaining([done(80, 8), open(80, 8), open(80, 8)], BARBELL),
      null,
    );
    assert.equal(autoregulateRemaining([open(80, 8), open(80, 8)], BARBELL), null);
    assert.equal(autoregulateRemaining([], BARBELL), null);
  });

  it('says nothing when the rating is what the target asked for', () => {
    assert.equal(autoregulateRemaining([done(80, 8, 8), open(80, 8)], BARBELL), null);
    // Inside the half point the effort dialog steps in, so inside the noise.
    assert.equal(autoregulateRemaining([done(80, 8, 8.25), open(80, 8)], BARBELL), null);
  });

  it('says nothing when there is no set left to adjust', () => {
    assert.equal(
      autoregulateRemaining([done(80, 8, 5), done(80, 8, 5)], BARBELL),
      null,
    );
  });

  it('says nothing when the rounding lands back on the weight already there', () => {
    // A point of RPE on a light dumbbell is worth less than the rack steps in,
    // so the honest answer is the weight the user already has in the row.
    const result = autoregulateRemaining([done(10, 10, 8.5), open(10, 10)], {
      ...BARBELL,
      trackingType: 'weight_reps',
      incrementKg: 2,
    });

    assert.equal(result, null);
  });

  it('honours the reps each open row already asks for', () => {
    // A routine prescribing 5s put 5 in the open rows. The suggestion is a
    // heavier five, not a rewrite of the prescription.
    const result = autoregulateRemaining(
      [done(100, 5, 6), open(100, 5), open(100, 5)],
      { ...BARBELL, minReps: 5, maxReps: 5 },
    );

    assert.ok(result);
    assert.deepEqual(result.sets.map((set) => set.reps), [5, 5]);
    assert.ok(result.sets.every((set) => set.weightKg !== null && set.weightKg > 100));
  });

  it('gives an unplanned row the reps of the set that was rated', () => {
    const result = autoregulateRemaining([done(80, 8, 5), open(null, null)], BARBELL);

    assert.ok(result);
    assert.equal(result.sets[0]?.reps, 8);
  });

  it('never moves a load by more than the cap, however wrong the rating', () => {
    // RPE 1 on a working set is somebody who has misread the scale. It costs
    // one cap's worth of weight and no more.
    const result = autoregulateRemaining([done(100, 8, 1), open(100, 8)], BARBELL);

    assert.ok(result);
    assert.equal(result.sets[0]?.weightKg, 110);
  });

  it('moves the reps when the load it would divide by is zero', () => {
    // An empty-bar movement logged at 0. There is no percentage of nothing, so
    // the answer is the reps, not silence.
    const result = autoregulateRemaining([done(0, 10, 5), open(0, 10)], BARBELL);

    assert.ok(result);
    assert.equal(result.sets[0]?.weightKg, 0);
    assert.equal(result.sets[0]?.reps, 12);
  });

  it('declines a rep count the chart cannot speak to', () => {
    assert.equal(autoregulateRemaining([done(80, 25, 10), open(80, 25)], BARBELL), null);
  });

  it('leaves warm-ups out of the numbering and out of the adjustment', () => {
    const result = autoregulateRemaining(
      [
        open(40, 10, { setType: 'warmup' }),
        done(80, 8, 5),
        open(80, 8),
      ],
      BARBELL,
    );

    assert.ok(result);
    assert.equal(result.sets.length, 1);
    assert.equal(result.sets[0]?.workingIndex, 2);
    assert.match(result.reason, /^Set 1 /);
  });

  it('has no opinion about a run', () => {
    for (const trackingType of ['duration', 'distance_duration', 'weight_distance'] as const) {
      assert.equal(
        autoregulateRemaining([done(80, 8, 5), open(80, 8)], { ...BARBELL, trackingType }),
        null,
        trackingType,
      );
    }
  });
});

describe('autoregulateRemaining, with no load to step', () => {
  const PUSHUPS: AutoregulationConfig = {
    trackingType: 'bodyweight_reps',
    incrementKg: 0,
    targetRpe: 8,
    minReps: 5,
    maxReps: 20,
  };

  it('moves the reps instead', () => {
    // 10 with 5 left is 15 reps of capacity. Asked for 2 in reserve, that is 13.
    const result = autoregulateRemaining(
      [done(null, 10, 5), open(null, 10), open(null, 10)],
      PUSHUPS,
    );

    assert.ok(result);
    assert.deepEqual(result.sets.map((set) => set.reps), [13, 13]);
  });

  it('takes reps away after a set with nothing left', () => {
    const result = autoregulateRemaining([done(null, 10, 10), open(null, 10)], PUSHUPS);

    assert.ok(result);
    assert.equal(result.sets[0]?.reps, 8);
  });

  it('stays inside the band, which is the only brake bodyweight work has', () => {
    const result = autoregulateRemaining([done(null, 18, 4), open(null, 18)], PUSHUPS);

    assert.ok(result);
    assert.equal(result.sets[0]?.reps, 20);
  });

  it('says nothing when the rep count would not change', () => {
    assert.equal(
      autoregulateRemaining([done(null, 20, 4), open(null, 20)], PUSHUPS),
      null,
    );
  });

  it('answers for reps_only too', () => {
    const result = autoregulateRemaining([done(null, 10, 5), open(null, 10)], {
      ...PUSHUPS,
      trackingType: 'reps_only',
    });

    assert.ok(result);
    assert.equal(result.sets[0]?.reps, 13);
  });
});

describe('autoregulateRemaining, on the bodyweight variants', () => {
  const WEIGHTED: AutoregulationConfig = {
    trackingType: 'weighted_bodyweight',
    incrementKg: 2.5,
    targetRpe: 8,
    minReps: 5,
    maxReps: 12,
    bodyweightKg: 80,
  };

  const ASSISTED: AutoregulationConfig = {
    ...WEIGHTED,
    trackingType: 'assisted_bodyweight',
  };

  it('reads a weighted pull-up as bodyweight plus the belt', () => {
    const result = autoregulateRemaining([done(10, 8, 5), open(10, 8)], WEIGHTED);

    assert.ok(result);
    // The set moved 90 kg, 80 of it the lifter, so the cap allows 99 and what is
    // left over bodyweight is the 19 that goes on the belt, rounded to 20.
    // Running the chart on the entered 10 alone reads this as a 15 kg exercise
    // and, once rounded, finds nothing to say at all.
    assert.equal(result.sets[0]?.weightKg, 20);
  });

  it('takes assistance away when the set was easy', () => {
    // The one direction that is easy to get backwards: a lower number in this
    // field is the harder set.
    const result = autoregulateRemaining([done(40, 8, 5), open(40, 8)], ASSISTED);

    assert.ok(result);
    const [only] = result.sets;
    assert.ok(only?.weightKg !== null && only!.weightKg! < 40, `got ${only?.weightKg}`);
  });

  it('gives assistance back when the set had nothing left', () => {
    const result = autoregulateRemaining([done(40, 8, 10), open(40, 8)], ASSISTED);

    assert.ok(result);
    const [only] = result.sets;
    assert.ok(only?.weightKg !== null && only!.weightKg! > 40, `got ${only?.weightKg}`);
  });

  it('never asks for negative assistance', () => {
    // Bodyweight 80, assisted by 5, and a rating that wants the set much
    // harder. There is no such thing as minus assistance.
    const result = autoregulateRemaining([done(5, 8, 4), open(5, 8)], ASSISTED);

    if (result) {
      assert.ok(result.sets.every((set) => (set.weightKg ?? 0) >= 0));
    }
  });

  it('falls back to reps when it has no bodyweight to read the number against', () => {
    const result = autoregulateRemaining([done(10, 8, 5), open(10, 8)], {
      ...WEIGHTED,
      bodyweightKg: null,
    });

    assert.ok(result);
    // The belt is left exactly as the user set it, and the reps carry the move.
    assert.equal(result.sets[0]?.weightKg, 10);
    assert.equal(result.sets[0]?.reps, 11);
  });
});

describe('autoregulateRemaining, the line it produces', () => {
  it('states the reserve rather than the RPE, and names the set', () => {
    const result = autoregulateRemaining([done(80, 8, 5), open(80, 8)], BARBELL);
    assert.equal(result?.reason, 'Set 1 left 5 reps in reserve');
  });

  it('singularises one rep', () => {
    const result = autoregulateRemaining([done(80, 8, 9), open(80, 8)], BARBELL);
    assert.equal(result?.reason, 'Set 1 left 1 rep, under the 2 you train to');
  });

  it('has its own wording for a set with nothing left', () => {
    const result = autoregulateRemaining([done(80, 8, 10), open(80, 8)], BARBELL);
    assert.equal(result?.reason, 'Set 1 had nothing left');
  });

  it('trims a half point rather than printing it long', () => {
    const result = autoregulateRemaining([done(80, 8, 6.5), open(80, 8)], BARBELL);
    assert.equal(result?.reason, 'Set 1 left 3.5 reps in reserve');
  });

  it('is one sentence, sentence case, and carries no trailing period', () => {
    const result = autoregulateRemaining([done(80, 8, 5), open(80, 8)], BARBELL);
    assert.ok(result);
    assert.ok(!result.reason.endsWith('.'));
    assert.equal(result.reason[0], result.reason[0]?.toUpperCase());
  });
});

describe('autoregulateRemaining, on numbers it should not trust', () => {
  it('survives config nobody should have sent', () => {
    const result = autoregulateRemaining([done(80, 8, 5), open(80, 8)], {
      trackingType: 'weight_reps',
      incrementKg: Number.NaN,
      targetRpe: Number.NaN,
      minReps: Number.NaN,
      maxReps: Number.NaN,
    });

    // NaN increment reads as no load step, so this falls to the reps path and
    // whatever comes out is a finite rep count rather than a NaN in a field.
    if (result) {
      for (const set of result.sets) {
        assert.ok(set.reps === null || Number.isFinite(set.reps));
        assert.ok(set.weightKg === null || Number.isFinite(set.weightKg));
      }
    }
  });

  it('drops an out-of-range effort rather than clamping it', () => {
    // A 47 in this column is a mis-mapped CSV import, not a very hard set.
    assert.equal(autoregulateRemaining([done(80, 8, 47), open(80, 8)], BARBELL), null);
  });

  it('never suggests a weight that is not a multiple of the increment', () => {
    for (let rpe = 1; rpe <= 10; rpe += 0.5) {
      const result = autoregulateRemaining([done(82.5, 6, rpe), open(82.5, 6)], BARBELL);
      if (!result) continue;
      for (const set of result.sets) {
        const weight = set.weightKg ?? 0;
        assert.ok(
          Math.abs(weight / 2.5 - Math.round(weight / 2.5)) < 1e-9,
          `RPE ${rpe} produced ${weight}`,
        );
      }
    }
  });
});
