import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { suggestNextRoutine, type RotationRoutine, type RotationSession } from './rotation.ts';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

/** A routine last performed `days` ago, or never. */
function routine(id: string, days: number | null): RotationRoutine {
  return { id, name: id.toUpperCase(), lastPerformedAt: days === null ? null : NOW - days * DAY };
}

/** Sessions from a split written out in order, most recent last. */
function log(...entries: [string | null, number][]): RotationSession[] {
  return entries.map(([routineId, days]) => ({ routineId, startedAt: NOW - days * DAY }));
}

describe('suggestNextRoutine', () => {
  it('plays the rotation back: pull follows push', () => {
    const suggestion = suggestNextRoutine({
      routines: [routine('push', 1), routine('pull', 3), routine('legs', 2)],
      sessions: log(['push', 7], ['pull', 6], ['legs', 5], ['push', 4], ['pull', 3], ['legs', 2], ['push', 1]),
      now: NOW,
    });

    assert.deepEqual(suggestion, { routineId: 'pull', basis: 'rotation', after: 'PUSH' });
  });

  it('suggests the same routine again when that is what the log does', () => {
    const suggestion = suggestNextRoutine({
      routines: [routine('full', 2), routine('cardio', 30)],
      sessions: log(['full', 6], ['full', 4], ['full', 2]),
      now: NOW,
    });

    assert.deepEqual(suggestion, { routineId: 'full', basis: 'rotation', after: 'FULL' });
  });

  it('falls back to the routine rested longest with no pattern to read', () => {
    const suggestion = suggestNextRoutine({
      routines: [routine('push', 1), routine('pull', 9), routine('legs', 4)],
      sessions: log(['push', 9], ['legs', 4], ['push', 1]),
      now: NOW,
    });

    assert.deepEqual(suggestion, {
      routineId: 'pull',
      basis: 'rest',
      lastPerformedAt: NOW - 9 * DAY,
    });
  });

  // One shared session between two orders is a coincidence. The rest reading
  // takes over rather than the app guessing from a single observation.
  it('needs the order twice before it calls it a rotation', () => {
    const suggestion = suggestNextRoutine({
      routines: [routine('a', 1), routine('b', 6), routine('c', 3)],
      sessions: log(['a', 4], ['c', 3], ['a', 1]),
      now: NOW,
    });

    assert.equal(suggestion?.basis, 'rest');
    assert.equal(suggestion?.routineId, 'b');
  });

  it('breaks a tied rotation towards the one rested longest', () => {
    const suggestion = suggestNextRoutine({
      routines: [routine('a', 1), routine('b', 5), routine('c', 12)],
      sessions: log(
        ['a', 20], ['b', 19], ['a', 18], ['c', 17],
        ['a', 16], ['b', 15], ['a', 14], ['c', 12],
        ['b', 5], ['a', 1],
      ),
      now: NOW,
    });

    assert.deepEqual(suggestion, { routineId: 'c', basis: 'rotation', after: 'A' });
  });

  // Both readings land on push here: it follows itself twice over, and it is
  // the only routine with any history for the rest reading to rank. Neither may
  // answer, because the user knows what they trained an hour ago.
  it('never suggests what was trained a few hours ago', () => {
    const anHourAgo = { routineId: 'push', startedAt: NOW - 3_600_000 };

    const suggestion = suggestNextRoutine({
      routines: [{ id: 'push', name: 'PUSH', lastPerformedAt: NOW - 3_600_000 }, routine('pull', null)],
      sessions: [...log(['push', 5], ['push', 3]), anHourAgo],
      now: NOW,
    });

    assert.equal(suggestion, null);
  });

  it('ignores ad-hoc sessions without breaking the chain across them', () => {
    const suggestion = suggestNextRoutine({
      routines: [routine('push', 1), routine('pull', 3)],
      sessions: log(['push', 6], ['pull', 5], [null, 4], ['push', 3], ['pull', 2], ['push', 1]),
      now: NOW,
    });

    assert.deepEqual(suggestion, { routineId: 'pull', basis: 'rotation', after: 'PUSH' });
  });

  it('says nothing with one routine, or with no history behind any of them', () => {
    assert.equal(
      suggestNextRoutine({ routines: [routine('solo', 4)], sessions: log(['solo', 4]), now: NOW }),
      null,
    );

    assert.equal(
      suggestNextRoutine({
        routines: [routine('a', null), routine('b', null)],
        sessions: [],
        now: NOW,
      }),
      null,
    );
  });

  // A deleted routine is still named on the sessions it was performed as, and
  // reading one back would suggest a routine with no row left to open. The
  // chain closes over it, the way it closes over an ad-hoc session.
  it('never names a routine that no longer exists', () => {
    const suggestion = suggestNextRoutine({
      routines: [routine('pull', 6), routine('push', 20)],
      sessions: log(['pull', 10], ['gone', 9], ['pull', 8], ['gone', 7], ['pull', 6]),
      now: NOW,
    });

    assert.deepEqual(suggestion, { routineId: 'pull', basis: 'rotation', after: 'PULL' });
  });
});
