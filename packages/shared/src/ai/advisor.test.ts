import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeVolumeGaps, findVolumeGaps } from './advisor.ts';
import { LANDMARKS_BY_MUSCLE, landmarksFor } from '../landmarks.ts';
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUPS, type MuscleGroup } from '../types.ts';

/** The rows that are deliberately all zeros: buckets, not muscles. */
const NON_MUSCLES: readonly MuscleGroup[] = ['cardio', 'full_body', 'other'];

/** Every muscle at exactly its MEV, so a fixture can move one and change nothing else. */
function atMev(): Partial<Record<MuscleGroup, number>> {
  const map: Partial<Record<MuscleGroup, number>> = {};
  for (const muscle of MUSCLE_GROUPS) {
    const { mev, mrv } = LANDMARKS_BY_MUSCLE[muscle];
    // Rows with an MEV of zero need a positive figure to sit inside the band,
    // and it has to stay under the ceiling or they report as excess instead.
    map[muscle] = mev > 0 ? mev : Math.min(1, mrv);
  }
  return map;
}

function muscles(gaps: ReturnType<typeof findVolumeGaps>): MuscleGroup[] {
  return gaps.map((gap) => gap.muscle);
}

describe('findVolumeGaps', () => {
  it('reports nothing when every muscle sits inside its band', () => {
    assert.deepEqual(findVolumeGaps(atMev()), []);
  });

  it('treats a muscle missing from the map as untrained, not as absent', () => {
    // The whole point of the function. `getMuscleBoard` returns a partial map,
    // so the muscles worth reporting hardest are the ones with no entry at all.
    const gaps = findVolumeGaps({});
    assert.ok(gaps.length > 0);
    assert.ok(muscles(gaps).includes('chest'));

    const chest = gaps.find((gap) => gap.muscle === 'chest');
    assert.equal(chest?.setsPerWeek, 0);
    assert.equal(chest?.shortfall, LANDMARKS_BY_MUSCLE.chest.mev);
    assert.equal(chest?.zone, 'untrained');
    assert.equal(chest?.severity, 1);
  });

  it('never reports a bucket that is not a muscle', () => {
    const reported = new Set(muscles(findVolumeGaps({})));
    for (const muscle of NON_MUSCLES) {
      assert.equal(reported.has(muscle), false, `${muscle} should never be advised on`);
    }
  });

  it('reports no shortfall for a muscle whose MEV is zero, however little it got', () => {
    // Roughly a third of the table: glutes, abs, traps, forearms and the rest
    // whose published row assumes compound work covers them. There is no line
    // to fall under, so falling under it is not a finding.
    const zeroMev = MUSCLE_GROUPS.filter(
      (muscle) => LANDMARKS_BY_MUSCLE[muscle].mev === 0 && LANDMARKS_BY_MUSCLE[muscle].mrv > 0,
    );
    assert.ok(zeroMev.length > 0, 'fixture assumes the table has zero-MEV rows');

    const reported = new Set(muscles(findVolumeGaps({})));
    for (const muscle of zeroMev) {
      assert.equal(reported.has(muscle), false, `${muscle} has no MEV to fall short of`);
    }
  });

  it('does not report a muscle sitting exactly on its MEV', () => {
    const sets = atMev();
    assert.equal(muscles(findVolumeGaps(sets)).includes('chest'), false);
  });

  it('rounds a fractional shortfall up, because the answer is "add this many sets"', () => {
    const sets = { ...atMev(), chest: LANDMARKS_BY_MUSCLE.chest.mev - 2.5 };
    const chest = findVolumeGaps(sets).find((gap) => gap.muscle === 'chest');
    // Two sets would leave the week still under the line the figure was
    // measured against.
    assert.equal(chest?.shortfall, 3);
  });

  it('reports work past MRV as an excess rather than as a shortfall', () => {
    const sets = { ...atMev(), chest: LANDMARKS_BY_MUSCLE.chest.mrv + 4 };
    const chest = findVolumeGaps(sets).find((gap) => gap.muscle === 'chest');
    assert.equal(chest?.shortfall, 0);
    assert.equal(chest?.excess, 4);
    assert.equal(chest?.zone, 'overreaching');
  });

  it('ranks worst first', () => {
    const sets = {
      ...atMev(),
      // Half its MEV against a tenth of its MEV: quads should rank behind chest.
      chest: LANDMARKS_BY_MUSCLE.chest.mev * 0.1,
      quads: LANDMARKS_BY_MUSCLE.quads.mev * 0.5,
    };
    const ranked = muscles(findVolumeGaps(sets));
    assert.ok(ranked.indexOf('chest') < ranked.indexOf('quads'));
  });

  it('orders equal severities by the muscle list, so a card does not reshuffle', () => {
    const sets: Partial<Record<MuscleGroup, number>> = {};
    const twice = findVolumeGaps(sets).map((gap) => gap.muscle);
    assert.deepEqual(twice, findVolumeGaps(sets).map((gap) => gap.muscle));

    // Everything untrained scores 1, so the tie-break is the only thing
    // deciding the order and it must be the declaration order.
    const positions = twice.map((muscle) => MUSCLE_GROUPS.indexOf(muscle));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  });

  it('drops gaps inside the noise of where the window was cut', () => {
    const sets = { ...atMev(), chest: LANDMARKS_BY_MUSCLE.chest.mev - 0.2 };
    assert.equal(muscles(findVolumeGaps(sets)).includes('chest'), false);
    assert.equal(muscles(findVolumeGaps(sets, { minSeverity: 0 })).includes('chest'), true);
  });

  it('scales with training level, because the landmarks do', () => {
    const sets = { ...atMev() };
    // A beginner's MEV is lower, so a week that is short for an intermediate
    // can be adequate for them.
    const beginner = landmarksFor('chest', 'beginner');
    const advanced = landmarksFor('chest', 'advanced');
    assert.ok(beginner.mev <= advanced.mev, 'fixture assumes levels scale the table');

    const short = { ...sets, chest: beginner.mev };
    assert.equal(muscles(findVolumeGaps(short, { level: 'beginner' })).includes('chest'), false);
  });
});

describe('describeVolumeGaps', () => {
  it('says so plainly when there is nothing to report', () => {
    assert.match(describeVolumeGaps([], MUSCLE_GROUP_LABELS), /inside its productive range/);
  });

  it('carries the unit on every figure', () => {
    const gaps = findVolumeGaps({ ...atMev(), chest: 4 });
    const text = describeVolumeGaps(gaps, MUSCLE_GROUP_LABELS);
    assert.match(text, /Chest: 4 sets\/week/);
    assert.match(text, /MEV of \d+ sets\/week/);
  });

  it('prints a fractional rate to one decimal rather than hiding it', () => {
    // Indirect work counts at a half, so the rate is genuinely fractional. A
    // rate silently shown as "4" invites advice prescribing exactly 6 more.
    const gaps = findVolumeGaps({ ...atMev(), chest: 4.5 });
    assert.match(describeVolumeGaps(gaps, MUSCLE_GROUP_LABELS), /Chest: 4\.5 sets\/week/);
  });

  it('describes an excess against the ceiling, not the floor', () => {
    const gaps = findVolumeGaps({ ...atMev(), chest: LANDMARKS_BY_MUSCLE.chest.mrv + 3 });
    assert.match(describeVolumeGaps(gaps, MUSCLE_GROUP_LABELS), /3 past an MRV of/);
  });
});
